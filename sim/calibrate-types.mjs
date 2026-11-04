// Calibrate slay and escort quests: for a party at a level, find the recommended rating at which it wins 70%,
// then print (party rating / that rating). Close to 1.0 means the notice's "recommended rating" is honest.
// Usage: node sim/calibrate-types.mjs [slay|escort] [template]
import { DATA } from '../src/engine/data.js';
import { mk, world } from './calibrate-helpers.mjs';
import { partyRating } from '../src/engine/quests.js';
import { heroUnit, runFight, encountersFor } from '../src/engine/combat.js';
import { seedFrom } from '../src/engine/rng.js';

const type = process.argv[2] ?? 'slay';
const tpl = process.argv[3] ?? (type === 'slay' ? 'kobold_warren' : 'milk_wagon');
const ty = DATA.quests.types[type];
const parties = type === 'slay'
  ? [['warrior', 'priest'], ['rogue', 'mage'], ['warrior', 'mage', 'priest'], ['hunter', 'rogue', 'warrior'], ['warrior', 'warrior']]
  : [['warrior'], ['rogue'], ['mage'], ['hunter'], ['warrior', 'priest'], ['rogue', 'mage']];
const odds = (s, units, rec, level, n = 50) => {
  const offer = { template: tpl, level, rec, n: 1, id: 'q', title: 'x' };
  let w = 0;
  for (let i = 0; i < n; i += 1) if (runFight(units, encountersFor(offer), level, seedFrom(9, i, 1), DATA).won) w += 1;
  return w / n;
};
for (const level of [3, 6, 10]) {
  for (const cls of parties) {
    const heroes = cls.map((c, i) => mk(c, level, i));
    const s = world(heroes);
    const units = heroes.map((h) => heroUnit(s, h));
    const rating = partyRating(s, heroes.map((h) => h.id));
    let lo = 1; let hi = 4000;
    for (let k = 0; k < 18; k += 1) {
      const mid = (lo + hi) / 2;
      if (odds(s, units, mid, level) > 0.7) lo = mid; else hi = mid;
    }
    const recDefault = 15 * 1.1 ** (level - 1) * ty.difficulty;
    console.log(`L${level} ${cls.join('+').padEnd(22)} rating ${rating.toFixed(0).padStart(5)}  rec@70% ${lo.toFixed(0).padStart(5)}  rating/rec70 ${(rating / lo).toFixed(2)}  default rec ${recDefault.toFixed(0)} -> rating/default ${(rating / recDefault).toFixed(2)}`);
  }
}
