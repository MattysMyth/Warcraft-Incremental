import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buyBuilding, buyTownHall, assignWorker,
} from '../src/engine/actions.js';
import {
  levelCap, housingCapacity, storageCap, costExceedsStorage, workerMultiplier, workerCap, freeResidents,
  flows, incomePerSec, isHungry, questSpeedMultiplier, arrivalStatus, isUnlocked,
} from '../src/engine/derive.js';
import { step } from '../src/engine/tick.js';
import { advance } from '../src/engine/offline.js';
import { liveBuildings, townHallCost, validateData, producibleAt } from '../src/engine/data.js';
import { deserialize, normalize } from '../src/engine/save.js';
import { SAVE_VERSION } from '../src/engine/state.js';
import { fresh, withRes, withBuildings, DATA, eco, T0 } from './helpers.js';

const rich = (s) => withRes(s, Object.fromEntries(DATA.resources.map((r) => [r.id, 1e15])));
const atTownHall = (s, level) => ({ ...s, town: { ...s.town, townHall: level } });
const withTown = (s, over) => ({ ...s, town: { ...s.town, ...over } });

test('every live building is locked below its Town Hall level and buildable at it', () => {
  for (const def of liveBuildings()) {
    const below = rich(atTownHall(fresh(), def.unlockTownHall - 1 || 1));
    if (def.unlockTownHall > 1) {
      const r = buyBuilding(below, def.id, 1);
      assert.equal(r.ok, false, `${def.id} should be locked at Town Hall ${def.unlockTownHall - 1}`);
      assert.match(r.error, new RegExp(`Town Hall level ${def.unlockTownHall}`));
      assert.equal(isUnlocked(def, below), false);
    }
    const at = rich(atTownHall(fresh(), def.unlockTownHall));
    assert.ok(buyBuilding(at, def.id, 1).ok, `${def.id} should be buildable at Town Hall ${def.unlockTownHall}`);
  }
});

test('the Wall and Watchtower waits for Town Hall 11', () => {
  assert.equal(buyBuilding(rich(atTownHall(fresh(), 10)), 'wall_watchtower', 1).ok, false);
  assert.equal(buyBuilding(rich(atTownHall(fresh(), 11)), 'wall_watchtower', 1).ok, true);
});

test('buildings stop at ten levels per Town Hall level', () => {
  let s = rich(fresh());
  assert.equal(levelCap(s), 10);
  s = buyBuilding(s, 'lumber_camp', 10).state;
  assert.equal(s.town.buildings.lumber_camp, 10);
  const r = buyBuilding(s, 'lumber_camp', 1);
  assert.equal(r.ok, false);
  assert.match(r.error, /allows buildings up to level 10/);
  assert.equal(levelCap(atTownHall(s, 3)), 30);
});

test('buying more levels than room remains buys up to the cap', () => {
  const s = withBuildings(rich(fresh()), { market: 7 });
  const r = buyBuilding(s, 'market', 10);
  assert.ok(r.ok);
  assert.equal(r.bought, 3);
  assert.equal(r.newLevel, 10);
  assert.equal(buyBuilding(s, 'market', 'max').newLevel, 10);
});

test('the Town Hall upgrade spends its cost, raises the cap and logs what it unlocks', () => {
  const cost = townHallCost(2);
  const s = withRes(fresh(), { gold: 1000, lumber: 1000 });
  const r = buyTownHall(s);
  assert.ok(r.ok);
  assert.equal(r.state.town.townHall, 2);
  assert.ok(Math.abs(r.state.res.gold - (1000 - cost.gold)) < 1e-9);
  assert.equal(levelCap(r.state), 20);
  assert.ok(r.state.log.some((e) => /Town Hall raised to level 2.*Quarry/.test(e.text)));
  assert.equal(buyTownHall(fresh()).ok, false, 'cannot afford');
  assert.equal(buyTownHall(rich(atTownHall(fresh(), DATA.townHall.maxLevel))).ok, false, 'already at the top');
});

test('housing is four residents for the lodge plus four per House level', () => {
  assert.equal(housingCapacity(fresh()), 4);
  assert.equal(housingCapacity(withBuildings(fresh(), { house: 3 })), 16);
});

test('storage caps raw tier 1 resources, grow with the Warehouse and spare everything else', () => {
  assert.equal(storageCap(fresh(), 'lumber'), 1000);
  assert.ok(Math.abs(storageCap(withBuildings(fresh(), { warehouse: 2 }), 'stone') - 1000 * 1.3 ** 2) < 1e-9);
  assert.equal(storageCap(fresh(), 'gold'), Infinity);
  assert.equal(storageCap(fresh(), 'iron_bars'), Infinity);
  const s = withBuildings(withRes(fresh(), { lumber: 990, stone: 0, gold: 5 }), { lumber_camp: 10, market: 10 });
  const t = step(s, 100);
  assert.equal(t.res.lumber, 1000, 'overflow is lost');
  assert.ok(t.res.gold > 1000, 'gold is not capped');
});

test('a cost larger than the storage limit is flagged', () => {
  assert.equal(costExceedsStorage(fresh(), { gold: 1e9, lumber: 1500 }), 'lumber');
  assert.equal(costExceedsStorage(fresh(), { gold: 1e9, lumber: 900 }), null);
  assert.equal(costExceedsStorage(withBuildings(fresh(), { warehouse: 3 }), { lumber: 1500 }), null);
});

test('a resident settles after the arrival delay, using food, while there is room', () => {
  const s = withRes(fresh(), { food: 50 });
  const early = step(s, 19);
  assert.equal(early.town.residents, 0);
  const t = step(early, 1.5);
  assert.equal(t.town.residents, 1);
  assert.ok(Math.abs(t.res.food - (50 - eco.residents.arrivalFood - 0.1 * 0 * 1.5)) < 1e-6);
});

test('residents do not arrive without food, and progress waits for it', () => {
  const dry = withRes(fresh(), { food: 2 });
  const t = step(dry, 60);
  assert.equal(t.town.residents, 0);
  assert.equal(t.town.arrival, 0);
  assert.equal(arrivalStatus(dry).state, 'needsFood');
});

test('residents stop arriving when housing is full', () => {
  let s = withRes(fresh(), { food: 1000 });
  s = step(s, 600);
  assert.equal(s.town.residents, 4);
  assert.equal(arrivalStatus(s).state, 'full');
  const more = step(withBuildings(s, { house: 1 }), 30);
  assert.equal(more.town.residents, 5);
});

test('residents eat food and the larder never goes below zero', () => {
  const s = withTown(withRes(fresh(), { food: 100 }), { residents: 4 });
  const t = step(s, 10);
  assert.ok(Math.abs(t.res.food - (100 - 4 * 0.1 * 10)) < 1e-9);
  assert.equal(step(withRes(s, { food: 1 }), 100).res.food, 0);
});

test('an empty larder with mouths to feed is hunger, and slows quests by half', () => {
  const hungry = withTown(withRes(fresh(), { food: 0 }), { residents: 4 });
  assert.equal(isHungry(hungry), true);
  assert.equal(questSpeedMultiplier(hungry), eco.hungerQuestSpeed);
  const fed = withBuildings(hungry, { farm: 2 }); // 0.6 food/s against 0.4 eaten
  assert.equal(isHungry(fed), false);
  assert.equal(questSpeedMultiplier(fed), 1);
  assert.equal(isHungry(withRes(fresh(), { food: 0 })), false, 'nobody to be hungry');
  assert.equal(isHungry(withTown(withRes(fresh(), { food: 5 }), { residents: 4 })), false, 'stock remains');
});

test('workers add ten percent each, five at most, and only from free residents', () => {
  let s = withTown(withBuildings(fresh(), { market: 9 }), { residents: 6 });
  const base = flows(s).gross.gold;
  for (let i = 0; i < 5; i += 1) s = assignWorker(s, 'market', 1).state;
  assert.equal(s.town.workers.market, 5);
  assert.ok(Math.abs(workerMultiplier(s, 'market') - 1.5) < 1e-12);
  assert.ok(Math.abs(flows(s).gross.gold - (0.5 + (base - 0.5) * 1.5)) < 1e-9);
  assert.match(assignWorker(s, 'market', 1).error, /at most 5/);
  assert.equal(freeResidents(s), 1);
  s = assignWorker(withBuildings(s, { lumber_camp: 1 }), 'lumber_camp', 1).state;
  assert.equal(freeResidents(s), 0);
  assert.match(assignWorker(withBuildings(s, { quarry: 1 }), 'quarry', 1).error, /No free residents/);
  s = assignWorker(s, 'market', -1).state;
  assert.equal(s.town.workers.market, 4);
  assert.equal(assignWorker(s, 'farm', 1).ok, false, 'unbuilt');
  assert.equal(assignWorker(s, 'house', 1).ok, false, 'not a workplace');
  assert.equal(assignWorker(s, 'market', 2).ok, false);
});

test('the Blacksmith turns two ore into one bar and cannot make bars from nothing', () => {
  const smith = withBuildings(fresh(), { blacksmith: 5 }); // capacity 0.5 bars/s
  const none = step(smith, 100);
  assert.equal(none.res.iron_bars, 0);
  const fed = step(withRes(smith, { iron_ore: 40 }), 100); // ore for 20 bars
  assert.ok(Math.abs(fed.res.iron_bars - 20) < 1e-9);
  assert.ok(Math.abs(fed.res.iron_ore) < 1e-9);
  const plenty = step(withRes(smith, { iron_ore: 1000 }), 10);
  assert.ok(Math.abs(plenty.res.iron_bars - 5) < 1e-9);
  assert.ok(Math.abs(plenty.res.iron_ore - 990) < 1e-9);
});

test('smelting display matches the simulated steady state', () => {
  const s = withBuildings(fresh(), { mine: 10, blacksmith: 10 }); // ore 4/s, capacity 2 bars/s needs 4 ore/s
  const f = flows(s);
  assert.ok(Math.abs(f.net.iron_bars - 2) < 1e-9);
  assert.ok(Math.abs(f.net.iron_ore) < 1e-9);
  const t = step(s, 100);
  assert.ok(Math.abs(t.res.iron_bars - 200) < 1e-6);
  assert.ok(Math.abs(incomePerSec(withBuildings(fresh(), { mine: 2, blacksmith: 10 })).iron_bars - 0.4 / 2) < 1e-9);
});

test('residents and food stay consistent over a long offline gap', () => {
  const s = withBuildings(withRes(fresh(), { food: 100 }), { farm: 8, house: 2 });
  const { state } = advance(s, T0 + 3 * 3600 * 1000);
  assert.equal(state.town.residents, 12, 'housing for 12 fills up');
  assert.ok(state.res.food >= 0);
  assert.ok(state.res.food <= storageCap(state, 'food'));
});

test('a Checkpoint 1 save keeps its progress through migration', () => {
  const v1 = {
    v: 1, savedAt: T0, seed: 7,
    res: { gold: 5000, lumber: 120, stone: 4, food: 9 },
    town: { buildings: { lumber_camp: 40, market: 87, quarry: 3, farm: 2 }, workers: {}, townHall: 1 },
    heroes: [], quests: { board: [], active: [], orders: [] }, zones: {},
    prestige: { renown: 0, legacy: 0, sands: 0, upgrades: {} },
    stats: { lifetimeGold: 123456, rebuilds: 0, playSeconds: 99, tributes: 3 },
    settings: { numberFormat: 'suffix', reducedMotion: 'auto', buyAmount: 1 },
    log: [{ t: T0, text: 'Built the Lumber Camp.' }],
  };
  const s = deserialize(JSON.stringify(v1));
  assert.equal(s.v, SAVE_VERSION);
  assert.equal(s.town.buildings.market, 87);
  assert.equal(s.town.townHall, 9, 'cap of 10 per Town Hall level needs level 9 for Market 87');
  assert.equal(s.town.residents, 0);
  assert.equal(s.res.iron_bars, 0);
  assert.equal(s.stats.lifetimeGold, 123456);
  const small = deserialize(JSON.stringify({ ...v1, town: { ...v1.town, buildings: { quarry: 1 } } }));
  assert.equal(small.town.townHall, 2, 'a Quarry needs Town Hall 2');
});

test('normalize drops workers that cannot exist', () => {
  const base = withTown(withBuildings(fresh(), { market: 3, quarry: 0 }), {
    residents: 3, workers: { market: 9, quarry: 2, ghost: 4, house: 1 },
  });
  const n = normalize(base);
  assert.deepEqual(n.town.workers, { market: 3 }, 'limited by residents and by the five-worker rule');
  assert.equal(normalize(withTown(fresh(), { townHall: 99 })).town.townHall, DATA.townHall.maxLevel);
});

test('the shipped Town Hall table covers every level and obeys unlock order', () => {
  for (let L = 2; L <= DATA.townHall.maxLevel; L += 1) assert.ok(townHallCost(L), `level ${L}`);
  assert.ok(producibleAt(1).has('lumber') && !producibleAt(1).has('stone'));
  assert.ok(producibleAt(6).has('iron_bars'));
  assert.ok(!producibleAt(5).has('iron_bars'));
});

test('the validator rejects impossible costs and unlock orders', () => {
  const base = () => structuredClone({ economy: DATA.economy, resources: DATA.resources, buildings: DATA.buildings, townHall: DATA.townHall });
  const bad = base();
  bad.buildings.find((b) => b.id === 'mine').cost.iron_bars = 10; // bars need the Blacksmith, same level
  bad.townHall.levels.find((l) => l.level === 5).cost.iron_bars = 10; // no smithy by Town Hall 4
  bad.buildings.push({ id: 'ghost_hall', name: 'Ghost Hall', kind: 'planned', unlockTownHall: 5, blurb: 'Not yet.', arrivesIn: '' });
  bad.buildings.find((b) => b.id === 'warehouse').unlockTownHall = 99;
  delete bad.buildings.find((b) => b.id === 'blacksmith').ratio;
  bad.townHall.levels.pop();
  const problems = validateData(bad).join('\n');
  assert.match(problems, /"mine" costs iron_bars, which cannot be obtained/);
  assert.match(problems, /Town Hall 5 costs iron_bars/);
  assert.match(problems, /planned building "ghost_hall" needs arrivesIn/);
  assert.match(problems, /"warehouse" needs unlockTownHall/);
  assert.match(problems, /converter "blacksmith" needs a positive ratio/);
  assert.match(problems, /no cost for level 15/);
});

test('worker slots grow with building level, and extra slots add less output', () => {
  const w = DATA.economy.workers;
  const s0 = fresh();
  const at = (lvl, n) => {
    let s = { ...s0, town: { ...s0.town, buildings: { ...s0.town.buildings, market: lvl }, workers: { market: n }, residents: 40 } };
    return s;
  };
  assert.equal(workerCap(at(1, 0), 'market'), w.maxPerBuilding);
  assert.equal(workerCap(at(w.levelsPerExtraSlot, 0), 'market'), w.maxPerBuilding + 1);
  assert.equal(workerCap(at(10000, 0), 'market'), w.maxPerBuilding + w.maxExtraSlots);
  const full = workerMultiplier(at(w.levelsPerExtraSlot, w.maxPerBuilding + 1), 'market');
  assert.ok(Math.abs(full - (1 + w.bonusEach * w.maxPerBuilding + w.extraBonusEach)) < 1e-12);
  // The engine refuses the sixth worker below the unlock level and accepts it at it.
  assert.equal(assignWorker(at(1, w.maxPerBuilding), 'market', 1).ok, false);
  assert.equal(assignWorker(at(w.levelsPerExtraSlot, w.maxPerBuilding), 'market', 1).ok, true);
});
