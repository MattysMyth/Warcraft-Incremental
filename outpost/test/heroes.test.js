import test from 'node:test';
import assert from 'node:assert/strict';
import {
  xpToNext, addXp, sheetOf, rosterCap, rollPool, poolSize, recruitCost, refreshCost, autoEquip,
  itemScore, drillRate, unlockedClasses, moraleOf, pendingTalents, rollItem,
} from '../src/engine/heroes.js';
import {
  recruitHero, refreshPool, toggleLock, equipItem, unequipSlot, chooseTalent, craftItem, craftCost,
  sellItem, injureHero, buyBuilding,
} from '../src/engine/actions.js';
import { step } from '../src/engine/tick.js';
import { advance } from '../src/engine/offline.js';
import { deserialize, serialize, normalize } from '../src/engine/save.js';
import { validateData } from '../src/engine/data.js';
import { makeRng } from '../src/engine/rng.js';
import { newState, SAVE_VERSION } from '../src/engine/state.js';
import { fresh, withRes, withBuildings, DATA, T0 } from './helpers.js';

const HD = DATA.heroes;
const rich = (s) => withRes(s, { gold: 1e12, lumber: 1e12, stone: 1e12, iron_bars: 1e9, iron_ore: 1e9, food: 1e9, leather: 1e9 });
// A town with a Tavern, ready to tick so the pool exists.
function tavernTown(level = 1, extra = {}) {
  let s = rich(fresh());
  s = { ...s, town: { ...s.town, townHall: 6 } };
  s = withBuildings(s, { tavern: level, ...extra });
  return step(s, 0.1);
}
const hire = (s, i = 0) => {
  const r = recruitHero(s, s.tavern.pool.filter((c) => !c.hired)[i].id);
  assert.ok(r.ok, r.error);
  return r.state;
};

test('shipped hero and gear data passes validation', () => {
  assert.deepEqual(validateData(DATA), []);
});

test('experience needed follows 100 * L^1.8', () => {
  assert.equal(xpToNext(1), 100);
  assert.equal(xpToNext(10), Math.round(100 * 10 ** 1.8));
  assert.equal(xpToNext(59), Math.round(100 * 59 ** 1.8));
});

test('addXp levels up repeatedly and stops at the cap', () => {
  const s = tavernTown();
  const h = hire(s).heroes[0];
  const big = addXp(h, xpToNext(1) + xpToNext(2) + 5);
  assert.equal(big.level, 3);
  assert.equal(big.xp, 5);
  const capped = addXp(h, 1e12);
  assert.equal(capped.level, 60);
  assert.equal(capped.xp, 0);
});

test('hero stats and health match the formulas', () => {
  let s = tavernTown();
  s = hire(s);
  const hero = { ...s.heroes[0], level: 10, gear: Object.fromEntries(Object.keys(s.heroes[0].gear).map((k) => [k, null])) };
  s = { ...s, heroes: [hero] };
  const cls = DATA.classById[hero.class];
  const race = DATA.raceById[hero.race];
  const sheet = sheetOf(s, hero);
  const morale = Math.min(1.1, Math.max(0.9, moraleOf(s) + (DATA.traitById[hero.trait].effect.morale ?? 0)));
  for (const id of DATA.statIds) {
    const expected = (cls.base[id] + cls.growth[id] * 9) * (race.statMult?.[id] ?? 1) * morale;
    assert.ok(Math.abs(sheet.stats[id] - expected) < 1e-9, id);
  }
  const mod = Math.max(0.5, 1 + (sheet.stats.stamina - 10) / 100);
  const fx = (k) => (race.effect[k] ?? 0) + (DATA.traitById[hero.trait].effect[k] ?? 0);
  assert.ok(Math.abs(sheet.hp - (60 + 12 * 10) * mod * (1 + fx('hp'))) < 1e-9, 'HP(L) = (60 + 12L) * stamina_mod');
});

test('gear adds to stats and morale scales them within 0.9 to 1.1', () => {
  let s = tavernTown();
  s = hire(s);
  const h = s.heroes[0];
  const bare = sheetOf(s, { ...h, gear: { ...h.gear, weapon: null } });
  const weapon = h.gear.weapon;
  assert.ok(weapon, 'new recruits arrive with a weapon');
  const dressed = sheetOf(s, h);
  const line = weapon.lines[0];
  const mult = (DATA.raceById[h.race].statMult?.[line.stat] ?? 1) * dressed.morale;
  assert.ok(Math.abs(dressed.stats[line.stat] - bare.stats[line.stat] - line.value * mult) < 1e-9);
  for (const base of [0, 1, 40]) {
    const m = sheetOf(withBuildings(s, { tavern: base || 1 }), h).morale;
    assert.ok(m >= 0.9 && m <= 1.1);
  }
  assert.equal(moraleOf({ ...s, town: { ...s.town, residents: 0 } }), HD.morale.base + HD.morale.tavernMax / HD.morale.tavernLevels);
});

test('the Tavern gates the roster and the recruit pool', () => {
  const bare = fresh();
  assert.equal(rosterCap(bare), 0);
  assert.equal(recruitHero(bare, 'c0-0').ok, false);
  const s = tavernTown(1);
  assert.equal(rosterCap(s), 2);
  assert.equal(s.tavern.pool.length, poolSize(s));
  assert.equal(rosterCap(withBuildings(s, { tavern: 9 })), 2 + 3);
});

test('the pool is reproducible from the seed and changes with the cycle', () => {
  const a = tavernTown();
  const b = tavernTown();
  assert.deepEqual(a.tavern.pool, b.tavern.pool);
  const c = { ...a, seed: a.seed + 1 };
  assert.notDeepEqual(rollPool({ ...c, tavern: { ...c.tavern } }), a.tavern.pool);
  const next = { ...a, tavern: { ...a.tavern, cycle: 1 } };
  assert.notDeepEqual(rollPool(next).map((x) => x.name), a.tavern.pool.map((x) => x.name));
});

test('only unlocked classes are offered, and buildings unlock the rest', () => {
  let s = tavernTown(1);
  assert.deepEqual(unlockedClasses(s).map((c) => c.id), ['warrior']);
  assert.ok(s.tavern.pool.every((c) => c.class === 'warrior'));
  s = withBuildings(s, { tavern: 3, barracks: 3, chapel: 5, mage_tower: 1 });
  assert.deepEqual(unlockedClasses(s).map((c) => c.id).sort(), ['hunter', 'mage', 'paladin', 'priest', 'rogue', 'warrior']);
  const seen = new Set();
  for (let cycle = 0; cycle < 40; cycle += 1) rollPool({ ...s, tavern: { ...s.tavern, cycle } }).forEach((c) => seen.add(c.class));
  assert.equal(seen.size, 6);
});

test('recruiting costs gold, fills the roster, and the cost climbs', () => {
  let s = tavernTown(1);
  s = withRes(s, { gold: 0 });
  assert.equal(recruitHero(s, s.tavern.pool[0].id).ok, false, 'needs gold');
  s = withRes(s, { gold: 1e9 });
  const cost1 = recruitCost(s, s.tavern.pool[0]);
  assert.equal(cost1, Math.round(HD.recruit.cost * (1 + HD.recruit.perStartLevel * (s.tavern.pool[0].level - 1))));
  const before = s.res.gold;
  s = hire(s);
  assert.equal(s.res.gold, before - cost1);
  assert.equal(s.heroes.length, 1);
  assert.equal(s.heroes[0].id, 'h1');
  assert.ok(recruitCost(s, s.tavern.pool[1]) > cost1);
  assert.equal(recruitHero(s, s.tavern.pool[0].id).ok, false, 'the same person cannot be hired twice');
  s = hire(s);
  const full = recruitHero(s, s.tavern.pool.find((c) => !c.hired).id);
  assert.equal(full.ok, false);
  assert.match(full.error, /roster is full/);
});

test('refreshing the pool costs gold and rolls new people', () => {
  let s = tavernTown(1);
  const old = s.tavern.pool.map((c) => c.id + c.name);
  const cost = refreshCost(s);
  const before = s.res.gold;
  const r = refreshPool(s);
  assert.ok(r.ok);
  assert.equal(r.state.res.gold, before - cost);
  assert.notDeepEqual(r.state.tavern.pool.map((c) => c.id + c.name), old);
  assert.equal(refreshPool(withRes(s, { gold: 0 })).ok, false);
});

test('the pool renews itself on a timer, also across a long absence', () => {
  let s = tavernTown(1);
  s = step(s, HD.pool.seconds - 1);
  assert.equal(s.tavern.cycle, 0);
  s = step(s, 2);
  assert.equal(s.tavern.cycle, 1);
  const gone = step(s, HD.pool.seconds * 5 + 10);
  assert.equal(gone.tavern.cycle, 6);
  assert.ok(gone.tavern.refreshIn > 0 && gone.tavern.refreshIn <= HD.pool.seconds);
});

test('drilling levels a hero to 10 and the yard stops at its limit', () => {
  let s = tavernTown(1);
  s = hire(s);
  const want = Array.from({ length: 9 }, (_, i) => (HD.drill.seconds * (i + 1) ** HD.drill.levelExp)).reduce((a, b) => a + b, 0);
  const mult = sheetOf(s, s.heroes[0]).xpMult;
  s = step(s, want / mult + 1);
  assert.equal(s.heroes[0].level, 10, 'a recruited hero levels to 10 by drilling');
  s = step(s, 1e7);
  assert.equal(s.heroes[0].level, HD.drill.maxLevel);
  assert.equal(drillRate(s, s.heroes[0]), 0);
});

test('Barracks speed up training', () => {
  const base = hire(tavernTown(1));
  const h = base.heroes[0];
  const r0 = drillRate(base, h);
  const r5 = drillRate(withBuildings(base, { barracks: 10 }), h);
  assert.ok(Math.abs(r5 / r0 - (1 + HD.drill.barracksBonus * 10)) < 1e-9);
});

test('talent points arrive every ten levels and perks are a choice of two', () => {
  let s = hire(tavernTown(1));
  let h = addXp(s.heroes[0], 1e9);
  assert.equal(h.level, 60);
  s = { ...s, heroes: [{ ...h, level: 9 }] };
  assert.equal(pendingTalents(s.heroes[0]), 0);
  assert.equal(chooseTalent(s, 'h1', DATA.classById.warrior.perks[0].id).ok, false, 'none yet');
  s = { ...s, heroes: [{ ...s.heroes[0], level: 10 }] };
  assert.equal(pendingTalents(s.heroes[0]), 1);
  assert.equal(chooseTalent(s, 'h1', 'not_a_perk').ok, false);
  const perk = DATA.classById[s.heroes[0].class].perks[0];
  const before = sheetOf(s, s.heroes[0]);
  const r = chooseTalent(s, 'h1', perk.id);
  assert.ok(r.ok);
  assert.equal(pendingTalents(r.state.heroes[0]), 0);
  assert.equal(chooseTalent(r.state, 'h1', perk.id).ok, false, 'no point left');
  const lvl20 = { ...r.state, heroes: [{ ...r.state.heroes[0], level: 20 }] };
  const twice = chooseTalent(lvl20, 'h1', perk.id);
  assert.ok(twice.ok, 'the same perk can be taken again at the next point');
  assert.ok(sheetOf(twice.state, twice.state.heroes[0])[{ hp: 'hp', power: 'power', crit: 'crit', healing: 'healing', threat: 'threat', armour: 'armour', haste: 'haste', regen: 'regen' }[Object.keys(perk.effect)[0]]] > sheetOf(r.state, lvl20.heroes[0])[{ hp: 'hp', power: 'power', crit: 'crit', healing: 'healing', threat: 'threat', armour: 'armour', haste: 'haste', regen: 'regen' }[Object.keys(perk.effect)[0]]], 'perks stack');
  const after = sheetOf(r.state, r.state.heroes[0]);
  const key = Object.keys(perk.effect)[0];
  const field = { hp: 'hp', power: 'power', crit: 'crit', healing: 'healing', threat: 'threat', armour: 'armour', haste: 'haste', regen: 'regen' }[key];
  assert.ok(after[field] > before[field], `${perk.name} raises ${field}`);
});

test('injured heroes rest and do not train, and the Chapel speeds recovery', () => {
  let s = hire(tavernTown(1));
  const trained = step(s, 100).heroes[0];
  assert.ok(trained.xp > 0 || trained.level > 1);
  s = injureHero(s, 'h1').state;
  assert.equal(s.heroes[0].injury, HD.injury.restSeconds);
  const half = step(s, 10).heroes[0];
  assert.equal(half.xp, 0);
  assert.ok(Math.abs(half.injury - (HD.injury.restSeconds - 10 * HD.injury.restRateBase * sheetOf(s, s.heroes[0]).recovery)) < 1e-6);
  const withChapel = step(withBuildings(s, { chapel: 10 }), 10).heroes[0];
  assert.ok(withChapel.injury < half.injury);
  const healed = step(s, HD.injury.restSeconds / HD.injury.restRateBase + 600).heroes[0];
  assert.equal(healed.injury, 0);
  assert.ok(healed.level > 1 || healed.xp > 0, 'training resumes after the rest');
});

test('auto-equip picks the best item per slot by class weights, and respects the lock', () => {
  let s = hire(tavernTown(1));
  const h = s.heroes[0];
  const cls = DATA.classById[h.class];
  const good = { id: 'i900', slot: 'head', tier: 1, rarity: 'common', name: 'Good Cap', lines: [{ stat: 'stamina', value: 5 }] };
  const poor = { id: 'i901', slot: 'head', tier: 1, rarity: 'common', name: 'Poor Cap', lines: [{ stat: 'spirit', value: 5 }] };
  assert.ok(itemScore(cls, good) > itemScore(cls, poor));
  s = autoEquip({ ...s, items: [poor, good] });
  assert.equal(s.heroes[0].gear.head.id, 'i900');
  assert.deepEqual(s.items.map((i) => i.id), ['i901']);
  const better = { ...good, id: 'i902', lines: [{ stat: 'stamina', value: 9 }] };
  const locked = toggleLock({ ...s, items: [...s.items, better] }, 'h1').state;
  assert.equal(autoEquip(locked).heroes[0].gear.head.id, 'i900', 'locked gear stays');
  const unlocked = toggleLock(locked, 'h1').state;
  assert.equal(unlocked.heroes[0].gear.head.id, 'i902', 'unlocking hands the choice back');
  assert.ok(unlocked.items.some((i) => i.id === 'i900'), 'the old item goes back to the bag');
});

test('items above a hero level are not equipped, and manual equip locks the hero', () => {
  let s = hire(tavernTown(1));
  const tier2 = { id: 'i910', slot: 'chest', tier: 2, rarity: 'common', name: 'Iron Hauberk', lines: [{ stat: 'stamina', value: 12 }] };
  s = autoEquip({ ...s, items: [tier2] });
  assert.equal(s.heroes[0].gear.chest, null);
  assert.equal(equipItem(s, 'h1', 'i910').ok, false);
  s = { ...s, heroes: [{ ...s.heroes[0], level: 12 }] };
  const r = equipItem(s, 'h1', 'i910');
  assert.ok(r.ok);
  assert.equal(r.state.heroes[0].lock, true);
  assert.equal(r.state.heroes[0].gear.chest.id, 'i910');
  const off = unequipSlot(r.state, 'h1', 'chest');
  assert.ok(off.ok);
  assert.equal(off.state.items.length, 1);
  assert.equal(unequipSlot(off.state, 'h1', 'chest').ok, false);
});

test('the Blacksmith forges gear for gold and iron bars', () => {
  let s = hire(tavernTown(1));
  assert.equal(craftItem(s, 'head', 1).ok, false, 'needs a Blacksmith');
  s = withBuildings(s, { blacksmith: 1 });
  assert.equal(craftItem(s, 'head', 2).ok, false, 'tier 2 needs Blacksmith level 10');
  const cost = craftCost(s, 'head', 1);
  assert.equal(cost.gold, Math.round(DATA.gear.craft.gold * 1.0 * 1));
  const before = { ...s.res };
  const r = craftItem(s, 'head', 1);
  assert.ok(r.ok);
  assert.equal(r.state.res.gold, before.gold - cost.gold);
  assert.equal(r.state.res.iron_bars, before.iron_bars - cost.iron_bars);
  assert.equal(r.item.slot, 'head');
  assert.ok(r.state.heroes[0].gear.head || r.state.items.length === 1, 'worn or kept in the bag');
  assert.equal(craftItem(withRes(s, { gold: 0 }), 'head', 1).ok, false);
  const again = craftItem(r.state, 'head', 1);
  assert.notEqual(again.item.id, r.item.id);
});

test('forging is reproducible from the seed', () => {
  const s = withBuildings(hire(tavernTown(1)), { blacksmith: 1 });
  const a = craftItem(s, 'chest', 1).item;
  const b = craftItem(s, 'chest', 1).item;
  assert.deepEqual(a, b);
});

test('item budgets follow tier, slot and rarity', () => {
  const rng = makeRng(5);
  const common = rollItem(rng, { slot: 'weapon', tier: 1, rarityId: 'common' });
  assert.equal(common.lines.length, 1);
  assert.equal(common.lines[0].value, Math.round(4 * 1.5 * 1 * 10) / 10);
  const epic = rollItem(rng, { slot: 'head', tier: 3, rarityId: 'epic' });
  assert.equal(epic.lines.length, 2);
  assert.equal(epic.lines[0].value, Math.round(16 * 1 * 2.2 * 0.6 * 10) / 10);
  assert.notEqual(epic.lines[0].stat, epic.lines[1].stat);
});

test('selling an item pays gold that grows with the Market', () => {
  let s = withBuildings(hire(tavernTown(1)), { blacksmith: 1 });
  s = craftItem(s, 'trinket', 1).state;
  s = { ...s, items: s.items.length ? s.items : [s.heroes[0].gear.trinket] };
  const item = s.items[0];
  const before = s.res.gold;
  const r = sellItem(s, item.id);
  assert.ok(r.ok);
  assert.equal(r.state.res.gold, before + r.gold);
  assert.equal(r.state.items.length, s.items.length - 1);
  const m = sellItem(withBuildings(s, { market: 50 }), item.id).gold;
  assert.ok(m > r.gold);
  assert.equal(sellItem(r.state, item.id).ok, false);
});

test('heroes train through a long offline gap and report level ups', () => {
  const s = hire(tavernTown(1));
  const { state, report } = advance({ ...s, savedAt: T0 }, T0 + 3 * 3600 * 1000);
  assert.ok(state.heroes[0].level > 1);
  assert.ok(report.heroLevels.length === 1 && report.heroLevels[0].to === state.heroes[0].level);
});

test('hero saves round trip and a Checkpoint 2 save gains the new fields', () => {
  let s = withBuildings(hire(tavernTown(3)), { blacksmith: 1 });
  s = craftItem(s, 'legs', 1).state;
  const back = deserialize(serialize(s));
  assert.deepEqual(back.heroes, s.heroes);
  assert.deepEqual(back.items, s.items);
  assert.deepEqual(back.tavern, s.tavern);
  assert.deepEqual(back.counters, s.counters);

  const v2 = { ...JSON.parse(serialize(fresh())), v: 2 };
  delete v2.items; delete v2.tavern; delete v2.counters;
  const up = deserialize(JSON.stringify(v2));
  assert.equal(up.v, SAVE_VERSION);
  assert.deepEqual(up.heroes, []);
  assert.deepEqual(up.items, []);
  assert.equal(up.tavern.pool, null);
});

test('normalize repairs broken heroes, items and the pool', () => {
  const s = hire(tavernTown(1));
  const h = s.heroes[0];
  const broken = JSON.parse(serialize(s));
  broken.heroes = [
    { ...h, level: 999, xp: -5, talents: ['nope', 'nope'], gear: { weapon: { id: 'x', slot: 'head', tier: 1, rarity: 'common', name: 'wrong slot', lines: [{ stat: 'stamina', value: 1 }] }, head: { id: 'y' } }, injury: 'long' },
    { ...h, id: 'h1' },
    { ...h, id: 'h7', class: 'bard' },
    null,
  ];
  broken.items = [{ id: 'i5', slot: 'legs', tier: 1, rarity: 'common', name: 'Ok', lines: [{ stat: 'strength', value: 3 }] }, { id: 'i6', slot: 'legs', tier: 9, rarity: 'common', name: 'Bad', lines: [] }, 7];
  broken.tavern = { cycle: -3, refreshIn: 'soon', pool: [{ id: 'c0-0', class: 'warrior' }] };
  const n = normalize(broken);
  assert.equal(n.heroes.length, 1);
  assert.equal(n.heroes[0].level, 60);
  assert.equal(n.heroes[0].gear.weapon, null);
  assert.equal(n.heroes[0].gear.head, null);
  assert.deepEqual(n.heroes[0].talents, []);
  assert.equal(n.heroes[0].injury, 0);
  assert.equal(n.items.length, 1);
  assert.equal(n.tavern.pool, null);
  assert.ok(n.tavern.refreshIn > 0);
  assert.ok(n.counters.item >= 5 && n.counters.hero >= 1);
});

test('the validator rejects broken hero data', () => {
  const bad = structuredClone(DATA);
  bad.buildings.push({ id: 'ghost_hall', name: 'Ghost Hall', kind: 'planned', unlockTownHall: 5, blurb: 'Not yet.', arrivesIn: 'Later' });
  bad.buildingById.ghost_hall = bad.buildings.at(-1);
  bad.heroes.classes[1].unlock.building = 'ghost_hall';
  bad.heroes.classes[2].perks.pop();
  bad.heroes.races[0].effect = { luck: 1 };
  bad.gear.tiers[1].budget = 0;
  bad.gear.rarities[2].above = 0.1;
  const problems = validateData(bad).join('\n');
  assert.match(problems, /class "mage" is unlocked by "ghost_hall"/);
  assert.match(problems, /class "rogue" needs exactly two perks/);
  assert.match(problems, /race "human" has unknown effect "luck"/);
  assert.match(problems, /gear tier 2 needs budget/);
  assert.match(problems, /rarity "rare" must start above/);
});

test('the new buildings are built at their Town Hall levels and gate on cost', () => {
  let s = rich(fresh());
  assert.equal(buyBuilding(s, 'tavern', 1).ok, false, 'Town Hall 2 needed');
  s = { ...s, town: { ...s.town, townHall: 2 } };
  assert.ok(buyBuilding(s, 'tavern', 1).ok);
  assert.equal(buyBuilding(s, 'barracks', 1).ok, false);
  assert.equal(buyBuilding(s, 'chapel', 1).ok, false);
  s = { ...s, town: { ...s.town, townHall: 3 } };
  for (const id of ['tavern', 'barracks', 'chapel']) assert.ok(buyBuilding(s, id, 1).ok, id);
});

test('a fresh state has no heroes and an empty bag', () => {
  const s = newState({ seed: 3, now: T0 });
  assert.deepEqual([s.heroes, s.items, s.counters], [[], [], { hero: 0, item: 0, hall: 0 }]);
  assert.equal(s.tavern.pool, null);
});
