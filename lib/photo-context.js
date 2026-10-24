// Photo POSTs only need current access rules, their report, photo metadata,
// and allocation sequences. They must not transfer every GIS geometry again.
// This updates only the local mirror; the next general request reloads a full
// snapshot before reading any other tables.
export async function loadPhotoContext(cloud, raw, reportId) {
  const tables=['_users','_sessions','daily_report','daily_photo'];
  const [version,users,sessions,reports,photos,sequences]=await cloud.snapshot(query=>query([
    'SELECT MAX(v) v FROM _ver',
    'SELECT * FROM _users',
    'SELECT * FROM _sessions',
    {sql:'SELECT * FROM daily_report WHERE id=?',args:[reportId]},
    {sql:'SELECT * FROM daily_photo WHERE report_id=? AND deleted_at IS NULL',args:[reportId]},
    "SELECT name,seq FROM sqlite_sequence WHERE name IN ('_users','daily_report','daily_photo','_log')",
  ]));
  const quote=s=>'"'+s.replaceAll('"','""')+'"';
  raw.exec('BEGIN');
  try {
    for(const [i,rows] of [users,sessions,reports,photos].entries()) {
      const table=tables[i];raw.exec('DELETE FROM '+quote(table));
      if(!rows.length)continue;
      const columns=Object.keys(rows[0]);
      const insert=raw.prepare('INSERT INTO '+quote(table)+' ('+columns.map(quote).join(',')+') VALUES ('+columns.map(()=>'?').join(',')+')');
      for(const row of rows)insert.run(...columns.map(c=>row[c]));
    }
    const remove=raw.prepare('DELETE FROM sqlite_sequence WHERE name=?');
    const insert=raw.prepare('INSERT INTO sqlite_sequence(name,seq) VALUES (?,?)');
    for(const row of sequences){remove.run(row.name);insert.run(row.name,row.seq);}
    raw.exec('COMMIT');
  }catch(error){raw.exec('ROLLBACK');throw error;}
  return Number(version[0]?.v||0);
}
