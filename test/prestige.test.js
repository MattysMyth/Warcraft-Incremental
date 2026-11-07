import test from 'node:test';
import assert from 'node:assert/strict';
import { rewardFor, regularCount } from '../src/engine/quests.js';
import { refreshPool, recruitHero, dispatchQuest, brewPotion, createOrder, craftCost, buyBuilding, buyTownHall, collectTribute } from '../src/engine/actions.js';
import { rebuild, buyUpgrade, startingTown, startingResources } from '../src/engine/rebuild.js';
import {
  renownMultiplier, renownGain, rebuildPreview, bonusOf, upgradeCost, upgradeLevel, valueAt, renownTotal, totalGold, goldForGain,
} from '../src/engine/renown.js';
import {
  globalMultiplier, outputOf, storageCap, housingCapacity, ecoFor, costOf, townHallCostFor, foodPerResident,
  questSpeedMultiplier, flows, levelOf,
} from '../src/engine/derive.js';
import { sheetOf, recruitCost, rosterCap, restRate } from '../src/engine/heroes.js';
import { swornCost, zoneOpen } from '../src/engine/zones.js';
import { newTavern } from '../src/engine/heroes.js';
import { newQuests } from '../src/engine/quests.js';
import { newAlchemy } from '../src/engine/alchemy.js';
import { step } from '../src/engine/tick.js';
import { advance } from '../src/engine/offline.js';
import { serialize, deserialize, normalize, migrate, MIGRATIONS } from '../src/engine/save.js';
import { validateData } from '../src/engine/data.js';
import { newState, SAVE_VERSION } from '../src/engine/state.js';
import { fresh, withRes, withBuildings, DATA } from './helpers.js';

const rich = (s) => withRes(s, { gold: 1e12, lumber: 1e12, stone: 1e12, iron_bars: 1e9, iron_ore: 1e9, food: 1e9, herbs: 1e6, leather: 1e6, arcane_dust: 1e6 });
const withUpgrades = (s, ups) => ({ ...s, prestige: { ...s.prestige, upgrades: { ...s.prestige.upgrades, ...ups } } });
// The tests think in the original 1-million-gold unit; K rescales it to the divisor in data/renown.json.
const K = 1e6 / DATA.renown.gain.divisor;
const withRun = (s, gold) => ({ ...s, stats: { ...s.stats, lifetimeGold: gold / K } });

// A mid-game town with heroes, a bag, clears, standing, a party on the road and a standing order.
function midgame() {
  let s = rich(fresh());
  s = { ...s, town: { ...s.town, townHall: 10, residents: 12, workers: { market: 3, farm: 2 } } };
  s = withBuildings(s, { tavern: 9, barracks: 4, alchemy_lab: 5, chapel: 5, blacksmith: 1, house: 20, market: 15, farm: 5, warehouse: 4 });
  s = step(s, 0.1);
  for (let i = 0; i < 3; i += 1) {
    if (!s.tavern.pool.some((c) => !c.hired)) s = refreshPool(s).state;
    s = recruitHero(s, s.tavern.pool.filter((c) => !c.hired)[0].id).state;
  }
  s = { ...s, heroes: s.heroes.map((h, i) => ({ ...h, level: 30 + i, xp: 5, talents: [], injury: i === 0 ? 100 : 0 })) };
  s = step(s, 0.1);
  const offer = s.quests.board.find((o) => o.type === 'bounty');
  const sent = dispatchQuest(s, offer.id, [s.heroes[2].id]);
  assert.ok(sent.ok, sent.error);
  s = sent.state;
  s = brewPotion(s, 'vigour').state;
  s = {
    ...s,
    items: [{ id: 'i900', slot: 'weapon', tier: 1, rarity: 'common', name: 'Spare Sword', lines: [{ stat: 'strength', value: 3 }] }],
    zones: {
      ...s.zones,
      elwynn: { cleared: ['fargodeep_mine'], rep: 150, trophies: 3, story: 2 },
      westfall: { cleared: ['the_deadmines'], rep: 40, trophies: 1, story: 1 },
    },
    stats: { ...s.stats, lifetimeGold: 4.5e8 / K, questsDone: 77, tributes: 9, recentWins: 4 },
    prestige: { ...s.prestige, legacy: 3, sands: 1, upgrades: { purse: 1 }, renown: 5, renownTotal: 20 },
    settings: { ...s.settings, numberFormat: 'scientific' },
  };
  return s;
}

test('shipped Renown data validates; broken shops are caught', () => {
  assert.deepEqual(validateData(DATA), []);
  const bad = structuredClone(DATA);
  bad.renown.upgrades[1].key = 'startGold';
  assert.ok(validateData(bad).some((p) => p.includes('share the effect')));
  const bad2 = structuredClone(DATA);
  bad2.renown.upgrades.find((u) => u.key === 'foodSaver').values = [0.5, 0.95];
  assert.ok(validateData(bad2).some((p) => p.includes('cannot discount')));
  const bad3 = structuredClone(DATA);
  bad3.renown.upgrades.find((u) => u.key === 'xp').values = [0.5, 0.2];
  assert.ok(validateData(bad3).some((p) => p.includes('rising')));
  const bad4 = structuredClone(DATA);
  bad4.renown.upgrades.find((u) => u.key === 'scouts').values = [1, 5];
  assert.ok(validateData(bad4).some((p) => p.includes('scouts more dungeons')));
  const bad5 = structuredClone(DATA);
  bad5.renown.upgrades.pop();
  assert.ok(validateData(bad5).some((p) => p.includes('no renown upgrade provides')));
});

test('the shop has about twenty upgrades in four branches', () => {
  assert.equal(DATA.renown.upgrades.length, 20);
  assert.equal(DATA.renown.branches.length, 4);
  for (const b of DATA.renown.branches) assert.equal(DATA.renown.upgrades.filter((u) => u.branch === b.id).length, 5);
});

test('the Renown multiplier follows the pacing table', () => {
  const table = [[15, 1.23], [30, 1.43], [60, 1.80], [120, 2.49], [240, 3.77], [480, 6.18], [960, 10.66], [1920, 19.03]];
  for (const [renown, mult] of table) assert.equal(renownMultiplier(renown).toFixed(2), mult.toFixed(2), `Renown ${renown}`);
  assert.equal(renownMultiplier(0), 1);
});

test('the multiplier follows total Renown earned, so spending never weakens the town', () => {
  let s = { ...fresh(), prestige: { ...fresh().prestige, renown: 40, renownTotal: 40 } };
  const before = globalMultiplier(s);
  assert.equal(before, renownMultiplier(40));
  const r = buyUpgrade(s, 'purse');
  assert.ok(r.ok);
  assert.equal(r.state.prestige.renown, 40 - upgradeCost(s, DATA.renownById.purse));
  assert.equal(globalMultiplier(r.state), before);
  // An older save with no total reads its balance instead.
  assert.equal(renownTotal({ prestige: { renown: 12 } }), 12);
  // The multiplier reaches production, the stipend and tribute.
  const base = flows(fresh()).gross.gold;
  assert.ok(Math.abs(flows(s).gross.gold - base * before) < 1e-9);
  assert.ok(Math.abs(collectTribute(s).gain - before * (1 + DATA.engage.rally.tributeSeconds * 0.5)) < 1e-9);
  const market = withBuildings(fresh(), { market: 3 });
  const rich40 = { ...market, prestige: s.prestige };
  assert.ok(Math.abs(outputOf(rich40, DATA.buildingById.market) - outputOf(market, DATA.buildingById.market) * before) < 1e-9);
});

test('Renown gain is the square root of the run gold over a million, rounded down', () => {
  const gain = (g) => renownGain(withRun(fresh(), g));
  assert.equal(gain(0), 0);
  assert.equal(gain(999_999), 0);
  assert.equal(gain(1e6), 1);
  assert.equal(gain(3.99e6), 1);
  assert.equal(gain(4e6), 2);
  assert.equal(gain(225e6), 15);
  assert.equal(gain(1e10), 100);
  assert.equal(goldForGain(15), 225e6 / K);
  // The Archives add 2% a level, rounded down.
  const arch = (lvl, g) => renownGain(withBuildings(withRun(fresh(), g), { archives: lvl }));
  assert.equal(arch(5, 1e10), 110);
  assert.equal(arch(1, 225e6), 15);
  assert.equal(arch(50, 225e6), 30);
});

test('a Rebuild needs at least one Renown, and advice waits for the gain to match what is held', () => {
  const s = fresh();
  assert.equal(rebuildPreview(s).can, false);
  const r = rebuild(s);
  assert.equal(r.ok, false);
  assert.match(r.error, /Renown/);
  const a = rebuildPreview(withRun(s, 9e6));
  assert.equal(a.can, true);
  assert.equal(a.advised, false, 'a gain of 3 is below the floor of 15');
  assert.equal(rebuildPreview(withRun(s, 225e6)).advised, true);
  const held = { ...withRun(s, 225e6), prestige: { ...s.prestige, renown: 30, renownTotal: 30 } };
  assert.equal(rebuildPreview(held).advised, false, 'gain 15 is under the 30 already held');
  assert.equal(rebuildPreview(held).adviceAt, 30);
  assert.equal(rebuildPreview(held).multiplierAfter, renownMultiplier(45));
});

test('Rebuild resets exactly the listed state and keeps the rest', () => {
  const s0 = midgame();
  assert.ok(s0.quests.active.length === 1 && s0.alchemy.queue.length === 1 && s0.heroes[0].injury > 0);
  const r = rebuild(s0);
  assert.ok(r.ok, r.error);
  const s = r.state;
  const gain = Math.floor(Math.sqrt(4.5e8 / 1e6));
  assert.equal(r.gain, gain);
  assert.equal(gain, 21);

  // Resets
  assert.deepEqual(s.res, { ...Object.fromEntries(DATA.resources.map((x) => [x.id, 0])), gold: 10 + 100 });
  assert.deepEqual(s.town, { buildings: Object.fromEntries(Object.keys(s0.town.buildings).map((id) => [id, 0])), workers: {}, townHall: 1, residents: 0, arrival: 0, perks: {}, edict: null });
  assert.deepEqual(s.tavern, newTavern());
  assert.deepEqual(s.quests.board, []);
  assert.deepEqual(s.quests.active, []);
  assert.deepEqual(s.quests.orders, []);
  assert.equal(s.quests.focus, null);
  assert.equal(s.quests.counter, 0);
  assert.deepEqual(s.alchemy, newAlchemy());
  for (const z of Object.values(s.zones)) { assert.deepEqual(z.cleared, []); assert.equal(z.trophies, 0); }
  assert.equal(s.heroes.every((h) => h.injury === 0), true);
  assert.equal(s.stats.lifetimeGold, 0);
  assert.equal(s.stats.runFrom, s0.stats.playSeconds);

  // Keeps
  assert.deepEqual(s.heroes.map((h) => ({ ...h, injury: 0 })), s0.heroes.map((h) => ({ ...h, injury: 0 })));
  assert.deepEqual(s.items, s0.items);
  assert.equal(s.zones.elwynn.rep, 150);
  assert.equal(s.zones.elwynn.story, 2);
  assert.equal(s.zones.westfall.rep, 40);
  assert.equal(s.zones.westfall.story, 1);
  assert.deepEqual(s.quests.history, s0.quests.history);
  assert.equal(s.quests.seq, s0.quests.seq);
  assert.equal(s.quests.orderSeq, s0.quests.orderSeq);
  assert.deepEqual(s.settings, s0.settings);
  assert.deepEqual(s.counters, s0.counters);
  assert.equal(s.seed, s0.seed);
  assert.equal(s.stats.questsDone, 77);
  assert.equal(s.stats.tributes, 9);
  assert.equal(s.stats.recentWins, 4);
  assert.equal(s.stats.playSeconds, s0.stats.playSeconds);
  assert.equal(s.prestige.legacy, 3);
  assert.equal(s.prestige.sands, 1);
  assert.deepEqual(s.prestige.upgrades, { purse: 1 });

  // Gains
  assert.equal(s.prestige.renown, 5 + gain);
  assert.equal(s.prestige.renownTotal, 20 + gain);
  assert.equal(s.stats.rebuilds, 1);
  assert.equal(s.stats.pastGold, 4.5e8 / K);
  assert.equal(totalGold(s), 4.5e8 / K);
  assert.match(s.log[0].text, /Rebuild 1/);
  assert.match(s.log[0].text, /1 party/);
  assert.equal(s.log.length, Math.min(DATA.economy.logLimit, s0.log.length + 1));
});

test('every top-level piece of state is covered by the reset-or-keep rules', () => {
  const s0 = midgame();
  const s = rebuild(s0).state;
  const reset = ['res', 'town', 'tavern', 'alchemy', 'raids', 'rally', 'buffs', 'event', 'events'];
  const partial = ['quests', 'zones', 'heroes', 'prestige', 'stats', 'log'];
  const kept = ['v', 'seed', 'items', 'counters', 'settings', 'savedAt', 'achievements', 'era', 'hall', 'journal'];
  assert.deepEqual(Object.keys(s0).sort(), [...reset, ...partial, ...kept].sort(), 'a new state key needs a decision in the Rebuild');
  for (const k of kept) assert.deepEqual(s[k], s0[k], k);
});

test('the Rebuild is repeatable and the totals add up', () => {
  let s = withRun(fresh(), 16e6);
  s = rebuild(s).state;
  assert.equal(s.prestige.renown, 4);
  s = withRun(s, 36e6);
  const r = rebuild(s);
  assert.equal(r.gain, 6);
  assert.equal(r.state.prestige.renown, 10);
  assert.equal(r.state.prestige.renownTotal, 10);
  assert.equal(r.state.stats.rebuilds, 2);
  assert.equal(r.state.stats.pastGold, 52e6 / K);
  assert.equal(rebuild(r.state).ok, false, 'a fresh run has no Renown to claim');
});

test('a rebuilt town plays on: it earns, saves and survives offline time', () => {
  let s = rebuild(withRun(fresh(), 16e6)).state;
  assert.equal(s.res.gold, 10);
  const built = buyBuilding(withRes(s, { gold: 500, lumber: 500 }), 'market', 1);
  assert.ok(built.ok, built.error);
  s = built.state;
  const later = advance({ ...s, savedAt: 0 }, 3600_000).state;
  assert.ok(later.res.gold > s.res.gold);
  const again = deserialize(serialize(later));
  assert.equal(again.prestige.renownTotal, 4);
  assert.equal(again.stats.rebuilds, 1);
});

test('Seed Purse, Old Foundations and Head Start set up the next run', () => {
  const lv = (ups) => withUpgrades(withRun(fresh(), 16e6), ups);
  assert.equal(startingResources(lv({ purse: 3 })).gold, 10 + 1600);
  const t = startingTown(lv({ headstart: 3, foundations: 2 }));
  assert.equal(t.townHall, 4);
  assert.equal(t.buildings.market, 4);
  assert.equal(t.buildings.quarry, 4);
  assert.equal(t.buildings.warehouse, 4);
  assert.equal(t.buildings.mine, 0, 'only the listed buildings are gifted');
  assert.equal(startingTown(lv({ foundations: 1 })).buildings.quarry, 0, 'a building not yet unlocked is not gifted');
  assert.equal(startingTown(lv({ foundations: 1 })).buildings.market, 2);
  const top = startingTown(lv({ headstart: 6, foundations: 5 }));
  assert.equal(top.townHall, 7);
  assert.equal(top.buildings.house, 10);
  const r = rebuild(lv({ headstart: 2, purse: 1, foundations: 1 })).state;
  assert.equal(r.town.townHall, 3);
  assert.equal(r.res.gold, 110);
  assert.equal(levelOf(r, 'farm'), 2);
});

test("Scouts' Maps clear the gate dungeons at the start of a run", () => {
  const base = withRun(fresh(), 16e6);
  const none = rebuild(base).state;
  assert.equal(zoneOpen(none, 'westfall'), false);
  const one = rebuild(withUpgrades(base, { scouts: 1 })).state;
  assert.deepEqual(one.zones.elwynn.cleared, ['fargodeep_mine']);
  assert.equal(zoneOpen(one, 'westfall'), true);
  assert.equal(zoneOpen(one, 'duskwood'), false);
  assert.equal(one.zones.elwynn.trophies, 0);
  const two = rebuild(withUpgrades(base, { scouts: 2 })).state;
  assert.deepEqual(two.zones.westfall.cleared, ['the_deadmines']);
  assert.equal(zoneOpen(two, 'duskwood'), true);
});

test('economy upgrades: gold, raw output, storage and the stipend', () => {
  const s = withBuildings(fresh(), { market: 5, lumber_camp: 5, farm: 5, quarry: 5, mine: 5 });
  const u = withUpgrades(s, { ledgers: 2, hands: 3, cellars: 1 });
  const out = (st, id) => outputOf(st, DATA.buildingById[id]);
  assert.ok(Math.abs(out(u, 'market') - out(s, 'market') * 1.2) < 1e-9);
  assert.ok(Math.abs(out(u, 'lumber_camp') - out(s, 'lumber_camp') * 1.35) < 1e-9);
  assert.ok(Math.abs(out(u, 'quarry') - out(s, 'quarry') * 1.35) < 1e-9);
  assert.ok(Math.abs(out(u, 'farm') - out(s, 'farm') * 1.35) < 1e-9);
  assert.equal(out(u, 'mine'), out(s, 'mine'), 'ore is not raised by Many Hands');
  assert.ok(Math.abs(flows(u).gross.gold - (flows(s).gross.gold - out(s, 'market')) - out(u, 'market') - DATA.economy.stipendGoldPerSec * 0.2) < 1e-9, 'the stipend gains Merchant Ledgers');
  assert.ok(Math.abs(storageCap(u, 'lumber') - storageCap(s, 'lumber') * 1.15) < 1e-9);
  assert.equal(storageCap(u, 'gold'), Infinity);
  assert.equal(storageCap(u, 'iron_ore'), Infinity);
});

test('town upgrades: building and Town Hall discounts, housing, food', () => {
  const s = fresh();
  const u = withUpgrades(s, { masons: 4, charter: 2, cottages: 3, larders: 5 });
  const mkt = DATA.buildingById.market;
  assert.ok(Math.abs(costOf(mkt, 3, 2, ecoFor(u)).gold - costOf(mkt, 3, 2).gold * 0.8) < 1e-9);
  assert.equal(ecoFor(s), DATA.economy, 'no discount leaves the economy untouched');
  const th = townHallCostFor(u, 2);
  assert.ok(Math.abs(th.gold - DATA.townHall.levels[0].cost.gold * 0.9) < 1e-9);
  assert.deepEqual(townHallCostFor(s, 2), DATA.townHall.levels[0].cost);
  assert.equal(housingCapacity(u), housingCapacity(s) + 6);
  assert.ok(Math.abs(foodPerResident(u) - DATA.economy.residents.foodPerSecEach * 0.5) < 1e-12);
  // The discount is what is really charged.
  let buy = withRes(u, { gold: 1000, lumber: 1000 });
  const cheap = buyBuilding(buy, 'market', 1);
  const full = buyBuilding(withRes(s, { gold: 1000, lumber: 1000 }), 'market', 1);
  assert.ok(Math.abs(cheap.cost.gold - full.cost.gold * 0.8) < 1e-9);
  buy = withRes(u, { gold: 1000, lumber: 1000 });
  const hall = buyTownHall(buy);
  assert.ok(hall.ok);
  assert.ok(Math.abs(hall.cost.gold - 378 * 0.9) < 1e-6);
  // Residents eat less in the tick.
  const eaters = { ...withRes(u, { food: 100 }), town: { ...u.town, residents: 10, arrival: 0 } };
  const plain = { ...withRes(s, { food: 100 }), town: { ...s.town, residents: 10, arrival: 0 } };
  const left = (st) => 100 - step(st, 10).res.food;
  assert.ok(Math.abs(left(eaters) - left(plain) * 0.5) < 1e-6);
});

test('maxAffordable agrees with the discounted price', () => {
  const hall = (st) => ({ ...withRes(st, { gold: 40_000, lumber: 1e9 }), town: { ...st.town, townHall: 6 } });
  const u = hall(withUpgrades(fresh(), { masons: 6 }));
  const r = buyBuilding(u, 'market', 'max');
  assert.ok(r.ok, r.error);
  const eco = ecoFor(u);
  assert.ok(r.cost.gold <= 40_000);
  // One level more would not have fit.
  assert.ok(costOf(DATA.buildingById.market, 0, r.bought + 1, eco).gold > 40_000);
  assert.ok(r.bought > buyBuilding(hall(fresh()), 'market', 'max').bought);
});

test('hero upgrades: experience, recruiting, recovery, roster and forging', () => {
  let s = rich(fresh());
  s = withBuildings({ ...s, town: { ...s.town, townHall: 6 } }, { tavern: 5, blacksmith: 2, chapel: 2 });
  s = step(s, 0.1);
  s = recruitHero(s, s.tavern.pool[0].id).state;
  const hero = s.heroes[0];
  const u = withUpgrades(s, { lessons: 3, reputation: 4, bedrest: 2, bunks: 2, forgelore: 3 });
  assert.ok(Math.abs(sheetOf(u, hero).xpMult - (sheetOf(s, hero).xpMult + 0.35)) < 1e-9);
  assert.ok(Math.abs(sheetOf(u, hero).recovery - (sheetOf(s, hero).recovery + 0.4)) < 1e-9);
  assert.ok(restRate(u, hero) > restRate(s, hero));
  const cand = { level: 4 };
  assert.ok(Math.abs(recruitCost(u, cand) - recruitCost(s, cand) * 0.6) <= 1);
  assert.equal(rosterCap(u), rosterCap(s) + 2);
  assert.equal(rosterCap(withUpgrades(fresh(), { bunks: 3 })), 0, 'no Tavern, no roster');
  const sw = DATA.zonesData.recruits[0];
  assert.ok(Math.abs(swornCost(u, sw) - swornCost(s, sw) * 0.6) <= 1);
  const c0 = craftCost(s, 'weapon', 1);
  const c1 = craftCost(u, 'weapon', 1);
  for (const id of Object.keys(c0)) assert.ok(Math.abs(c1[id] - c0[id] * 0.7) <= 1, id);
});

function quest(s0) {
  let s = s0;
  const offer = s.quests.board.find((o) => o.type === 'bounty');
  const sent = dispatchQuest(s, offer.id, [s.heroes[0].id]);
  assert.ok(sent.ok, sent.error);
  return { s: sent.state, offer };
}

function questTown() {
  let s = rich(fresh());
  s = { ...s, town: { ...s.town, townHall: 6 } };
  s = withBuildings(s, { tavern: 5, barracks: 2, house: 6 });
  s = step(s, 0.1);
  s = recruitHero(s, s.tavern.pool[0].id).state;
  s = { ...s, heroes: s.heroes.map((h) => ({ ...h, level: 25 })) };
  return step(s, 0.1);
}

test('quest upgrades: gold, speed, board timer and reputation', () => {
  const s = questTown();
  const u = withUpgrades(s, { bounties: 4, roads: 5, notices: 2, standing: 5 });
  const offer = s.quests.board.find((o) => o.type === 'bounty');
  assert.ok(Math.abs(rewardFor(u, offer, 1).gold - rewardFor(s, offer, 1).gold * 1.5) <= 1);
  assert.equal(questSpeedMultiplier(s), 1);
  assert.equal(questSpeedMultiplier(u), 1.5);

  // The boosted party is home sooner and earns more standing for the same bounty.
  const a = quest(s);
  const b = quest(u);
  const runs = (x) => x.s.quests.active[0].remaining;
  assert.equal(runs(a), runs(b));
  const done = (x) => { let st = x.s; for (let i = 0; i < 400 && st.quests.active.length; i += 1) st = step(st, 5); return st; };
  const timeTo = (x) => { let st = x.s; let t = 0; while (st.quests.active.length && t < 2e5) { st = step(st, 1); t += 1; } return t; };
  assert.ok(timeTo(b) < timeTo(a) * 0.75, 'Marked Roads shortens the trip');
  const ra = done(a);
  const rb = done(b);
  assert.equal(ra.quests.history.at(-1).ok, true);
  assert.equal(rb.quests.history.at(-1).ok, true);
  const gain = (st) => st.zones.elwynn.rep - s.zones.elwynn.rep;
  assert.equal(gain(rb), Math.round(gain(ra) * 1.75));

  // New notices arrive sooner. Take the board down so it needs refilling.
  const empty = (st) => ({ ...st, quests: { ...st.quests, board: [], counter: 5, refreshIn: DATA.quests.board.refreshSeconds * (1 - bonusOf(st, 'boardRefresh')) } });
  const first = (st) => { let x = empty(st); let t = 0; while (regularCount(x) === 0 && t < 5000) { x = step(x, 1); t += 1; } return t; };
  const slow = DATA.quests.board.refreshSeconds;
  assert.ok(Math.abs(first(s) - slow) <= 1);
  assert.ok(Math.abs(first(u) - slow * 0.8) <= 1);
});

test('shop purchases spend Renown, stop at the top and refuse when short', () => {
  const s = { ...fresh(), prestige: { ...fresh().prestige, renown: 10, renownTotal: 10 } };
  const up = DATA.renownById.purse;
  assert.equal(upgradeCost(s, up), 3);
  const one = buyUpgrade(s, 'purse');
  assert.ok(one.ok);
  assert.equal(one.state.prestige.renown, 7);
  assert.equal(one.state.prestige.upgrades.purse, 1);
  assert.equal(upgradeCost(one.state, up), 6);
  assert.equal(bonusOf(one.state, 'startGold'), 100);
  assert.equal(buyUpgrade({ ...s, prestige: { ...s.prestige, renown: 2 } }, 'purse').ok, false);
  assert.equal(buyUpgrade(s, 'nothing').ok, false);
  let t = { ...s, prestige: { ...s.prestige, renown: 1e6 } };
  for (let i = 0; i < up.values.length; i += 1) t = buyUpgrade(t, 'purse').state;
  assert.equal(upgradeLevel(t, 'purse'), 6);
  assert.equal(upgradeCost(t, up), null);
  const r = buyUpgrade(t, 'purse');
  assert.equal(r.ok, false);
  assert.match(r.error, /highest/);
  assert.equal(valueAt(up, 99), 100000, 'a level past the top reads the last value');
});

test('every shop upgrade does something to the game', () => {
  const s = rich(questTown());
  const probe = {
    startGold: (u) => startingResources(u).gold > startingResources(s).gold,
    goldBoost: (u) => flows(u).gross.gold > flows(s).gross.gold,
    rawBoost: (u) => outputOf(withBuildings(u, { farm: 3 }), DATA.buildingById.farm) > outputOf(withBuildings(s, { farm: 3 }), DATA.buildingById.farm),
    storageBoost: (u) => storageCap(u, 'stone') > storageCap(s, 'stone'),
    foundations: (u) => startingTown(u).buildings.market > startingTown(s).buildings.market,
    xp: (u) => sheetOf(u, u.heroes[0]).xpMult > sheetOf(s, s.heroes[0]).xpMult,
    recruitDiscount: (u) => recruitCost(u, { level: 3 }) < recruitCost(s, { level: 3 }),
    recovery: (u) => sheetOf(u, u.heroes[0]).recovery > sheetOf(s, s.heroes[0]).recovery,
    rosterSlots: (u) => rosterCap(u) > rosterCap(s),
    forgeDiscount: (u) => craftCost(u, 'weapon', 1).gold < craftCost(s, 'weapon', 1).gold,
    questGold: (u) => rewardFor(u, u.quests.board.find((o) => o.type === 'bounty'), 1).gold > rewardFor(s, s.quests.board.find((o) => o.type === 'bounty'), 1).gold,
    questSpeed: (u) => questSpeedMultiplier(u) > questSpeedMultiplier(s),
    boardRefresh: (u) => step({ ...u, quests: { ...u.quests, board: [], counter: 4, refreshIn: 500 } }, 1).quests.refreshIn <= 500,
    repGain: () => true,
    scouts: (u) => rebuild(withRun(u, 4e6)).state.zones.elwynn.cleared.length > 0,
    townHall: (u) => startingTown(u).townHall > startingTown(s).townHall,
    buildingDiscount: (u) => costOf(DATA.buildingById.market, 2, 1, ecoFor(u)).gold < costOf(DATA.buildingById.market, 2, 1).gold,
    townHallDiscount: (u) => townHallCostFor(u, 3).gold < townHallCostFor(s, 3).gold,
    housing: (u) => housingCapacity(u) > housingCapacity(s),
    foodSaver: (u) => foodPerResident(u) < foodPerResident(s),
  };
  for (const up of DATA.renown.upgrades) {
    assert.ok(probe[up.key], `no probe for ${up.key}`);
    const u = withUpgrades(s, { [up.id]: up.values.length });
    assert.ok(probe[up.key](u), `${up.id} (${up.key}) had no effect`);
  }
  assert.equal(Object.keys(probe).length, DATA.renown.upgrades.length);
});

test('the Archives is a live building that raises Renown gain', () => {
  const def = DATA.buildingById.archives;
  assert.equal(def.kind, 'archives');
  assert.equal(def.unlockTownHall, 14);
  let s = rich(fresh());
  s = { ...s, town: { ...s.town, townHall: 14 } };
  const r = buyBuilding(s, 'archives', 1);
  assert.ok(r.ok, r.error);
  assert.equal(levelOf(r.state, 'archives'), 1);
  assert.equal(buyBuilding({ ...fresh(), ...withRes(fresh(), { gold: 1e12 }) }, 'archives', 1).ok, false, 'locked below Town Hall 14');
  // A Rebuild resets the Archives like any other building.
  const reb = rebuild(withRun(r.state, 4e8)).state;
  assert.equal(levelOf(reb, 'archives'), 0);
});

test('v6 saves migrate to v7 and keep their Renown', () => {
  const base = newState({ seed: 4, now: 1000 });
  const old = JSON.parse(JSON.stringify({ ...base, v: 6 }));
  delete old.prestige.renownTotal;
  delete old.stats.pastGold;
  delete old.stats.runFrom;
  old.prestige.renown = 12;
  old.prestige.upgrades = { purse: 2 };
  const m = normalize(migrate(old, MIGRATIONS, SAVE_VERSION));
  assert.equal(m.v, SAVE_VERSION);
  assert.equal(m.prestige.renown, 12);
  assert.equal(m.prestige.renownTotal, 12);
  assert.deepEqual(m.prestige.upgrades, { purse: 2 });
  assert.equal(m.stats.pastGold, 0);
  assert.equal(m.stats.runFrom, 0);
});

test('normalize repairs hand-edited Renown and shop data', () => {
  const s = JSON.parse(JSON.stringify(fresh()));
  s.prestige = { renown: 9, renownTotal: 3, legacy: -4, sands: 'x', upgrades: { purse: 99, ledgers: -2, nothing: 4, hands: 2.7, scouts: 'many' } };
  s.stats.runFrom = 99999;
  s.stats.pastGold = -5;
  const n = normalize(s);
  assert.equal(n.prestige.renown, 9);
  assert.equal(n.prestige.renownTotal, 9, 'the total is never below the balance');
  assert.equal(n.prestige.legacy, 0);
  assert.equal(n.prestige.sands, 0);
  assert.deepEqual(n.prestige.upgrades, { purse: 6, hands: 2 });
  assert.equal(n.stats.runFrom, 0, 'the run cannot start after now');
  assert.equal(n.stats.pastGold, 0);
});

test('Renown and the shop survive an export and import round trip', () => {
  let s = withUpgrades(withRun(fresh(), 4e6), { purse: 2, headstart: 1 });
  s = rebuild(s).state;
  const back = deserialize(serialize(s));
  assert.deepEqual(back.prestige, s.prestige);
  assert.deepEqual(back.stats, s.stats);
  assert.deepEqual(back.town, s.town);
});
