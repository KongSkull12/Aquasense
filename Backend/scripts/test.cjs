const { spawnSync } = require('node:child_process');
const { readdirSync } = require('node:fs');
const path = require('node:path');
const cwd = path.resolve(__dirname, '..');
const selected = process.argv.slice(2);
const files = readdirSync(path.join(cwd, 'src/services')).filter(f => f.endsWith('.test.ts') && (!selected.length || selected.some(s => f.startsWith(s))));
if (!files.length) throw new Error('No matching tests');
const result = spawnSync(process.execPath, ['--test', '-r', './scripts/test-env.cjs', '-r', 'ts-node/register', ...files.map(f => 'src/services/' + f)], {cwd, stdio:'inherit'});
process.exit(result.status ?? 1);
