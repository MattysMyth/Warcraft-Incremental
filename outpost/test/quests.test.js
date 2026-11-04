import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newQuests, rollOffer, heroRating, partyRating, oddsFor, runSeconds, rewardFor, heroXpFor,
  stepQuests, busyIds, startRun, regularCount, isStory,
} from '../src/engine/quests.js';
import { recruitHero, dispatchQuest, recallQuest, discardOffer, injureHero } from '../src/engine/actions.js';
import { step } from '../src/engine/tick.js';
import { advance } from '../src/engine/offline.js';
import { deserialize, serialize, normalize, migrate, MIGRATIONS } from '../src/engine/save.js';
import { validateQuests, validateData } from '../src/engine/data.js';
import { moraleOf, xpToNext, drillRate } from '../src/engine/heroes.js';
import { newState, SAVE_VERSION } from '../src/engine/state.js';
import { fresh, withRes, withBuildings, DATA, T0 } from './helpers.js';

const QD = DATA.quests;
const rich = (s) => withRes(s, { gold: 1e12, lumber: 1e12, stone: 1e12, iron_bars: 1e9, iron_ore: 1e9, food: 1e9 });
function questTown(heroCount = 2, seed = 12345) {
  let s = rich({ ...fresh(), seed });
  s = { ...s, town: { ...s.town, townHall: 6 } };
  s = withBuildings(s, { tavern: 1 });
  s = step(s, 0.1);
  for (let i = 0; i < heroCount; i += 1) {
    const r = recruitHero(s, s.tavern.pool.filter((c) => !c.hired)[0].id);
    assert.ok(r.ok, r.error);
    s = r.state;
  }
  return step(s, 0.1);
}
const firstOf = (s, type) => s.quests.board.find((o) => o.type === type);

test('quest data validates and the validator rejects broken quest data', () => {
  assert.deepEqual(validateData(DATA), []);
  const bad = structuredClone(DATA);
  bad.quests.templates[0].resource = 'nonsense';
  bad.quests.types.bounty.party = [2, 1];
  const problems = validateQuests(bad).join('\n');
  assert.ok(problems.length > 0);
});

test('no board until there is a hero, then a starting board appears', () => {
  const empty = step(fresh(), 5);
  assert.equal(empty.quests.board.length, 0);
  const s = questTown();
  const regular = s.quests.board.filter((o) => !isStory(o));
  assert.equal(regular.length, QD.board.startOffers);
  assert.equal(regular[0].type, 'bounty', 'the first offer is a bounty');
});

test('same seed gives the same board, different seed a different one', () => {
  const a = questTown(2, 777);
  const b = questTown(2, 777);
  const c = questTown(2, 778);
  const run = (s) => stepQuests(s, QD.board.refreshSeconds * 5, DATA).quests.board;
  assert.deepEqual(run(a).map((o) => o.id + o.template + o.modifier + o.duration), run(b).map((o) => o.id + o.template + o.modifier + o.duration));
  assert.notDeepEqual(run(a).map((o) => o.template + o.modifier + o.duration), run(c).map((o) => o.template + o.modifier + o.duration));
});

test('rollOffer is a pure function of seed and number', () => {
  const s = questTown();
  assert.deepEqual(rollOffer(s, 9, DATA), rollOffer(s, 9, DATA));
  for (let n = 1; n < 60; n += 1) {
    const o = rollOffer(s, n, DATA);
    const t = DATA.quests.types[o.type];
    assert.ok(o.duration >= 5 && o.rec > 0 && o.level >= 1 && o.level <= 10);
    assert.ok(o.duration <= t.duration[1] * 2, 'duration stays in a sensible range');
    if (o.type === 'gathering') assert.ok(o.resource);
  }
});

test('the board refreshes on a timer, holds at the cap and never overfills', () => {
  let s = questTown();
  const before = regularCount(s);
  s = stepQuests(s, QD.board.refreshSeconds + 1, DATA);
  assert.equal(regularCount(s), before + 1);
  s = stepQuests(s, QD.board.refreshSeconds * 40, DATA);
  assert.equal(regularCount(s), QD.board.size);
  const ids = s.quests.board.map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length);
  s = stepQuests(s, 1000, DATA);
  assert.equal(regularCount(s), QD.board.size);
});

test('odds come from simulation: bounded, repeatable and higher for a stronger party', () => {
  const s = questTown(1);
  const offer = { ...firstOf(s, 'bounty'), level: 5, rec: 40 };
  const hero = s.heroes[0];
  const weak = { ...s, heroes: [{ ...hero, level: 1 }] };
  const strong = { ...s, heroes: [{ ...hero, level: 10 }] };
  const pw = oddsFor(weak, offer, [hero.id]);
  const ps = oddsFor(strong, offer, [hero.id]);
  assert.ok(pw >= 0 && pw <= 1 && ps >= 0 && ps <= 1);
  assert.ok(ps > pw, 'a stronger hero has better odds');
  assert.equal(oddsFor(strong, offer, [hero.id]), ps, 'same question, same answer');
  assert.equal(oddsFor(strong, offer, []), 0);
});

test('a hero\'s rating rises with level and with gear', () => {
  const s = questTown(1);
  const h = s.heroes[0];
  const r1 = heroRating(s, h);
  assert.ok(r1 > 0);
  assert.ok(heroRating(s, { ...h, level: 10 }) > r1);
  assert.equal(partyRating(s, [h.id]), r1);
  assert.equal(partyRating(s, ['nobody']), 0);
});

test('dispatch validates party size, injury, busy heroes and missing offers', () => {
  let s = questTown(2);
  const bounty = firstOf(s, 'bounty');
  const [a, b] = s.heroes;
  assert.equal(dispatchQuest(s, 'qzzz', [a.id]).ok, false);
  assert.equal(dispatchQuest(s, bounty.id, []).ok, false);
  assert.equal(dispatchQuest(s, bounty.id, [a.id, b.id]).ok, false, 'bounties take one hero');
  assert.equal(dispatchQuest(s, bounty.id, ['ghost']).ok, false);
  const hurt = injureHero(s, a.id).state;
  assert.equal(dispatchQuest(hurt, bounty.id, [a.id]).ok, false);
  const r = dispatchQuest(s, bounty.id, [a.id]);
  assert.ok(r.ok, r.error);
  assert.equal(r.state.quests.board.some((o) => o.id === bounty.id), false);
  assert.equal(r.state.quests.active.length, 1);
  assert.ok(busyIds(r.state).has(a.id));
  const other = r.state.quests.board.find((o) => o.type === 'bounty');
  if (other) assert.equal(dispatchQuest(r.state, other.id, [a.id]).ok, false, 'a busy hero cannot go twice');
});

test('gathering quests accept one or two heroes and pay more for two', () => {
  const s = questTown(2);
  const g = s.quests.board.find((o) => o.type === 'gathering') ?? rollOffer(s, 2, DATA);
  const one = rewardFor(s, { ...g, type: 'gathering', resource: 'lumber', modifier: 'standard' }, 1, DATA);
  const two = rewardFor(s, { ...g, type: 'gathering', resource: 'lumber', modifier: 'standard' }, 2, DATA);
  assert.ok(two.res.lumber > one.res.lumber);
});

test('a quest runs in real time and pays gold and experience on success', () => {
  let s = questTown(1);
  const offer = firstOf(s, 'bounty');
  const hero = s.heroes[0];
  // Make the odds certain so the test checks payout, not luck.
  const strong = { ...s, heroes: [{ ...hero, level: 10 }] };
  let r = dispatchQuest({ ...strong, quests: { ...strong.quests, board: strong.quests.board.map((o) => (o.id === offer.id ? { ...o, rec: 1 } : o)) } }, offer.id, [hero.id]);
  assert.ok(r.ok);
  s = r.state;
  const run = s.quests.active[0];
  assert.equal(run.success, true);
  const gold0 = s.res.gold;
  s = step(s, run.total / 2, DATA);
  assert.equal(s.quests.active.length, 1, 'still out on the road');
  assert.ok(s.quests.active[0].remaining < run.total);
  s = step(s, run.total, DATA);
  assert.equal(s.quests.active.length, 0);
  assert.ok(s.res.gold - gold0 >= run.reward.gold, 'the gold arrived');
  assert.equal(s.quests.history[0].ok, true);
  assert.equal(s.stats.questsDone, 1);
  assert.ok(s.heroes[0].xp > 0 || s.heroes[0].level > 10);
});

test('failure injures the party and pays nothing', () => {
  let s = questTown(1);
  const offer = firstOf(s, 'bounty');
  const hero = s.heroes[0];
  const hard = { ...s, quests: { ...s.quests, board: s.quests.board.map((o) => (o.id === offer.id ? { ...o, rec: 1e6 } : o)) } };
  const r = dispatchQuest(hard, offer.id, [hero.id]);
  s = r.state;
  assert.equal(s.quests.active[0].success, false);
  const gold0 = s.res.gold;
  const xp0 = s.heroes[0].xp;
  s = step(s, s.quests.active[0].total + 1, DATA);
  assert.equal(s.quests.history[0].ok, false);
  assert.ok(s.heroes[0].injury > 0, 'the hero came home hurt');
  assert.equal(s.heroes[0].xp, xp0);
  assert.equal(s.stats.questsFailed, 1);
  assert.ok(s.res.gold - gold0 < 100, 'only the stipend, no quest reward');
});

test('the outcome is fixed when the party leaves', () => {
  const s = questTown(1);
  const offer = firstOf(s, 'bounty');
  const a = startRun(s, offer.id, [s.heroes[0].id]);
  const b = startRun(s, offer.id, [s.heroes[0].id]);
  assert.equal(a.run.success, b.run.success);
  assert.equal(a.run.chance, b.run.chance);
});

test('recalling a party returns the heroes and gives no reward', () => {
  let s = questTown(1);
  const offer = firstOf(s, 'bounty');
  s = dispatchQuest(s, offer.id, [s.heroes[0].id]).state;
  const r = recallQuest(s, offer.id);
  assert.ok(r.ok);
  assert.equal(r.state.quests.active.length, 0);
  assert.equal(busyIds(r.state).size, 0);
  assert.equal(recallQuest(r.state, offer.id).ok, false);
});

test('discarding an offer removes it from the board', () => {
  const s = questTown(1);
  const story = s.quests.board.find((o) => isStory(o));
  assert.equal(discardOffer(s, story.id).ok, false, 'story notices stay up');
  const id = s.quests.board.find((o) => !isStory(o)).id;
  const r = discardOffer(s, id);
  assert.ok(r.ok);
  assert.equal(r.state.quests.board.length, s.quests.board.length - 1);
  assert.equal(discardOffer(r.state, id).ok, false);
});

test('a hero on a quest does not drill', () => {
  let s = questTown(1);
  const hero = s.heroes[0];
  assert.ok(drillRate(s, hero) > 0);
  s = dispatchQuest(s, firstOf(s, 'bounty').id, [hero.id]).state;
  assert.equal(drillRate(s, s.heroes[0]), 0);
});

test('Stables shorten the road but not the reward', () => {
  const s = questTown(1);
  const o = firstOf(s, 'bounty');
  const t0 = runSeconds(s, o);
  const t10 = runSeconds(withBuildings(s, { stables: 10 }), o);
  assert.ok(Math.abs(t10 / t0 - (1 - QD.stables.perLevel * 10)) < 1e-9);
  const t99 = runSeconds(withBuildings(s, { stables: 99 }), o);
  assert.ok(Math.abs(t99 / t0 - (1 - QD.stables.max)) < 1e-9, 'capped');
  assert.deepEqual(rewardFor(s, o, 1), rewardFor(withBuildings(s, { stables: 10 }), o, 1));
});

test('hunger slows quests', () => {
  let s = questTown(1);
  s = dispatchQuest(s, firstOf(s, 'bounty').id, [s.heroes[0].id]).state;
  const fed = step({ ...s, res: { ...s.res, food: 1e9 } }, 10, DATA).quests.active[0].remaining;
  const starving = { ...s, res: { ...s.res, food: 0 }, town: { ...s.town, residents: 20 } };
  const slow = step(starving, 10, DATA).quests.active[0]?.remaining;
  assert.ok(slow === undefined || slow > fed, 'a starving town sends parties out slower');
});

test('experience falls off for heroes far above the quest', () => {
  const s = questTown(1);
  const o = { ...firstOf(s, 'bounty'), level: 1 };
  const h = s.heroes[0];
  const equal = heroXpFor(s, { ...h, level: 1 }, o);
  const over = heroXpFor(s, { ...h, level: 8 }, o);
  assert.ok(over < equal);
  assert.ok(over > 0);
});

test('morale rises with recent wins', () => {
  const s = questTown(1);
  const h = s.heroes[0];
  const m0 = moraleOf(s);
  const m1 = moraleOf({ ...s, stats: { ...s.stats, recentWins: QD.winsFull } });
  assert.ok(Math.abs(m1 - m0 - DATA.heroes.morale.winsMax) < 1e-9);
});

test('closing the tab for an hour credits the right rewards', () => {
  let s = questTown(2);
  const offers = s.quests.board.filter((o) => o.type === 'bounty').slice(0, 2);
  // Send both heroes out on guaranteed wins that finish well within the hour.
  s = { ...s, heroes: s.heroes.map((h) => ({ ...h, level: 10 })) };
  s = { ...s, quests: { ...s.quests, board: s.quests.board.map((o) => ({ ...o, rec: 1, duration: Math.min(o.duration, 300) })) } };
  const chosen = s.quests.board.filter((o) => o.type === 'bounty' && !isStory(o)).slice(0, 2);
  s = dispatchQuest(s, chosen[0].id, [s.heroes[0].id]).state;
  if (chosen[1]) s = dispatchQuest(s, chosen[1].id, [s.heroes[1].id]).state;
  const sent = s.quests.active.length;
  const expectGold = s.quests.active.reduce((a, r) => a + r.reward.gold, 0);
  const saved = { ...s, savedAt: T0 };
  const { state, report } = advance(saved, T0 + 3600 * 1000, DATA);
  assert.equal(state.quests.active.length, 0, 'everyone is home');
  assert.equal(report.quests.done, sent);
  assert.equal(report.quests.failed, 0);
  assert.ok(Math.abs(report.quests.gold - expectGold) < 1e-6, 'the report matches the rewards paid');
  assert.ok(report.gains.gold >= expectGold, 'the gold is in the purse');
  assert.equal(offers.length > 0, true);
});

test('offline time past the limit does not run extra quests', () => {
  let s = questTown(1);
  s = dispatchQuest(s, firstOf(s, 'bounty').id, [s.heroes[0].id]).state;
  const { report } = advance({ ...s, savedAt: T0 }, T0 + 30 * 86400 * 1000, DATA);
  assert.equal(report.beyondLimit, true);
  assert.ok(report.quests.done + report.quests.failed <= 1);
});

test('quests round-trip through save and load', () => {
  let s = questTown(2);
  s = dispatchQuest(s, firstOf(s, 'bounty').id, [s.heroes[0].id]).state;
  s = step(s, 30, DATA);
  const back = deserialize(serialize(s));
  assert.deepEqual(back.quests, s.quests);
  assert.deepEqual(back.stats, s.stats);
  assert.equal(back.v, SAVE_VERSION);
});

test('a v3 save migrates to v4 with an empty board that fills on the next tick', () => {
  const s = questTown(1);
  const v3 = { ...JSON.parse(serialize(s)), v: 3 };
  delete v3.quests;
  delete v3.stats.questsDone;
  const m = normalize(migrate(v3, MIGRATIONS, SAVE_VERSION));
  assert.equal(m.v, SAVE_VERSION);
  assert.equal(m.quests.board.length, 0);
  assert.equal(m.stats.questsDone, 0);
  assert.ok(step(m, 0.1).quests.board.length > 0);
});

test('normalize drops broken quests, duplicate parties and ghost heroes', () => {
  let s = questTown(2);
  s = dispatchQuest(s, firstOf(s, 'bounty').id, [s.heroes[0].id]).state;
  const raw = JSON.parse(serialize(s));
  raw.quests.board.push({ id: 'qx', template: 'nope' }, null, 42);
  raw.quests.active.push({ ...raw.quests.active[0], id: 'dup' });
  raw.quests.active.push({ ...raw.quests.active[0], id: 'ghost', party: ['h999'] });
  raw.quests.history.push({ nonsense: true });
  const n = normalize(raw);
  assert.equal(n.quests.active.length, 1);
  assert.ok(n.quests.board.every((o) => DATA.templateById[o.template]));
  assert.ok(n.quests.history.every((e) => typeof e.title === 'string'));
  assert.ok(n.quests.counter >= Math.max(...n.quests.board.map((o) => o.n)));
});

test('a long simulation keeps every invariant', () => {
  let s = questTown(2, 99);
  for (let i = 0; i < 400; i += 1) {
    s = step(s, 30, DATA);
    const idle = s.heroes.filter((h) => !busyIds(s).has(h.id) && h.injury <= 0);
    const o = s.quests.board.find((x) => x.type === 'bounty');
    if (idle.length && o) {
      const r = dispatchQuest(s, o.id, [idle[0].id]);
      if (r.ok) s = r.state;
    }
    assert.ok(regularCount(s) <= QD.board.size);
    assert.ok(s.quests.history.length <= QD.history);
    assert.equal(new Set(s.quests.active.flatMap((r) => r.party)).size, s.quests.active.flatMap((r) => r.party).length);
    for (const v of Object.values(s.res)) assert.ok(Number.isFinite(v) && v >= 0);
  }
  assert.ok(s.stats.questsDone + s.stats.questsFailed > 5, 'quests actually completed');
});
