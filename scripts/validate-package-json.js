const fs = require('node:fs');
const path = require('node:path');

const root = process.argv[2];
if (!root) throw new Error('JSON directory argument is required');

for (const name of fs.readdirSync(root)) {
  if (!name.endsWith('.json')) continue;
  const file = path.join(root, name);
  JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}
