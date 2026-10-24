import { DatabaseSync } from 'node:sqlite';
const q = name => '"' + name.replaceAll('"', '""') + '"';

// Keep one read transaction while transferring bounded responses. Large text
// (GIS geometry and revision history) is read in chunks, never one huge JSON body.
export async function copyCloudSnapshot(cloud) {
  return cloud.snapshot(async query => {
    const [master, [version]] = await query(["SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'libsql_%' AND name NOT LIKE '\\_litestream%' ESCAPE '\\'", 'SELECT MAX(v) v FROM _ver']);
    const tables = master.filter(t=>t.type==='table'&&!t.name.startsWith('sqlite_'));
    const mem = new DatabaseSync(':memory:');
    try {
      mem.exec('BEGIN');
      for(const table of tables)mem.exec(table.sql);
      for(const table of tables) {
        const info=mem.prepare('PRAGMA table_info('+q(table.name)+')').all();
        const columns=info.map(c=>c.name);
        const primary=info.filter(c=>c.pk).sort((a,b)=>a.pk-b.pk);
        const order=primary.length?primary.map(c=>q(c.name)).join(','):'rowid';
        const fields=columns.flatMap((c,i)=>{
          const large=`typeof(${q(c)}) IN ('text','blob') AND length(${q(c)})>16384`;
          return [`CASE WHEN ${large} THEN NULL ELSE ${q(c)} END AS ${q(c)}`,`CASE WHEN ${large} THEN typeof(${q(c)}) END AS ${q('__chunk_'+i)}`];
        });
        const insert=mem.prepare(`INSERT INTO ${q(table.name)} (${columns.map(q).join(',')}) VALUES (${columns.map(()=>'?').join(',')})`);
        for(let offset=0;;offset+=100) {
          const [rows]=await query([`SELECT ${fields.join(',')} FROM ${q(table.name)} ORDER BY ${order} LIMIT 100 OFFSET ${offset}`]);
          for(const [index,row] of rows.entries()) {
            for(const [i,column] of columns.entries())if(row['__chunk_'+i]) {
              const chunks=[];
              for(let pos=1;;pos+=16384) {
                const [[part]]=await query([`SELECT substr(${q(column)},${pos},16384) part FROM ${q(table.name)} ORDER BY ${order} LIMIT 1 OFFSET ${offset+index}`]);
                if(part.part==null || part.part.length===0)break;
                chunks.push(part.part);
                if(part.part.length<16384)break;
              }
              row[column]=row['__chunk_'+i]==='blob'?Buffer.concat(chunks):chunks.join('');
            }
            insert.run(...columns.map(c=>row[c]));
          }
          if(rows.length<100)break;
        }
      }
      if(master.some(t=>t.name==='sqlite_sequence')) {
        const [seq]=await query(['SELECT name,seq FROM sqlite_sequence']);
        mem.exec('DELETE FROM sqlite_sequence');
        const insert=mem.prepare('INSERT INTO sqlite_sequence(name,seq) VALUES (?,?)');
        for(const row of seq)insert.run(row.name,row.seq);
      }
      for(const index of master.filter(t=>t.type==='index'&&t.sql))mem.exec(index.sql);
      mem.exec('COMMIT');
      return {db:mem,version:Number(version?.v||0)};
    } catch(error) { mem.close();throw error; }
  });
}
