import test from 'node:test';
import assert from 'node:assert/strict';
import { stepQuests, rollOffer, isStory, regularCount, rewardFor, heroXpFor, startRun, oddsFor } from '../src/engine/quests.js';
import { refreshPool, recruitHero, dispatchQuest, recruitSworn, brewPotion, cancelBrew, createOrder, removeOrder, pauseOrder, setOrderOdds, setQuestFocus, craftCost } from '../src/engine/actions.js';
import { zoneOpen, openZones, repInfo, perks, nextStory, recruitStatus, tierIndex } from '../src/engine/zones.js';
import { orderSlots, smartOrders } from '../src/engine/orders.js';
import { stockCap, brewSpeed, potionStock } from '../src/engine/alchemy.js';
import { heroUnit } from '../src/engine/combat.js';
import { step } from '../src/engine/tick.js';
import { advance } from '../src/engine/offline.js';
import { serialize, deserialize, normalize, migrate, MIGRATIONS } from '../src/engine/save.js';
import { validateData, DATA as D } from '../src/engine/data.js';

const OB = D.quests.orders;
const BAR = OB.barracks;
const SMART = OB.smartBarracks;
import { newState, SAVE_VERSION } from '../src/engine/state.js';
import { fresh, withRes, withBuildings, DATA, T0 } from './helpers.js';

const rich = (s) => withRes(s, { gold: 1e12, lumber: 1e12, stone: 1e12, iron_bars: 1e9, iron_ore: 1e9, food: 1e9, herbs: 1e6, leather: 1e6 });

// A strong party that wins any Elwynn quest, in a town with the buildings the new systems want.
function town(heroCount = 3, extra = {}) {
  let s = rich(fresh());
  s = { ...s, town: { ...s.town, townHall: 10 } };
  s = withBuildings(s, { tavern: 9, barracks: 4, alchemy_lab: 5, chapel: 5, blacksmith: 1, house: 20, ...extra });
  s = step(s, 0.1);
  for (let i = 0; i < heroCount; i += 1) {
    if (!s.tavern.pool.some((c) => !c.hired)) s = refreshPool(s).state;
    const r = recruitHero(s, s.tavern.pool.filter((c) => !c.hired)[0].id);
    assert.ok(r.ok, r.error);
    s = r.state;
  }
  s = { ...s, heroes: s.heroes.map((h) => ({ ...h, level: 40 })) };
  return step(s, 0.1);
}
const finish = (s, secs = 4000) => { for (let i = 0; i < secs / 5; i += 1) s = step(s, 5); return s; };

test('shipped zone, story and crafting data validates; broken data is caught', () => {
  assert.deepEqual(validateData(DATA), []);
  const bad = structuredClone(DATA);
  bad.zonesData.zones[1].gate = { zone: 'elwynn', dungeon: 'nowhere' };
  bad.zoneList = bad.zonesData.zones.filter((z) => !z.planned);
  bad.zoneById = Object.fromEntries(bad.zoneList.map((z) => [z.id, z]));
  assert.ok(validateData(bad).some((p) => p.includes('gate')));
  const bad2 = structuredClone(DATA);
  bad2.crafting.potions[0].effect = { luck: 1 };
  assert.ok(validateData(bad2).some((p) => p.includes('unknown effect')));
});

test('only Elwynn is open at the start; clearing a dungeon opens the next zone', () => {
  let s = town();
  assert.deepEqual(openZones(s).map((z) => z.id), ['elwynn']);
  assert.equal(zoneOpen(s, 'westfall'), false);
  s = { ...s, zones: { ...s.zones, elwynn: { ...s.zones.elwynn, cleared: ['fargodeep_mine'] } } };
  assert.equal(zoneOpen(s, 'westfall'), true);
  assert.equal(zoneOpen(s, 'duskwood'), false);
  s = { ...s, zones: { ...s.zones, westfall: { ...s.zones.westfall, cleared: ['the_deadmines'] } } };
  assert.equal(zoneOpen(s, 'duskwood'), true);
});

test('the board only offers quests from open zones and honours the focus', () => {
  let s = town();
  for (let n = 1; n < 80; n += 1) assert.equal(rollOffer(s, n).zone, 'elwynn');
  s = { ...s, zones: { ...s.zones, elwynn: { ...s.zones.elwynn, cleared: ['fargodeep_mine'] } } };
  const zones = new Set();
  for (let n = 1; n < 80; n += 1) zones.add(rollOffer(s, n).zone);
  assert.deepEqual([...zones].sort(), ['elwynn', 'westfall']);
  const f = setQuestFocus(s, 'westfall');
  assert.ok(f.ok);
  for (let n = 1; n < 40; n += 1) assert.equal(rollOffer(f.state, n).zone, 'westfall');
  assert.equal(setQuestFocus(s, 'duskwood').ok, false, 'a closed zone cannot be focused');
  assert.ok(setQuestFocus(f.state, null).ok);
});

test('every zone offers every quest type, with levels inside the zone range', () => {
  let s = town();
  s = { ...s, zones: { elwynn: { cleared: ['fargodeep_mine'], rep: 0, trophies: 0, story: 0 }, westfall: { cleared: ['the_deadmines'], rep: 0, trophies: 0, story: 0 }, duskwood: { cleared: [], rep: 0, trophies: 0, story: 0 } }, quests: { ...s.quests, board: [] } };
  const seen = {};
  for (let n = 1; n < 400; n += 1) {
    const o = rollOffer(s, n);
    (seen[o.zone] ??= new Set()).add(o.type);
    const z = DATA.zoneById[o.zone];
    assert.ok(o.level >= z.levels[0] && o.level <= z.levels[1], `${o.template} level ${o.level}`);
  }
  for (const z of ['elwynn', 'westfall', 'duskwood']) for (const t of ['bounty', 'gathering', 'slay', 'escort', 'dungeon']) assert.ok(seen[z].has(t), `${z} offers ${t}`);
});

test('slay and escort quests need enough heroes and run through the same resolver', () => {
  const solo = town(1);
  for (let n = 1; n < 120; n += 1) assert.ok(!['slay', 'dungeon'].includes(rollOffer(solo, n).type), 'a lone hero is never offered a slay or dungeon');
  const s = town(3);
  const slay = { ...rollOffer(s, 1), type: 'slay', template: 'stray_pack', id: 'qs', n: 500, level: 4, rec: 10, modifier: 'standard', duration: 300 };
  const s2 = { ...s, quests: { ...s.quests, board: [slay] } };
  assert.equal(dispatchQuest(s2, 'qs', [s.heroes[0].id]).ok, false, 'slay takes two or three');
  const r = dispatchQuest(s2, 'qs', [s.heroes[0].id, s.heroes[1].id]);
  assert.ok(r.ok, r.error);
  const done = finish(r.state);
  assert.equal(done.quests.history[0].type, 'slay');
  assert.ok(done.quests.history[0].xp > 0);
});

test('reputation rises with quests, sets tiers and boosts rewards', () => {
  let s = town();
  assert.equal(repInfo(s, 'elwynn').index, 0);
  const o0 = { ...rollOffer(s, 5), type: 'bounty', template: 'old_boar', modifier: 'standard', level: 3, duration: 100 };
  const base = rewardFor(s, o0, 1).gold;
  s = { ...s, zones: { ...s.zones, elwynn: { ...s.zones.elwynn, rep: 130 } } };
  assert.equal(repInfo(s, 'elwynn').index, 2);
  assert.equal(repInfo(s, 'elwynn').title, DATA.zoneById.elwynn.titles[2]);
  assert.ok(Math.abs(rewardFor(s, o0, 1).gold / base - DATA.zonesData.reputation.tiers[2].reward) < 0.01);
  // A finished bounty pays reputation and records it.
  const b = { ...rollOffer(s, 6), type: 'bounty', template: 'old_boar', id: 'qb', n: 600, level: 2, rec: 5, modifier: 'standard', duration: 60 };
  const run = dispatchQuest({ ...s, quests: { ...s.quests, board: [b] } }, 'qb', [s.heroes[0].id]);
  const after = finish(run.state, 200);
  assert.equal(after.zones.elwynn.rep, 130 + DATA.zonesData.reputation.gain.bounty);
  assert.equal(after.quests.history[0].rep, DATA.zonesData.reputation.gain.bounty);
});

test('the top reputation tier adds a permanent perk', () => {
  let s = town();
  assert.deepEqual(perks(s), { gold: 0, res: 0, xp: 0 });
  const top = DATA.zonesData.reputation.tiers.at(-1).at;
  s = { ...s, zones: { ...s.zones, elwynn: { ...s.zones.elwynn, rep: top }, duskwood: { ...s.zones.duskwood, rep: top } } };
  const p = perks(s);
  assert.equal(p.gold, DATA.zoneById.elwynn.perk.value);
  assert.equal(p.xp, DATA.zoneById.duskwood.perk.value);
  const o = rollOffer(s, 5);
  const plain = town();
  assert.ok(heroXpFor(s, s.heroes[0], o) > heroXpFor(plain, plain.heroes[0], o));
});

test('story quests are pinned, tell one chain in order and give unique rewards', () => {
  let s = town();
  s = stepQuests(s, 1);
  const first = s.quests.board.find((o) => isStory(o));
  assert.ok(first && first.template === 'st_elwynn_1', 'step one is posted');
  assert.equal(s.quests.board.filter((o) => isStory(o)).length, 1, 'only the next step is posted');
  assert.equal(regularCount(s), DATA.quests.board.startOffers);
  assert.equal(nextStory(s, 'elwynn').id, 'st_elwynn_1');
  // Win each step; the next one appears; the last pays a named item.
  for (let step_ = 1; step_ <= 3; step_ += 1) {
    const offer = s.quests.board.find((o) => isStory(o));
    assert.equal(offer.template, `st_elwynn_${step_}`);
    const size = DATA.quests.types[offer.type].party;
    const ids = s.heroes.slice(0, size[1]).map((h) => h.id);
    const r = dispatchQuest(s, offer.id, ids);
    assert.ok(r.ok, r.error);
    s = finish(r.state, 5000);
    assert.equal(s.zones.elwynn.story, step_);
    assert.equal(s.quests.history[0].story, true);
  }
  assert.equal(nextStory(s, 'elwynn'), null);
  assert.equal(s.quests.board.filter((o) => isStory(o)).length, 0);
  const named = [...s.items, ...s.heroes.flatMap((h) => Object.values(h.gear).filter(Boolean))].find((i) => i.name === "Surveyor's Lantern");
  assert.ok(named, 'the unique reward was found');
});

test('a failed story quest stays on offer', () => {
  let s = town();
  s = stepQuests(s, 1);
  const weak = { ...s, heroes: s.heroes.map((h) => ({ ...h, level: 1 })) };
  const offer = weak.quests.board.find((o) => isStory(o));
  const boosted = { ...weak, quests: { ...weak.quests, board: weak.quests.board.map((o) => (o.id === offer.id ? { ...o, rec: 400 } : o)) } };
  const r = dispatchQuest(boosted, offer.id, [boosted.heroes[0].id]);
  assert.equal(r.state.quests.active[0].success, false);
  const after = finish(r.state, 500);
  assert.equal(after.zones.elwynn.story, 0);
  assert.ok(after.quests.board.some((o) => o.template === 'st_elwynn_1'), 'it is posted again');
});

test('sworn recruits unlock through the story or reputation, once', () => {
  let s = town(2);
  const maren = DATA.recruitById.maren_holt;
  assert.equal(recruitSworn(s, 'maren_holt').ok, false, 'story step 3 is not told yet');
  s = { ...s, zones: { ...s.zones, elwynn: { ...s.zones.elwynn, story: 3 } } };
  assert.equal(recruitStatus(s, maren).met, true);
  const r = recruitSworn(s, 'maren_holt');
  assert.ok(r.ok, r.error);
  assert.equal(r.hero.sworn, 'maren_holt');
  assert.equal(r.hero.level, maren.level);
  assert.equal(recruitSworn(r.state, 'maren_holt').ok, false, 'only once');
  assert.equal(recruitStatus(r.state, maren).hired, true);
  const back = deserialize(serialize(r.state));
  assert.equal(back.heroes.find((h) => h.sworn).name, 'Maren Holt');
  // reputation route
  let t = town(2);
  t = { ...t, zones: { ...t.zones, elwynn: { ...t.zones.elwynn, rep: DATA.zonesData.reputation.tiers[3].at } } };
  assert.ok(recruitSworn(t, 'edda_stonehelm').ok);
  assert.equal(recruitSworn(t, 'jory_wickerman').ok, false, 'a closed zone has no recruits');
});

test('Westfall and the Deadmines can be cleared with a good party', () => {
  let s = town(5);
  s = { ...s, zones: { ...s.zones, elwynn: { ...s.zones.elwynn, cleared: ['fargodeep_mine'] } } };
  const offer = { ...rollOffer(s, 3), type: 'dungeon', template: 'the_deadmines', zone: 'westfall', id: 'qdm', n: 900, level: 15, rec: 15 * 1.1 ** 14 * 7.5 * 0.2, modifier: 'standard', duration: 2400, title: 'The Deadmines' };
  s = { ...s, quests: { ...s.quests, board: [offer] } };
  const r = dispatchQuest(s, 'qdm', s.heroes.map((h) => h.id));
  assert.ok(r.ok, r.error);
  assert.equal(r.state.quests.active[0].success, true);
  const done = finish(r.state, 5000);
  assert.deepEqual(done.zones.westfall.cleared, ['the_deadmines']);
  assert.ok(zoneOpen(done, 'duskwood'));
  assert.ok(done.log.some((l) => l.text.includes('Duskwood is open')), 'the log says a zone opened');
});

// ---- Standing orders ----

test('orders need the Barracks, give slots by level and reject bad parties', () => {
  const none = town(2, { barracks: 0 });
  assert.equal(orderSlots(none), 0);
  assert.equal(createOrder(none, { mode: 'repeat', template: 'old_boar', party: [none.heroes[0].id] }).ok, false);
  const s = town(3, { barracks: BAR });
  assert.equal(orderSlots(s), 1);
  assert.equal(smartOrders(s), false);
  assert.equal(createOrder(s, { mode: 'best', party: [s.heroes[0].id] }).ok, false, 'smart orders come later');
  const ok = createOrder(s, { mode: 'repeat', template: 'old_boar', party: [s.heroes[0].id] });
  assert.ok(ok.ok, ok.error);
  assert.equal(createOrder(ok.state, { mode: 'repeat', template: 'old_boar', party: [s.heroes[1].id] }).ok, false, 'no free slot');
  const s4 = town(3, { barracks: BAR + OB.levelsPerSlot });
  assert.equal(orderSlots(s4), 2);
  const a = createOrder(s4, { mode: 'repeat', template: 'old_boar', party: [s4.heroes[0].id] }).state;
  assert.equal(createOrder(a, { mode: 'repeat', template: 'wolf_pack', party: [s4.heroes[0].id] }).ok, false, 'a hero follows one order');
  assert.equal(createOrder(a, { mode: 'repeat', template: 'st_elwynn_1', party: [s4.heroes[1].id] }).ok, false, 'story quests cannot repeat');
  assert.equal(createOrder(a, { mode: 'repeat', template: 'stray_pack', party: [s4.heroes[1].id] }).ok, false, 'wrong party size');
  assert.equal(createOrder(a, { mode: 'repeat', template: 'westfall_nothing', party: [s4.heroes[1].id] }).ok, false);
  assert.equal(createOrder(a, { mode: 'repeat', template: 'wf_roadblock', party: [s4.heroes[1].id] }).ok, false, 'closed zone');
});

test('a repeat order keeps sending the party out, and pausing stops it', () => {
  let s = town(2, { barracks: BAR });
  s = createOrder(s, { mode: 'repeat', template: 'old_boar', party: [s.heroes[0].id], minOdds: 0 }).state;
  s = step(s, 1);
  assert.equal(s.quests.active.length, 1, 'the order dispatched');
  assert.equal(s.quests.active[0].order, 'o1');
  const before = s.stats.questsDone;
  s = finish(s, 1200);
  assert.ok(s.stats.questsDone - before >= 3, 'it kept going');
  const p = pauseOrder(s, 'o1', true).state;
  const settled = finish(p, 600);
  const doneNow = settled.stats.questsDone;
  assert.equal(finish(settled, 600).stats.questsDone, doneNow, 'a paused order sends nobody');
  assert.ok(s.quests.orders[0].runs >= 3);
  assert.equal(removeOrder(s, 'o1').state.quests.orders.length, 0);
});

test('an order waits while a hero is hurt or the odds are below its line', () => {
  let s = town(1, { barracks: BAR });
  const hurt = { ...s, heroes: s.heroes.map((h) => ({ ...h, injury: 50 })) };
  const o = createOrder(hurt, { mode: 'repeat', template: 'old_boar', party: [s.heroes[0].id], minOdds: 0 }).state;
  assert.equal(step(o, 1).quests.active.length, 0, 'a resting hero is left alone');
  // A weak pair against a risky line: the order will not go until the line is lowered.
  let two = town(2, { barracks: BAR });
  two = { ...two, heroes: two.heroes.map((h) => ({ ...h, level: 1, gear: { ...h.gear, weapon: null } })) };
  let w = createOrder(two, { mode: 'repeat', template: 'kobold_warren', party: two.heroes.map((h) => h.id), minOdds: 0.9 }).state;
  w = step(w, 1);
  assert.equal(w.quests.active.length, 0);
  assert.match(w.quests.orders[0].note, /^odds:/);
  assert.ok(w.quests.orders[0].wait > 0);
  const lowered = setOrderOdds(w, 'o1', 0).state;
  assert.equal(step(lowered, 1).quests.active.length, 1, 'lowering the line sends the party');
});

test('a best-available order takes the hardest notice the party can win', () => {
  let s = town(2, { barracks: SMART });
  s = stepQuests(s, 1);
  const ids = s.heroes.map((h) => h.id);
  s = createOrder(s, { mode: 'best', party: ids.slice(0, 1), minOdds: 0.5 }).state;
  const boardBefore = s.quests.board.length;
  s = step(s, 1);
  assert.equal(s.quests.active.length, 1);
  assert.equal(s.quests.board.length, boardBefore - 1, 'the notice left the board');
  assert.ok(!isStory(s.quests.active[0].offer), 'story quests are left for the player');
});

test('orders catch up offline without losing the partial trip', () => {
  let s = town(2, { barracks: BAR });
  s = createOrder(s, { mode: 'repeat', template: 'old_boar', party: [s.heroes[0].id], minOdds: 0 }).state;
  s = step(s, 1);
  const { state, report } = advance({ ...s, savedAt: T0 }, T0 + 3600 * 1000, DATA);
  const run = state.quests.history.length;
  assert.ok(report.quests.done >= 5, `an hour away (about half an hour credited) of orders did ${report.quests.done}`);
  assert.ok(run > 0 && state.quests.orders[0].runs === report.quests.done || state.quests.orders[0].runs >= report.quests.done - 1);
});

// ---- Potions ----

test('potions brew over time, cost herbs, and are limited by the Lab', () => {
  let s = town(2, { alchemy_lab: 1 });
  assert.equal(brewPotion(s, 'might').ok, false, 'needs Lab level 3');
  const before = s;
  const r = brewPotion(s, 'vigour');
  assert.ok(r.ok, r.error);
  s = r.state;
  assert.ok(Math.abs(s.res.herbs - (before.res.herbs - DATA.potionById.vigour.cost.herbs)) < 1, 'the herbs were spent');
  assert.equal(s.alchemy.queue.length, 1);
  assert.equal(potionStock(s, 'vigour'), 0);
  s = step(s, DATA.potionById.vigour.seconds / brewSpeed(s) + 1);
  assert.equal(potionStock(s, 'vigour'), 1);
  assert.equal(s.alchemy.queue.length, 0);
  const c = brewPotion(s, 'vigour').state;
  const refund = cancelBrew(c, 0);
  assert.equal(refund.state.res.herbs, s.res.herbs, 'cancelling refunds');
  let q = s;
  for (let i = 0; i < DATA.crafting.brew.queueMax; i += 1) q = brewPotion(q, 'vigour').state;
  assert.equal(brewPotion(q, 'vigour').ok, false, 'the queue is full');
  assert.equal(brewPotion(withRes(s, { herbs: 0 }), 'vigour').ok, false);
  assert.ok(stockCap(s) >= DATA.crafting.brew.stockBase);
});

test('Gnomes in the roster speed brewing up', () => {
  const s = town(1, { alchemy_lab: 1 });
  const plain = brewSpeed({ ...s, heroes: s.heroes.map((h) => ({ ...h, race: 'human', trait: 'cheerful' })) });
  const gnome = brewSpeed({ ...s, heroes: s.heroes.map((h) => ({ ...h, race: 'gnome', trait: 'cheerful' })) });
  assert.ok(Math.abs(gnome / plain - 1.1) < 1e-9);
});

test('a potion strengthens the party for one quest and is used up', () => {
  let s = town(2, { alchemy_lab: 5 });
  s = { ...s, alchemy: { ...s.alchemy, stock: { might: 4, vigour: 1 } } };
  const h = s.heroes[0];
  assert.ok(heroUnit(s, h, DATA, 'might').power > heroUnit(s, h, DATA).power);
  assert.ok(Math.abs(heroUnit(s, h, DATA, 'might').power / heroUnit(s, h, DATA).power - 1.2) < 0.01);
  const o = { ...rollOffer(s, 4), type: 'bounty', template: 'old_boar', id: 'qp', n: 700, level: 3, rec: 6, modifier: 'standard', duration: 60 };
  const board = { ...s, quests: { ...s.quests, board: [o] } };
  assert.equal(dispatchQuest(board, 'qp', [h.id], DATA, 'vigour').ok, true);
  const two = dispatchQuest(board, 'qp', [h.id, s.heroes[1].id], DATA, 'vigour');
  assert.equal(two.ok, false, 'a bounty is one hero, and one Vigour only covers one');
  const r = dispatchQuest(board, 'qp', [h.id], DATA, 'might');
  assert.equal(potionStock(r.state, 'might'), 3);
  assert.equal(r.state.quests.active[0].potion, 'might');
  assert.ok(oddsFor(board, o, [h.id], DATA, 'might') >= oddsFor(board, o, [h.id], DATA));
  assert.equal(dispatchQuest(board, 'qp', [h.id], DATA, 'ward').ok, false, 'none in stock');
});

test('armour and bags now need leather at the forge', () => {
  const s = town(1);
  assert.ok(craftCost(s, 'chest', 1).leather > 0);
  assert.ok(craftCost(s, 'utility', 1).leather > craftCost(s, 'legs', 1).leather);
  assert.equal(craftCost(s, 'weapon', 1).leather, undefined);
});

// ---- Save v6 ----

test('a version 5 save migrates to version 6 with zones, orders and alchemy', () => {
  const v5 = JSON.parse(serialize(town(2)));
  v5.v = 5;
  delete v5.alchemy;
  v5.zones = { elwynn: { cleared: ['fargodeep_mine'], rep: 12, trophies: 1 } };
  v5.quests.orders = [];
  delete v5.quests.focus;
  const up = deserialize(JSON.stringify(v5));
  assert.equal(up.v, SAVE_VERSION);
  assert.deepEqual(Object.keys(up.zones).sort(), ['duskwood', 'elwynn', 'hellfire', 'molten', 'steppes', 'stranglethorn', 'swamp', 'westfall']);
  assert.equal(up.zones.elwynn.rep, 12);
  assert.equal(up.zones.elwynn.story, 0);
  assert.deepEqual(up.alchemy, { stock: {}, queue: [] });
  assert.equal(up.quests.focus, null);
  assert.ok(up.heroes.every((h) => h.sworn === null));
  assert.equal(MIGRATIONS.length, SAVE_VERSION - 1);
});

test('normalize repairs orders, potions, zones and story progress', () => {
  const s = town(2, { barracks: 4 });
  const raw = JSON.parse(serialize(createOrder(s, { mode: 'repeat', template: 'old_boar', party: [s.heroes[0].id] }).state));
  raw.alchemy = { stock: { vigour: 3, ghost: 9, might: -2 }, queue: [{ id: 'vigour', left: 9999 }, { id: 'nope', left: 1 }] };
  raw.zones.elwynn.story = 99;
  raw.zones.westfall.cleared = ['fargodeep_mine', 'the_deadmines'];
  raw.quests.focus = 'atlantis';
  raw.quests.orders.push({ id: 'o9', mode: 'repeat', template: 'old_boar', party: [s.heroes[0].id] }, { id: 'o8', mode: 'repeat', template: 'st_elwynn_1', party: [s.heroes[1].id] }, { id: 'o7', mode: 'best', party: ['h404'] });
  const n = normalize(raw);
  assert.deepEqual(n.alchemy.stock, { vigour: 3 });
  assert.equal(n.alchemy.queue.length, 1);
  assert.ok(n.alchemy.queue[0].left <= DATA.potionById.vigour.seconds);
  assert.equal(n.zones.elwynn.story, DATA.quests.templates.filter((t) => t.story?.zone === 'elwynn').length);
  assert.deepEqual(n.zones.westfall.cleared, ['the_deadmines']);
  assert.equal(n.quests.focus, null);
  assert.equal(n.quests.orders.length, 1, 'duplicate heroes, story repeats and unknown heroes are dropped');
});

test('a long run across zones keeps every invariant', () => {
  let s = town(4, { barracks: SMART + 2 * OB.levelsPerSlot });
  s = createOrder(s, { mode: 'best', party: [s.heroes[0].id, s.heroes[1].id], minOdds: 0.5 }).state;
  s = createOrder(s, { mode: 'repeat', template: 'old_boar', party: [s.heroes[2].id], minOdds: 0 }).state;
  s = { ...s, zones: { ...s.zones, elwynn: { ...s.zones.elwynn, cleared: ['fargodeep_mine'] } } };
  for (let i = 0; i < 600; i += 1) {
    s = step(s, 30);
    assert.ok(regularCount(s) <= DATA.quests.board.size);
    assert.ok(s.quests.board.filter((o) => isStory(o)).length <= 3);
    const party = s.quests.active.flatMap((r) => r.party);
    assert.equal(new Set(party).size, party.length, 'no hero is in two places');
    for (const v of Object.values(s.res)) assert.ok(Number.isFinite(v) && v >= 0);
    for (const z of Object.values(s.zones)) assert.ok(Number.isFinite(z.rep) && z.rep >= 0);
  }
  assert.ok(s.stats.questsDone > 20);
  assert.deepEqual(deserialize(serialize(s)).zones, s.zones);
});

test('a fresh game has all live zones and an empty lab', () => {
  const s = newState({ seed: 1, now: 0 });
  assert.deepEqual(Object.keys(s.zones).sort(), ['duskwood', 'elwynn', 'hellfire', 'molten', 'steppes', 'stranglethorn', 'swamp', 'westfall']);
  assert.equal(s.v, SAVE_VERSION);
  assert.deepEqual(s.alchemy, { stock: {}, queue: [] });
  assert.equal(tierIndex(0), 0);
});
