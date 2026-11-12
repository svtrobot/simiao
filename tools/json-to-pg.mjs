// One-off: copy a single-instance JSON data folder into PostgreSQL before switching to the cluster.
// Existing rows are never overwritten, so it is safe to run twice.
//
//   DATA_DIR=./data DATABASE_URL=postgres://user:pass@host:5432/simiao node tools/json-to-pg.mjs
import fs from 'node:fs';
import path from 'node:path';
import { JsonStore } from '../server/store/jsonStore.js';
import { PgClient } from '../server/store/pg.js';
import { SCHEMA, withSchemaLock } from '../server/store/pgStore.js';

const dir = process.env.DATA_DIR || path.resolve('data');
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is required'); process.exit(1); }
if (!fs.existsSync(dir)) { console.error(`no data folder at ${dir}`); process.exit(1); }

const cols = [...new Set(fs.readdirSync(dir).filter((f) => /\.(json|log)$/.test(f)).map((f) => f.replace(/\.(json|log)$/, '')))];
const store = new JsonStore(dir);
const pg = new PgClient(url);
await pg.exec(withSchemaLock(SCHEMA));
let total = 0, added = 0;
for (const col of cols) {
  const docs = [...store._col(col)];
  for (let i = 0; i < docs.length; i += 500) {
    const batch = docs.slice(i, i + 500).map(([k, d]) => ({ c: col, k, d }));
    const { count } = await pg.query(
      `INSERT INTO docs (col, id, doc, v, writer) SELECT x->>'c', x->>'k', x->'d', 1, 'import' FROM jsonb_array_elements($1::jsonb) x ON CONFLICT (col, id) DO NOTHING`,
      [JSON.stringify(batch).replace(/\\u0000/g, '')]);
    added += count;
  }
  total += docs.length;
  console.log(`${col}: ${docs.length}`);
}
// blobs (靈位照片): <dir>/blobs/<col>/<id> → the blobs table
let blobs = 0;
const blobDir = path.join(dir, 'blobs');
if (fs.existsSync(blobDir)) {
  for (const col of fs.readdirSync(blobDir)) {
    for (const id of fs.readdirSync(path.join(blobDir, col))) {
      if (id.endsWith('.tmp')) continue;
      const { count } = await pg.query('INSERT INTO blobs (col, id, body) VALUES ($1, $2, $3) ON CONFLICT (col, id) DO NOTHING', [col, id, fs.readFileSync(path.join(blobDir, col, id), 'utf8')]);
      blobs += count;
    }
  }
}
await pg.close();
console.log(`done: ${added} of ${total} documents copied (the rest were already there); ${blobs} photos copied`);
