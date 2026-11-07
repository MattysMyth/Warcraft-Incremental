import test from 'node:test';
import assert from 'node:assert/strict';
import { step } from '../src/engine/tick.js';
import {
  collectTribute, tributeGain, choosePerk, setEdict, answerEvent, issueCommand, buyBuilding, assignWorker, setSetting,
  refreshPool, recruitHero, dispatchQuest,
} from '../src/engine/actions.js';
import { flows, workerCap, workerMultiplier, ecoFor, costOf, questSpeedMultiplier } from '../src/engine/derive.js';
import { rallyTap, perkEffects, describePerk, newEngage } from '../src/engine/engage.js';
import { respecFee, edictSwapFee, choiceTerms, eventOf, commandWait } from '../src/engine/events.js';
import { serialize, deserialize, normalize, migrate, MIGRATIONS } from '../src/engine/save.js';
import { validateData } from '../src/engine/data.js';
import { rebuild } from '../src/engine/rebuild.js';
import { SAVE_VERSION } from '../src/engine/state.js';
import { fresh, withRes, withBuildings, DATA } from './helpers.js';

const R = DATA.engage.rally;
const rich = (s) => withRes(s, { gold: 1e12, lumber: 1e12, stone: 1e12, iron_bars: 1e9, iron_ore: 1e9, food: 1e9, herbs: 1e6, leather: 1e6 });
const tap = (s, n) => { for (let i = 0; i < n; i += 1) s = collectTribute(s).state; return s; };

test('shipped hands-on data validates, and broken data is caught', () => {
  assert.deepEqual(validateData(DATA), []);
  const bad = structuredClone(DATA);
  bad.engage.events.list[0].choices = bad.engage.events.list[0].choices.filter((c) => c.cost);
  assert.ok(validateData(bad).some((p) => p.includes('free choice')));
  const bad2 = structuredClone(DATA);
  delete bad2.engage.perks.byBuilding.market;
  assert.ok(validateData(bad2).some((p) => p.includes('no perks')));
  const bad3 = structuredClone(DATA);
  bad3.engage.commands.byClass.mage.time = 0;
  assert.ok(validateData(bad3).some((p) => p.includes('command')));
});

// ---- Rally ----

test('enough taps fill the Rally meter and start a burst that lifts production', () => {
  let s = withBuildings(fresh(), { market: 5 });
  const base = flows(s).gross.gold;
  const need = Math.ceil(R.full / R.tapCharge);
  s = tap(s, need - 1);
  assert.equal(s.rally.burst, 0);
  assert.equal(s.rally.charge, R.tapCharge * (need - 1));
  const r = collectTribute(s);
  assert.equal(r.rallied, true);
  s = r.state;
  assert.equal(s.rally.burst, R.burstSeconds);
  assert.equal(s.rally.charge, 0);
  assert.equal(s.rally.bursts, 1);
  assert.ok(Math.abs(flows(s).gross.gold - base * (1 + R.boost)) < 1e-9, 'the burst lifts gold from the stipend and the Market');
});

test('a burst runs out, taps during it add nothing to the meter, and the meter drains when you stop', () => {
  let s = tap(withBuildings(fresh(), { market: 5 }), R.full / R.tapCharge);
  assert.ok(s.rally.burst > 0);
  s = tap(s, 3);
  assert.equal(s.rally.charge, 0, 'no charging mid burst');
  s = step(s, R.burstSeconds + 1);
  assert.equal(s.rally.burst, 0);
  s = tap(s, 5);
  const charged = s.rally.charge;
  assert.equal(charged, 5 * R.tapCharge);
  s = step(s, 2);
  assert.ok(Math.abs(s.rally.charge - (charged - R.decayPerSec * 2)) < 1e-6);
  s = step(s, 60);
  assert.equal(s.rally.charge, 0);
  assert.equal(rallyTap({ rally: undefined }, DATA).charge, R.tapCharge, 'an older state without a meter still works');
});

test('tribute keeps pace with the town: a flat sum plus a slice of gold income', () => {
  const poor = fresh();
  const rich1 = withBuildings(fresh(), { market: 40 });
  assert.ok(tributeGain(rich1) > tributeGain(poor) * 5);
  const g = flows(rich1).gross.gold;
  assert.ok(Math.abs(tributeGain(rich1) - (1 + R.tributeSeconds * g)) < 1e-9);
});

// ---- Perks ----

test('a perk needs the level, the first pick is free, and a change costs gold', () => {
  const lvl = DATA.engage.perks.tiers[0];
  let s = rich(withBuildings(fresh(), { market: lvl - 1 }));
  assert.equal(choosePerk(s, 'market', lvl, 'a').ok, false, 'level too low');
  s = withBuildings(s, { market: lvl });
  assert.equal(choosePerk(s, 'house', lvl, 'a').ok, false, 'only workplaces');
  assert.equal(choosePerk(s, 'market', lvl, 'c').ok, false);
  const gold0 = s.res.gold;
  const r = choosePerk(s, 'market', lvl, 'a');
  assert.ok(r.ok, r.error);
  assert.equal(r.state.res.gold, gold0, 'free the first time');
  assert.equal(choosePerk(r.state, 'market', lvl, 'a').ok, false, 'already chosen');
  const fee = respecFee(r.state);
  assert.ok(fee >= DATA.engage.perks.respecMin);
  const swap = choosePerk(r.state, 'market', lvl, 'b');
  assert.ok(swap.ok);
  assert.equal(swap.state.res.gold, gold0 - fee);
  assert.equal(choosePerk(withRes(r.state, { gold: 0 }), 'market', lvl, 'b').ok, false, 'cannot afford the change');
});

test('perks change output, price, worker bonus and worker slots', () => {
  const t = DATA.engage.perks.tiers;
  const pk = (s, id, at, pick) => choosePerk(s, id, at, pick).state;
  let s = rich(withBuildings(fresh(), { market: t[2] }));
  const base = flows(s).gross.gold;
  const baseCost = costOf(DATA.buildingById.market, t[2], 1, ecoFor(s, DATA, 'market')).gold;
  const cap0 = workerCap(s, 'market');

  const out = pk(s, 'market', t[0], 'a');
  assert.ok(flows(out).gross.gold > base);
  const disc = pk(s, 'market', t[0], 'b');
  assert.ok(Math.abs(costOf(DATA.buildingById.market, t[2], 1, ecoFor(disc, DATA, 'market')).gold - baseCost * 0.85) < 1e-9);
  assert.equal(costOf(DATA.buildingById.farm, 5, 1, ecoFor(disc, DATA, 'farm')).gold, costOf(DATA.buildingById.farm, 5, 1).gold, 'only that building');

  const slots = pk(s, 'market', t[1], 'b');
  assert.equal(workerCap(slots, 'market'), cap0 + 2);
  const bonus = pk(s, 'market', t[1], 'a');
  const withW = (x) => ({ ...x, town: { ...x.town, residents: 5, workers: { market: 5 } } });
  assert.ok(Math.abs(workerMultiplier(withW(bonus), 'market') - (1 + (DATA.economy.workers.bonusEach + 0.05) * 5)) < 1e-12);

  // Every perk reads as a sentence.
  for (const row of DATA.engage.perks.byBuilding.market) for (const k of ['a', 'b']) assert.ok(describePerk(row[k]).length > 0);
  assert.equal(perkEffects(fresh(), 'market').output, 0);
});

test('perks reset with a Rebuild like the rest of the town', () => {
  let s = rich(withBuildings(fresh(), { market: 10 }));
  s = choosePerk(s, 'market', 10, 'a').state;
  s = setEdict({ ...s, town: { ...s.town, townHall: 2 } }, 'austerity').state;
  s = { ...s, stats: { ...s.stats, lifetimeGold: 1e9 } };
  const r = rebuild(s);
  assert.ok(r.ok, r.error);
  assert.deepEqual(r.state.town.perks, {});
  assert.equal(r.state.town.edict, null);
  assert.deepEqual(r.state.buffs, []);
});

// ---- Edicts ----

test('an edict needs the Town Hall, trades one resource for another, and a swap costs gold', () => {
  let s = rich(withBuildings(fresh(), { market: 4, lumber_camp: 4, farm: 4 }));
  assert.equal(setEdict(s, 'market_day').ok, false, 'Town Hall too low');
  s = { ...s, town: { ...s.town, townHall: DATA.engage.edicts.townHall } };
  const base = flows(s).gross;
  const r = setEdict(s, 'timber_levy');
  assert.ok(r.ok, r.error);
  assert.equal(r.fee, 0);
  const after = flows(r.state).gross;
  assert.ok(Math.abs(after.lumber - base.lumber * 1.5) < 1e-9);
  assert.ok(Math.abs(after.food - base.food * 0.8) < 1e-9);
  assert.equal(setEdict(r.state, 'timber_levy').ok, false);
  const fee = edictSwapFee(r.state);
  const swap = setEdict(r.state, 'market_day');
  assert.ok(swap.ok && swap.fee === fee && swap.state.res.gold === r.state.res.gold - fee);
  assert.ok(Math.abs(costOf(DATA.buildingById.market, 4, 1, ecoFor(swap.state, DATA, 'market')).gold - costOf(DATA.buildingById.market, 4, 1).gold * 1.2) < 1e-9);
  assert.equal(setEdict(withRes(r.state, { gold: 0 }), 'market_day').ok, false);
  const lifted = setEdict(swap.state, null);
  assert.ok(lifted.ok && lifted.state.town.edict === null);
  assert.equal(setEdict(lifted.state, null).ok, false);
  assert.equal(setEdict(s, 'nope').ok, false);
  // War Drums speeds the quests.
  const drums = setEdict(s, 'war_drums').state;
  assert.ok(Math.abs(questSpeedMultiplier(drums) - 1.25) < 1e-12);
});

// ---- Timed events ----

const evTown = () => rich(withBuildings(fresh(), { market: 5, lumber_camp: 3, farm: 3, house: 3 }));
const waitForEvent = (s) => { for (let i = 0; i < 400 && !s.event; i += 1) s = step(s, 5); return s; };

test('an event arrives after a delay, needs a Market, and can be turned off', () => {
  let s = evTown();
  s = step(s, 60);
  assert.equal(s.event, null, 'nothing in the first minute');
  const noMarket = withBuildings(fresh(), { market: 0 });
  let n = noMarket;
  for (let i = 0; i < 200; i += 1) n = step(n, 5);
  assert.equal(n.event, null, 'a town with no Market gets no visitors');
  s = waitForEvent(s);
  assert.ok(s.event, 'an event arrived');
  assert.ok(eventOf(s));
  assert.equal(s.event.left, DATA.engage.events.window);
  const off = setSetting(evTown(), 'events', 'off').state;
  let o = off;
  for (let i = 0; i < 400; i += 1) o = step(o, 5);
  assert.equal(o.event, null, 'switched off');
});

test('an event lapses without penalty, and the free choice always costs nothing', () => {
  let s = waitForEvent(evTown());
  const res = { ...s.res };
  s = step(s, DATA.engage.events.window + 1);
  assert.equal(s.event, null);
  assert.ok(s.events.next > 0);
  for (const def of DATA.engage.events.list) assert.ok(def.choices.some((c) => !c.cost));
  assert.ok(res.gold > 0);
});

test('answering an event pays its cost, grants its reward, and starts the wait for the next', () => {
  const set = (s, id) => ({ ...s, event: { id, left: 60, total: 120 } });
  let s = evTown();
  // Caravan: gold for timber.
  const c = set(withRes(s, { lumber: 0 }), 'caravan');
  const terms = choiceTerms(c, DATA.eventById.caravan.choices[0]);
  assert.ok(terms.cost.amount >= 40 && terms.gain.amount >= 60);
  const r = answerEvent(c, 0);
  assert.ok(r.ok, r.error);
  assert.equal(r.state.res.gold, c.res.gold - terms.cost.amount);
  assert.equal(r.state.res.lumber, Math.min(terms.gain.amount, 1000 * 1.3 ** 0), 'goods are clamped to the storage limit');
  assert.equal(answerEvent(set(s, 'caravan'), 0).state.res.lumber, 1e12, 'a full store never shrinks');
  assert.equal(r.state.event, null);
  assert.equal(answerEvent(r.state, 0).ok, false, 'already answered');
  assert.equal(answerEvent(c, 9).ok, false);
  assert.equal(answerEvent(withRes(c, { gold: 0 }), 0).ok, false, 'cannot afford');
  assert.ok(answerEvent(withRes(c, { gold: 0 }), 2).ok, 'declining is free');
  // Omen: a buff on output.
  const o = answerEvent(set(s, 'omen'), 0);
  assert.equal(o.state.buffs.length, 1);
  const base = flows(s).gross.gold;
  assert.ok(Math.abs(flows(o.state).gross.gold - base * 1.3) < 1e-9);
  const later = step(o.state, 181);
  assert.equal(later.buffs.length, 0, 'the buff runs out');
  // Scholar: quests faster.
  const sc = answerEvent(set(s, 'scholar'), 0).state;
  assert.ok(Math.abs(questSpeedMultiplier(sc) - 1.35) < 1e-12);
  // Refugees: residents settle within the room.
  const home = { ...set(s, 'refugees'), town: { ...s.town, residents: 0 } };
  assert.equal(answerEvent(home, 0).state.town.residents, 2);
});

// ---- Hero commands ----

function onTheRoad() {
  let s = rich(fresh());
  s = { ...s, town: { ...s.town, townHall: 10 } };
  s = withBuildings(s, { tavern: 9, barracks: 4, house: 20, chapel: 5, blacksmith: 1 });
  s = step(s, 0.1);
  s = refreshPool(s).state;
  s = recruitHero(s, s.tavern.pool.filter((c) => !c.hired)[0].id).state;
  s = { ...s, heroes: s.heroes.map((h) => ({ ...h, level: 40 })) };
  s = step(s, 5);
  const offer = s.quests.board.find((o) => o.type === 'bounty') ?? s.quests.board[0];
  const r = dispatchQuest(s, offer.id, [s.heroes[0].id], DATA, null);
  assert.ok(r.ok, r.error);
  return r.state;
}

test('a hero command shortens or enriches the trip once, then rests', () => {
  let s = onTheRoad();
  const hero = s.heroes[0];
  const run = s.quests.active[0];
  const cmd = DATA.engage.commands.byClass[hero.class];
  const r = issueCommand(s, run.id, hero.id);
  assert.ok(r.ok, r.error);
  const after = r.state.quests.active[0];
  if (cmd.time) assert.ok(Math.abs(after.remaining - Math.max(1, run.remaining - run.total * cmd.time)) < 1e-9);
  assert.equal(after.bonus.gold, cmd.gold ?? 0);
  assert.equal(after.bonus.xp, cmd.xp ?? 0);
  assert.equal(commandWait(r.state, hero.id), DATA.engage.commands.cooldownSeconds);
  assert.equal(issueCommand(r.state, run.id, hero.id).ok, false, 'resting');
  const rested = step(r.state, 10);
  assert.ok(Math.abs(commandWait(rested, hero.id) - (DATA.engage.commands.cooldownSeconds - 10)) < 1e-6);
  assert.equal(issueCommand(s, 'nope', hero.id).ok, false);
  assert.equal(issueCommand(s, run.id, 'h999').ok, false);
});

test('a command bonus raises what the finished trip pays', () => {
  const base = onTheRoad();
  const boost = (s) => ({ ...s, quests: { ...s.quests, active: s.quests.active.map((r) => ({ ...r, bonus: { gold: 0.5, xp: 0.5 }, success: true })) } });
  const plain = { ...base, quests: { ...base.quests, active: base.quests.active.map((r) => ({ ...r, success: true })) } };
  const done = (s) => { for (let i = 0; i < 400; i += 1) s = step(s, 5); return s; };
  const a = done(plain);
  const b = done(boost(base));
  const gold = (s) => s.stats.lifetimeGold;
  const xp = (s) => s.heroes[0].xp + s.heroes[0].level * 1e6;
  assert.ok(a.stats.questsDone >= 1 && b.stats.questsDone >= 1);
  assert.ok(xp(b) >= xp(a));
  assert.ok(a.quests.history[0].gold > 0, 'a bounty pays gold');
  assert.ok(Math.abs(b.quests.history[0].gold - a.quests.history[0].gold * 1.5) <= 1, 'plus fifty percent');
  assert.ok(b.quests.history[0].xp > a.quests.history[0].xp);
});

// ---- Save ----

test('the new state round-trips through save and load, and a v10 save upgrades cleanly', () => {
  let s = rich(withBuildings(fresh(), { market: 12 }));
  s = choosePerk(s, 'market', 10, 'b').state;
  s = { ...s, town: { ...s.town, townHall: 2 } };
  s = setEdict(s, 'harvest_rites').state;
  s = tap(s, 7);
  s = { ...s, buffs: [{ id: 'omen', name: 'Feast day', left: 100, total: 180, output: 0.3, questSpeed: 0 }], event: { id: 'omen', left: 50, total: 120 } };
  const back = deserialize(serialize(s));
  assert.deepEqual(back.town.perks, s.town.perks);
  assert.equal(back.town.edict, 'harvest_rites');
  assert.deepEqual(back.rally, s.rally);
  assert.deepEqual(back.buffs, s.buffs);
  assert.deepEqual(back.event, s.event);
  assert.equal(back.v, SAVE_VERSION);
  const old = { ...JSON.parse(serialize(fresh())), v: 10 };
  delete old.rally; delete old.buffs; delete old.event; delete old.events; delete old.town.perks; delete old.town.edict; delete old.settings.events;
  const up = normalize(migrate(old));
  assert.equal(up.settings.events, 'on');
  assert.deepEqual(up.town.perks, {});
  assert.equal(up.events.next, DATA.engage.events.firstDelaySeconds);
  assert.equal(MIGRATIONS.length, SAVE_VERSION - 1);
});

test('normalize repairs hand-edited hands-on state', () => {
  const raw = JSON.parse(serialize(rich(withBuildings(fresh(), { market: 12 }))));
  raw.town.perks = { market: { 10: 'a', 25: 'a', 50: 'b', 7: 'a' }, house: { 10: 'a' }, ghost: { 10: 'a' } };
  raw.town.edict = 'nonsense';
  raw.rally = { charge: 9999, burst: -4, bursts: 'x' };
  raw.buffs = [{ name: 'ok', left: 99999, output: 9 }, { name: 'dead', left: 0 }, 'junk'];
  raw.event = { id: 'ghost', left: 50 };
  raw.settings.events = 'maybe';
  const s = normalize(raw);
  assert.deepEqual(s.town.perks, { market: { 10: 'a' } }, 'only tiers the building has reached, only known buildings');
  assert.equal(s.town.edict, null);
  assert.equal(s.rally.charge, R.full);
  assert.equal(s.rally.burst, 0);
  assert.equal(s.buffs.length, 1);
  assert.ok(s.buffs[0].left <= 3600 && s.buffs[0].output <= 1);
  assert.equal(s.event, null);
  assert.equal(s.settings.events, 'on');
  assert.deepEqual(newEngage().buffs, []);
});
