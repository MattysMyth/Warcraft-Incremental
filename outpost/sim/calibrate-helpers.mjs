import { newState } from '../src/engine/state.js';
import { DATA } from '../src/engine/data.js';
import { rollItem } from '../src/engine/heroes.js';
import { makeRng, seedFrom } from '../src/engine/rng.js';
import { heroUnit, runFight, encountersFor } from '../src/engine/combat.js';
import { heroRating } from '../src/engine/quests.js';
const base = newState({ seed: 5, now: 0 });
const mk = (cls, level, i = 0, gearTier = 1) => {
  const c = DATA.classById[cls];
  const rng = makeRng(seedFrom(1, i, level));
  const gear = Object.fromEntries(DATA.gear.slots.map((s) => [s.id, null]));
  gear.weapon = { ...rollItem(rng, { slot: 'weapon', tier: gearTier, rarityId: 'common', weights: c.weights }), id: 'x' };
  return { id: `h${i}`, name: `${cls}${i}`, race: 'human', class: cls, trait: 'cheerful', level, xp: 0, talents: [], gear, lock: false, injury: 0 };
};
export const world = (heroes) => ({ ...base, heroes });
const odds = (state, tplId, level, rec, ids, n = 60) => {
  const offer = { template: tplId, level, rec, n: 1, id: 'q1', title: 'x' };
  const units = ids.map((h) => heroUnit(state, h));
  let w = 0;
  for (let i = 0; i < n; i++) if (runFight(units, encountersFor(offer), level, seedFrom(9, i, 1), DATA).won) w++;
  return w / n;
};
export { odds, mk };
if (process.argv[1].endsWith('calibrate-helpers.mjs')) {
  for (const cls of ['warrior', 'mage', 'rogue', 'priest', 'hunter', 'paladin']) {
    const row = [];
    for (const L of [1, 3, 5, 8, 10]) {
      const h = mk(cls, L);
      const s = world([h]);
      const rec = 15 * 1.1 ** (L - 1);
      const rating = heroRating(s, h);
      row.push(`L${L} r/rec ${(rating / rec).toFixed(2)} win ${odds(s, 'wolf_pack', L, rec, [h]).toFixed(2)}/${odds(s, 'old_boar', L, rec, [h]).toFixed(2)}/${odds(s, 'crossroads_bandits', L, rec, [h]).toFixed(2)}`);
    }
    console.log(cls.padEnd(8), row.join(' | '));
  }
}
