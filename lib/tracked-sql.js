// SQLite counts changed rows independently of schema changes. A no-op CREATE
// IF NOT EXISTS must not invalidate every other server instance's snapshot.
export function execChanged(db, sql) {
  const schema = db.prepare('PRAGMA schema_version').get().schema_version;
  const changes = db.prepare('SELECT total_changes() n').get().n;
  db.exec(sql);
  return db.prepare('PRAGMA schema_version').get().schema_version !== schema ||
    db.prepare('SELECT total_changes() n').get().n !== changes;
}
