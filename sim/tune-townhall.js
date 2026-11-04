// Re-tunes the Town Hall costs so each upgrade takes about its target time,
// given the income the game has right now. Run `npm run tune` after changing
// buildings or income, then re-baseline with `npm run sim -- --write`.
// Costs scale in order, level by level, so an earlier level never depends on a later one.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DATA } from '../src/engine/data.js';
import { simulate, fmtT } from './pacing.js';

const PATH = fileURLToPath(new URL('../data/townhall.json', import.meta.url));

// Minutes the buyer should spend getting from Town Hall L-1 to L (index 0 is level 2).
export const TARGET_MINUTES = [6, 14, 25, 45, 90, 120, 180, 240, 360, 480, 720, 900, 1200, 1500];

const round3 = (x) => {
  const p = 10 ** (Math.floor(Math.log10(x)) - 2);
  return Math.max(1, Math.round(x / p) * p);
};

const th = JSON.parse(readFileSync(PATH, 'utf8'));
const run = () => simulate({ maxHours: 400, data: { ...DATA, townHall: th } });

for (let L = 2; L <= th.maxLevel; L += 1) {
  const entry = th.levels.find((e) => e.level === L);
  const target = TARGET_MINUTES[L - 2] * 60;
  for (let pass = 0; pass < 12; pass += 1) {
    const { marks } = run();
    const prev = L === 2 ? 0 : marks[`townhall_${L - 1}`];
    const now = marks[`townhall_${L}`];
    if (prev === undefined) throw new Error(`Town Hall ${L - 1} was never reached`);
    const actual = now === undefined ? 400 * 3600 - prev : now - prev;
    const ratio = target / actual;
    if (now !== undefined && Math.abs(ratio - 1) < 0.04) break;
    const factor = Math.min(4, Math.max(0.25, ratio ** 0.9));
    for (const id of Object.keys(entry.cost)) {
      const f = id === 'gold' ? factor : factor ** 0.6;
      let value = round3(entry.cost[id] * f);
      // Storage limits cannot be raised before the Warehouse exists (it unlocks at level 4).
      if (L <= 4 && DATA.resourceById[id].capped) value = Math.min(value, Math.floor(DATA.economy.caps.base * 0.9));
      entry.cost[id] = value;
    }
  }
  const { marks } = run();
  const prev = L === 2 ? 0 : marks[`townhall_${L - 1}`];
  console.log(`Town Hall ${String(L).padStart(2)}: ${fmtT(marks[`townhall_${L}`] - prev)} (target ${fmtT(target)})  gold ${th.levels[L - 2].cost.gold.toLocaleString('en')}`);
}
writeFileSync(PATH, `${JSON.stringify(th, null, 2)}\n`);
console.log(`Wrote ${PATH}`);
