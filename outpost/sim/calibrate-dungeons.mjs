import { mk, world } from './calibrate-helpers.mjs';
import { heroUnit, runFight, encountersFor } from '../src/engine/combat.js';
import { heroRating, partyRating } from '../src/engine/quests.js';
import { DATA } from '../src/engine/data.js';
import { rollItem } from '../src/engine/heroes.js';
import { makeRng, seedFrom } from '../src/engine/rng.js';
const geared = (cls, L, i, pieces) => {
  const h = mk(cls, L, i); const c = DATA.classById[cls];
  const rng = makeRng(seedFrom(7, i, L));
  for (const slot of DATA.gear.slots.map((s) => s.id).slice(0, pieces)) h.gear[slot] = { ...rollItem(rng, { slot, tier: 1, rarityId: 'common', weights: c.weights }), id: `g${i}${slot}` };
  return h;
};
const comps = {
  'tank healer 3dps': ['warrior', 'priest', 'rogue', 'mage', 'hunter'],
  'tank paladin 3dps': ['warrior', 'paladin', 'rogue', 'mage', 'hunter'],
  'no tank': ['priest', 'rogue', 'mage', 'hunter', 'paladin'],
  'no healer': ['warrior', 'rogue', 'mage', 'hunter', 'rogue'],
  'all dps': ['rogue', 'mage', 'hunter', 'rogue', 'mage'],
  'trio tank heal dps': ['warrior', 'priest', 'mage'],
};
const tpl = DATA.templateById.fargodeep_mine;
const DIFF = Number(process.argv[2] ?? 3.4); if (process.argv[3]) { DATA.quests.types.dungeon.hpMult = Number(process.argv[3]); DATA.quests.types.dungeon.dpsMult = Number(process.argv[4]); }
const base = 15 * 1.1 ** (tpl.level - 1) * DIFF;
console.log('rec', base.toFixed(1));
const N = 40;
for (const L of [6]) for (const pieces of [1, 4]) {
  for (const [name, cl] of Object.entries(comps)) {
    const heroes = cl.map((c, i) => geared(c, L, i, pieces));
    const s = world(heroes);
    const offer = { template: 'fargodeep_mine', level: 6, rec: base, n: 1, id: 'q', title: 'F' };
    const units = heroes.map((h) => heroUnit(s, h));
    let w = 0, t0 = performance.now(), at = {};
    for (let i = 0; i < N; i++) { const r = runFight(units, encountersFor(offer), 6, seedFrom(3, i, 1), DATA); if (r.won) w++; else at[r.wipedAt] = (at[r.wipedAt] ?? 0) + 1; }
    const ms = (performance.now() - t0) / N;
    console.log(`L${L} gear${pieces} ${name.padEnd(20)} rating ${(partyRating(s, heroes.map((h) => h.id)) / base).toFixed(2)} win ${(w / N).toFixed(2)} wipes ${JSON.stringify(at)} ${ms.toFixed(1)}ms`);
  }
}
