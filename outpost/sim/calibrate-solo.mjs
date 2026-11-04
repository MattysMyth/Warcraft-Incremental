import { mk, world } from './calibrate-helpers.mjs';
import { heroUnit, runFight, encountersFor } from '../src/engine/combat.js';
import { heroRating } from '../src/engine/quests.js';
import { DATA } from '../src/engine/data.js';
import { seedFrom } from '../src/engine/rng.js';
const tpls = ['wolf_pack','kobold_tunnels','crossroads_bandits','murloc_shallows','old_boar','gnoll_scouts'];
function avgWin(state, h, L, rec, n = 20) {
  let w = 0, t = 0;
  for (const tp of tpls) {
    const offer = { template: tp, level: L, rec, n: 1, id: 'q', title: tp };
    const u = [heroUnit(state, h)];
    for (let i = 0; i < n; i++) { t++; if (runFight(u, encountersFor(offer), L, seedFrom(3, i, tp.length), DATA).won) w++; }
  }
  return w / t;
}
for (const cls of ['warrior','mage','rogue','priest','hunter','paladin']) {
  const out = [];
  for (const L of [1, 4, 7, 10]) {
    const h = mk(cls, L); const s = world([h]);
    const base = 15 * 1.1 ** (L - 1);
    const rating = heroRating(s, h);
    // find m where win=0.7 (win decreasing in m)
    let lo = 0.5, hi = 8;
    for (let k = 0; k < 12; k++) { const mid = (lo + hi) / 2; if (avgWin(s, h, L, base * mid, 10) > 0.7) lo = mid; else hi = mid; }
    out.push(`L${L} m*=${lo.toFixed(2)} rating/rec=${(rating / base).toFixed(2)}`);
  }
  console.log(cls.padEnd(8), out.join(' | '));
}
