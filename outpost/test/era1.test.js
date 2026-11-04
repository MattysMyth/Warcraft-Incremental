import test from 'node:test';
import assert from 'node:assert/strict';
import { startRun } from '../src/engine/quests.js';
import { refreshPool, recruitHero } from '../src/engine/actions.js';
import { zoneOpen } from '../src/engine/zones.js';
import { stepRaids, threatOf, defenceOf, newRaids, raidPreview } from '../src/engine/raids.js';
import { checkAchievements, achievementMultiplier } from '../src/engine/achievements.js';
import { globalMultiplier } from '../src/engine/derive.js';
import { rebuild } from '../src/engine/rebuild.js';
import { step } from '../src/engine/tick.js';
import { advance } from '../src/engine/offline.js';
import { normalize, migrate, MIGRATIONS } from '../src/engine/save.js';
import { validateData } from '../src/engine/data.js';
import { newState, SAVE_VERSION } from '../src/engine/state.js';
import { fresh, withRes, withBuildings, DATA, T0 } from './helpers.js';

const rich = (s) => withRes(s, { gold: 1e12, lumber: 1e12, stone: 1e12, iron_bars: 1e9, iron_ore: 1e9, food: 1e9, herbs: 1e6, leather: 1e6, arcane_dust: 1e6 });
const cleared = (s, zones) => ({ ...s, zones: { ...s.zones, ...Object.fromEntries(Object.entries(zones).map(([z, c]) => [z, { ...s.zones[z], cleared: c }])) } });

function town(heroCount) {
  let s = rich(fresh());
  s = { ...s, town: { ...s.town, townHall: 15 } };
  s = withBuildings(s, { tavern: 30, barracks: 10, chapel: 12, alchemy_lab: 5, house: 60 });
  s = step(s, 0.1);
  for (let i = 0; i < heroCount; i += 1) {
    if (!s.tavern.pool.some((c) => !c.hired)) s = refreshPool(s).state;
    const r = recruitHero(s, s.tavern.pool.filter((c) => !c.hired)[0].id);
    assert.ok(r.ok, r.error);
    s = r.state;
  }
  return step({ ...s, heroes: s.heroes.map((h) => ({ ...h, level: 60 })) }, 0.1);
}

test('the shipped data, including the four new zones, validates', () => {
  assert.deepEqual(validateData(DATA), []);
  for (const id of ['stranglethorn', 'swamp', 'steppes', 'molten']) assert.ok(DATA.zoneById[id], id);
  assert.equal(DATA.zoneList.length, 8, 'seven Era 1 zones and Hellfire Peninsula');
  assert.equal(DATA.tierById[7].reqLevel, 60);
});

test('zones open in a chain, and two of them also want a Town Hall level', () => {
  let s = fresh();
  assert.equal(zoneOpen(s, 'stranglethorn'), false);
  s = cleared(s, { duskwood: ['stitches'] });
  assert.equal(zoneOpen(s, 'stranglethorn'), false, 'Town Hall 1 is too low');
  s = { ...s, town: { ...s.town, townHall: 8 } };
  assert.equal(zoneOpen(s, 'stranglethorn'), true);
  assert.equal(zoneOpen(s, 'swamp'), false);
  s = cleared(s, { stranglethorn: ['zul_gurub'] });
  assert.equal(zoneOpen(s, 'swamp'), true);
  s = cleared(s, { swamp: ['atalhakkar'], steppes: ['blackrock_depths'] });
  assert.equal(zoneOpen(s, 'steppes'), true);
  assert.equal(zoneOpen(s, 'molten'), false, 'Molten Core wants Town Hall 15');
  assert.equal(zoneOpen({ ...s, town: { ...s.town, townHall: 15 } }, 'molten'), true);
});

test('a raid takes six to ten heroes and a dungeon at most five', () => {
  let s = town(10);
  s = cleared(s, { duskwood: ['stitches'], stranglethorn: [] });
  s = { ...s, quests: { ...s.quests, board: [], counter: 0 } };
  const ids = s.heroes.map((h) => h.id);
  const offer = (tpl) => ({ id: 'q1', n: 1, template: tpl, type: DATA.templateById[tpl].type, zone: DATA.templateById[tpl].zone, level: DATA.templateById[tpl].level, modifier: 'standard', title: 'x', text: '', duration: 100, rec: 1 });
  const board = (tpl) => ({ ...s, quests: { ...s.quests, board: [offer(tpl)] } });
  assert.equal(startRun(board('zul_gurub'), 'q1', ids.slice(0, 5), DATA).ok, false);
  assert.equal(startRun(board('zul_gurub'), 'q1', ids.slice(0, 6), DATA).ok, true);
  assert.equal(startRun(board('zul_gurub'), 'q1', ids, DATA).ok, true);
  assert.equal(startRun(board('atalhakkar'), 'q1', ids.slice(0, 6), DATA).ok, false);
});

test('a raid with a ready party can be fought and won', () => {
  const s = town(10);
  const offer = { id: 'q1', n: 1, template: 'zul_gurub', type: 'raid', zone: 'stranglethorn', level: 36, modifier: 'standard', title: 'Zul', text: '', duration: 60, rec: 200 };
  const r = startRun({ ...s, quests: { ...s.quests, board: [offer] } }, 'q1', s.heroes.map((h) => h.id), DATA);
  assert.ok(r.ok, r.error);
  assert.equal(r.run.success, true);
});

test('raids wait for a Duskwood clear, then win or lose against Defence', () => {
  let s = town(4);
  s = { ...s, raids: { ...newRaids(), next: 1 } };
  assert.equal(threatOf(s), 0);
  const quiet = stepRaids(s, 5);
  assert.equal(quiet.raids.won + quiet.raids.lost, 0, 'no raid before a zone is cleared');
  s = cleared(s, { elwynn: ['fargodeep_mine'], westfall: ['the_deadmines'], duskwood: ['stitches'] });
  assert.ok(threatOf(s) > 0);
  const gold = 12345;
  // Defence is lowered to nothing by sending every hero away: no guard and no wall.
  const bare = { ...s, heroes: [], res: { ...s.res, gold, lumber: 1000, stone: 1000 } };
  const lost = stepRaids(bare, 5);
  assert.equal(lost.raids.lost, 1);
  assert.equal(lost.res.gold, gold, 'gold is never stolen');
  assert.equal(lost.res.lumber, 1000 - Math.floor(1000 * DATA.raids.steal.share));
  assert.equal(lost.town, bare.town, 'buildings are untouched');
  // A tall wall holds.
  const walled = { ...bare, town: { ...bare.town, buildings: { ...bare.town.buildings, wall_watchtower: 150 } } };
  const held = stepRaids(walled, 5);
  assert.equal(held.raids.won, 1);
  assert.equal(held.res.lumber, 1000);
  assert.ok(raidPreview(walled).safe);
  assert.ok(defenceOf(walled) > defenceOf(bare));
});

test('offline time lets at most one raid land', () => {
  let s = town(1);
  s = cleared(s, { elwynn: ['fargodeep_mine'], westfall: ['the_deadmines'], duskwood: ['stitches'] });
  s = { ...s, heroes: [], savedAt: T0, raids: { ...newRaids(), next: 60 }, res: { ...s.res, lumber: 1e5 } };
  const { state } = advance(s, T0 + 2 * 3600 * 1000);
  assert.equal(state.raids.won + state.raids.lost, 1);
  assert.equal(state.raids.budget, undefined);
});

test('achievements unlock once, stay through a Rebuild and raise the multiplier', () => {
  let s = town(5);
  const before = globalMultiplier({ ...s, achievements: {} });
  s = checkAchievements(s);
  for (const id of ['first_hero', 'roster_5', 'level_10', 'level_30', 'level_60', 'th_5', 'th_10', 'th_15']) assert.ok(s.achievements[id] !== undefined, id);
  const n = Object.keys(s.achievements).length;
  assert.equal(checkAchievements(s), s, 'nothing new, nothing changes');
  assert.ok(Math.abs(achievementMultiplier(s) - (1 + DATA.achievements.bonusEach * n)) < 1e-12);
  assert.ok(globalMultiplier(s) > before);
  s = { ...s, stats: { ...s.stats, lifetimeGold: 4e7 } };
  const r = rebuild(s);
  assert.ok(r.ok, r.error);
  assert.deepEqual(Object.keys(r.state.achievements).sort(), Object.keys(s.achievements).sort());
  assert.equal(r.state.raids.won + r.state.raids.lost, 0);
});

test('a version 7 save migrates to the current version with raids and achievements', () => {
  const base = newState({ seed: 4, now: 1000 });
  const old = JSON.parse(JSON.stringify({ ...base, v: 7 }));
  delete old.raids;
  delete old.achievements;
  const m = normalize(migrate(old, MIGRATIONS, SAVE_VERSION));
  assert.equal(m.v, SAVE_VERSION);
  assert.deepEqual(m.achievements, {});
  assert.equal(m.raids.won, 0);
  const dirty = JSON.parse(JSON.stringify(m));
  dirty.raids = { next: -5, won: 'x', lost: 2.7, seq: 1, budget: 9, log: [{ n: 1, won: true, threat: 5, defence: 6, lost: { gold: 5, lumber: 3 } }] };
  dirty.achievements = { th_5: 10, nope: 1 };
  const c = normalize(dirty);
  assert.equal(c.raids.budget, undefined);
  assert.deepEqual(c.raids.log[0].lost, { lumber: 3 });
  assert.deepEqual(Object.keys(c.achievements), ['th_5']);
  assert.ok(c.raids.next >= 1);
});
