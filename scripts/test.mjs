// Runs every test/*.test.js with Node's built-in runner. Lists the files itself because
// quoted glob patterns are only understood by Node 21 and newer.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const files = readdirSync('test').filter((f) => f.endsWith('.test.js')).sort().map((f) => `test/${f}`);
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
