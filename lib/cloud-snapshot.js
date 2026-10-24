import { DatabaseSync } from 'node:sqlite';
const q = name => '"' + name.replaceAll('"', '""') + '"';

export async function copyCloudSnapshot(cloud,{chunkSize=16384}={}) {
  if(![16384,32768,65536].includes(chunkSize))throw new Error('Invalid snapshot chunk size');
  return cloud.snapshot(async query => {
    const [master, [version]] = await query(["SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'libsql_%' AND name NOT LIKE '\\_litestream%' ESCAPE '\\'", 'SELECT MAX(v) v FROM _ver']);
    const tables = master.filter(t=>t.type==='table'&&!t.name.startsWith('sqlite_'));
    const mem = new DatabaseSync(':memory:');
    try {
      mem.exec('BEGIN');
      for(const table of tables)mem.exec(table.sql);
      const jobs=tables.map(table=>{
        const info=mem.prepare('PRAGMA table_info('+q(table.name)+')').all();
        const columns=info.map(c=>c.name),primary=info.filter(c=>c.pk).sort((a,b)=>a.pk-b.pk);
        const order=primary.length?primary.map(c=>q(c.name)).join(','):'rowid';
        const fields=columns.flatMap((c,i)=>{
          const large=`typeof(${q(c)}) IN ('text','blob') AND length(${q(c)})>16384`;
          return [`CASE WHEN ${large} THEN NULL ELSE ${q(c)} END AS ${q(c)}`,`CASE WHEN ${large} THEN typeof(${q(c)}) END AS ${q('__chunk_'+i)}`];
        });
        const size=columns.map(c=>`CASE WHEN typeof(${q(c)}) IN ('text','blob') AND length(${q(c)})>16384 THEN 0 ELSE coalesce(length(CAST(${q(c)} AS BLOB)),0) END`).join('+');
        const insert=mem.prepare(`INSERT INTO ${q(table.name)} (${columns.map(q).join(',')}) VALUES (${columns.map(()=>'?').join(',')})`);
        return {table,columns,order,fields,size,insert,offset:0};
      });
      const sizes=await query(jobs.map(j=>`SELECT max(${j.size}) bytes FROM ${q(j.table.name)}`));
      jobs.forEach((j,i)=>j.limit=Math.max(1,Math.min(100,Math.floor(90000/(Number(sizes[i][0]?.bytes||0)*6+j.columns.length*100+300)))));
      while(jobs.length) {
        const batch=jobs.splice(0,4);
        const results=await query(batch.map(j=>`SELECT ${j.fields.join(',')} FROM ${q(j.table.name)} ORDER BY ${j.order} LIMIT ${j.limit} OFFSET ${j.offset}`));
        for(const [n,j] of batch.entries()) {
          const rows=results[n];
          for(const [index,row] of rows.entries()) {
            for(const [i,column] of j.columns.entries())if(row['__chunk_'+i]) {
              const chunks=[];
              for(let pos=1;;pos+=chunkSize*4) {
                const pieces=Array.from({length:4},(_,k)=>`substr(${q(column)},${pos+k*chunkSize},${chunkSize}) AS p${k}`);
                const [[part]]=await query([`SELECT ${pieces.join(',')} FROM ${q(j.table.name)} ORDER BY ${j.order} LIMIT 1 OFFSET ${j.offset+index}`]);
                let done=false;
                for(let k=0;k<4;k++){const value=part['p'+k];if(value==null||value.length===0){done=true;break;}chunks.push(value);if(value.length<chunkSize){done=true;break;}}
                if(done)break;
              }
              row[column]=row['__chunk_'+i]==='blob'?Buffer.concat(chunks):chunks.join('');
            }
            j.insert.run(...j.columns.map(c=>row[c]));
          }
          if(rows.length===j.limit){j.offset+=j.limit;jobs.push(j);}
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
