import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { execChanged } from '../lib/tracked-sql.js';

test('repeated startup DDL does not invalidate an unchanged cloud snapshot', () => {
  const db=new DatabaseSync(':memory:');
  try {
    assert.equal(execChanged(db,'CREATE TABLE IF NOT EXISTS data(id INTEGER PRIMARY KEY,value TEXT)'),true);
    assert.equal(execChanged(db,'CREATE TABLE IF NOT EXISTS data(id INTEGER PRIMARY KEY,value TEXT)'),false);
    assert.equal(execChanged(db,'CREATE INDEX IF NOT EXISTS by_value ON data(value)'),true);
    assert.equal(execChanged(db,'CREATE INDEX IF NOT EXISTS by_value ON data(value)'),false);
    assert.equal(execChanged(db,"INSERT OR IGNORE INTO data VALUES(1,'hasil')"),true);
    assert.equal(execChanged(db,"INSERT OR IGNORE INTO data VALUES(1,'hasil')"),false);
    assert.equal(execChanged(db,'DELETE FROM data WHERE id=2'),false);
    assert.equal(execChanged(db,"UPDATE data SET value='baru' WHERE id=1"),true);
    assert.equal(db.prepare('SELECT value FROM data').get().value,'baru');
  }finally{db.close();}
});
