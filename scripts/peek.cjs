const Database = require('better-sqlite3');
const db = new Database('./data/spa.db', { readonly: true });

console.log('=== topic counts ===');
for (const r of db.prepare('SELECT topic, count(*) c FROM events GROUP BY topic ORDER BY c DESC').all()) {
  console.log(`  ${r.c.toString().padStart(5)}  ${r.topic}`);
}

console.log('\n=== one latest payload per topic ===');
const topics = db.prepare('SELECT DISTINCT topic FROM events').all().map(r => r.topic);
for (const t of topics) {
  const row = db.prepare('SELECT payload_json FROM events WHERE topic = ? ORDER BY ts DESC LIMIT 1').get(t);
  console.log(`\n-- ${t}`);
  console.log(row && row.payload_json ? row.payload_json : '(none)');
}
