const fs = require('node:fs');
const path = require('node:path');

const stage = process.argv[2];
if (!stage) throw new Error('Package stage argument is required');

const tournamentRoot = path.join(stage, 'public', 'assets', 'data');
for (const name of fs.readdirSync(tournamentRoot)) {
  if (!name.endsWith('.json')) continue;
  const file = path.join(tournamentRoot, name);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (data.source?.workbook) data.source.workbook = path.basename(data.source.workbook);
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

const checkedFiles = [
  path.join(stage, 'defaults', 'data', 'bp-config.json'),
  ...fs.readdirSync(tournamentRoot).filter(name => name.endsWith('.json')).map(name => path.join(tournamentRoot, name))
];
for (const file of checkedFiles) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const visit = (value, field = '') => {
    if (typeof value === 'string' && /^[a-z]:[\\/]/i.test(value)) throw new Error(`Absolute packaged path at ${file}: ${field}`);
    if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => visit(item, field ? `${field}.${key}` : key));
  };
  visit(data);
}
