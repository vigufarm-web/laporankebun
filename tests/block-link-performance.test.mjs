import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createBlockRegistry } from '../lib/blocks.js';

test('bulk history linking resolves aliases without repeatedly reading geometry', () => {
  const raw=new DatabaseSync(':memory:');let registryReads=0;
  const db={exec:sql=>raw.exec(sql),prepare:sql=>{if(/SELECT .* FROM _blocks ORDER BY nama/.test(sql)){registryReads++;assert.ok(!sql.startsWith('SELECT *'));}return raw.prepare(sql);}};
  try {
    raw.exec('CREATE TABLE daily_item(id INTEGER PRIMARY KEY,blok TEXT,realisasi REAL)');
    const blocks=createBlockRegistry({db,TABLES:{daily_item:{f:[]}},cascadeRename(){},log(){}});blocks.migrate();
    raw.prepare('INSERT INTO _blocks(id,nama,aliases,geometry) VALUES(?,?,?,?)').run('permanent-id','A01','["Nama Lama"]','x'.repeat(1000000));
    for(let i=1;i<=300;i++)raw.prepare('INSERT INTO daily_item(id,blok,realisasi) VALUES(?,?,?)').run(i,i%2?'A01':'Nama Lama',50);
    blocks.linkTable('daily_item');
    assert.equal(raw.prepare("SELECT COUNT(*) n FROM daily_item WHERE block_id='permanent-id' AND realisasi=50").get().n,300);
    assert.equal(raw.prepare('SELECT COUNT(*) n FROM _block_links').get().n,300);
    assert.equal(raw.prepare('SELECT block_name_snapshot FROM daily_item WHERE id=2').get().block_name_snapshot,'Nama Lama');
    assert.ok(registryReads<=2,'one registry read per batch, independent of report count');
  }finally{raw.close();}
});
