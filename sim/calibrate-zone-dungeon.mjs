// Win rates for each dungeon by party make-up and gear: node sim/calibrate-zone-dungeon.mjs <templateId> [pieces...]
import { mk, world } from './calibrate-helpers.mjs';
import { heroUnit, runFight, encountersFor } from '../src/engine/combat.js';
import { partyRating } from '../src/engine/quests.js';
import { DATA } from '../src/engine/data.js';
import { rollItem } from '../src/engine/heroes.js';
import { makeRng, seedFrom } from '../src/engine/rng.js';
const id = process.argv[2] ?? 'the_deadmines';
const tpl = DATA.templateById[id];
const tier = Number(process.env.TIER ?? DATA.zoneById[tpl.zone].tier);
const pieceList = process.argv.slice(3).map(Number);
const pieces = pieceList.length ? pieceList : [1, 4, 6];
const geared = (cls, L, i, n) => {
  const h = mk(cls, L, i, tier); const c = DATA.classById[cls];
  const rng = makeRng(seedFrom(7, i, L));
  for (const slot of DATA.gear.slots.map((s) => s.id).slice(0, n)) h.gear[slot] = { ...rollItem(rng, { slot, tier, rarityId: process.env.RAR ?? 'common', weights: c.weights }), id: `g${i}${slot}` };
  return h;
};
const comps = {
  'tank healer 3dps': ['warrior', 'priest', 'rogue', 'mage', 'hunter'],
  'no tank': ['priest', 'rogue', 'mage', 'hunter', 'paladin'],
  'no healer': ['warrior', 'rogue', 'mage', 'hunter', 'rogue'],
  'all dps': ['rogue', 'mage', 'hunter', 'rogue', 'mage'],
  'trio tank heal dps': ['warrior', 'priest', 'mage'],
};
const L = tpl.level;
const rec = 15 * 1.1 ** (L - 1) * DATA.quests.types.dungeon.difficulty;
console.log(id, 'level', L, 'tier', tier, 'rec', rec.toFixed(0));
const N = 40;
for (const n of pieces) for (const [name, cl] of Object.entries(comps)) {
  const heroes = cl.map((c, i) => geared(c, L, i, n));
  const s = world(heroes);
  const offer = { template: id, level: L, rec, n: 1, id: 'q', title: 'x' };
  const units = heroes.map((h) => heroUnit(s, h));
  let w = 0; const at = {}; const t0 = performance.now();
  for (let i = 0; i < N; i += 1) { const r = runFight(units, encountersFor(offer), L, seedFrom(3, i, 1), DATA); if (r.won) w += 1; else at[r.wipedAt] = (at[r.wipedAt] ?? 0) + 1; }
  console.log(`gear${n} ${name.padEnd(20)} rating/rec ${(partyRating(s, heroes.map((h) => h.id)) / rec).toFixed(2)} win ${(w / N).toFixed(2)} wipes ${JSON.stringify(at)} ${((performance.now() - t0) / N).toFixed(1)}ms`);
}
