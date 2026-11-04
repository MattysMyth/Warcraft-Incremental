import test from 'node:test';
import assert from 'node:assert/strict';
import { startRun } from '../src/engine/quests.js';
import { refreshPool, recruitHero } from '../src/engine/actions.js';
import { legacyGain, retireHero, retirePreview, buyLegacy, heroTier, heirBonus, retireOpen } from '../src/engine/legacy.js';
import { heirsOf } from '../src/engine/heirs.js';
import { epoch, epochPreview, buySands, sandsGain } from '../src/engine/epoch.js';
import { rebuild, startingTown } from '../src/engine/rebuild.js';
import { sheetOf, recruitCost, heroCap, addXp } from '../src/engine/heroes.js';
import { globalMultiplier } from '../src/engine/derive.js';
import { bonusOf, legacyMultiplier, sandsMultiplier } from '../src/engine/renown.js';
import { zoneOpen } from '../src/engine/zones.js';
import { step } from '../src/engine/tick.js';
import { advance, effectiveSeconds } from '../src/engine/offline.js';
import { normalize, migrate, deserialize, serialize, MIGRATIONS } from '../src/engine/save.js';
import { validateData } from '../src/engine/data.js';
import { newState, SAVE_VERSION } from '../src/engine/state.js';
import { fresh, withRes, withBuildings, DATA, T0 } from './helpers.js';

const rich = (s) => withRes(s, { gold: 1e12, lumber: 1e12, stone: 1e12, iron_bars: 1e9, iron_ore: 1e9, food: 1e9, herbs: 1e6, leather: 1e6, arcane_dust: 1e6 });
const item = (tier, id = 'i900') => ({ id, slot: 'weapon', tier, rarity: 'common', name: 'Test blade', lines: [{ stat: 'strength', value: 5 }] });

// A late town with `n` heroes of level `level`, all carrying tier-`tier` weapons.
function vets(n, { level = 50, tier = 3, archives = 1 } = {}) {
  let s = rich(fresh());
  s = { ...s, town: { ...s.town, townHall: 15 } };
  s = withBuildings(s, { tavern: 30, barracks: 10, chapel: 12, alchemy_lab: 5, house: 60, archives });
  s = step(s, 0.1);
  for (let i = 0; i < n; i += 1) {
    if (!s.tavern.pool.some((c) => !c.hired)) s = refreshPool(s).state;
    const r = recruitHero(s, s.tavern.pool.filter((c) => !c.hired)[0].id);
    assert.ok(r.ok, r.error);
    s = r.state;
  }
  return { ...s, heroes: s.heroes.map((h, i) => ({ ...h, level, gear: { ...h.gear, weapon: item(tier, `i9${i}`) } })) };
}

test('the Legacy and Sands data validates and the shops are indexed', () => {
  assert.deepEqual(validateData(DATA), []);
  assert.equal(DATA.legacy.upgrades.filter((u) => u.key === 'class').length, 12);
  assert.ok(DATA.bonusSources.goldBoost.some((x) => x.field === 'legacyUpgrades'));
  assert.ok(DATA.bonusSources.boardSlots.some((x) => x.field === 'sandsUpgrades'));
  assert.equal(DATA.classTalents.warrior.length, 2);
});

test('Legacy gain follows level and gear tier, and stays zero below the retirement level', () => {
  const s = vets(1, { level: 40, tier: 3 });
  const h = s.heroes[0];
  assert.equal(heroTier(h), 3);
  const g = DATA.legacy.gain;
  assert.equal(legacyGain(s, h), Math.floor(((40 - g.fromLevel) ** g.exp * 3) / g.divisor));
  assert.equal(legacyGain(s, { ...h, level: 39 }), 0);
  assert.ok(legacyGain(s, { ...h, level: 60 }) > legacyGain(s, h));
  assert.ok(legacyGain(s, { ...h, gear: { weapon: item(6) } }) > legacyGain(s, h));
  const boosted = { ...s, prestige: { ...s.prestige, sandsUpgrades: { legacy_ledger: 2 } } };
  assert.ok(legacyGain(boosted, h) >= legacyGain(s, h));
});

test('retiring needs the Archives, level 40 and a hero at home, and pays Legacy', () => {
  const s = vets(3, { level: 50, tier: 3 });
  const id = s.heroes[0].id;
  const none = vets(1, { level: 50, archives: 0 });
  assert.equal(retireOpen(none), false);
  assert.equal(retireHero(none, none.heroes[0].id).ok, false);
  assert.equal(retireHero(s, 'nobody').ok, false);
  const young = { ...s, heroes: s.heroes.map((h) => ({ ...h, level: 39 })) };
  assert.equal(retireHero(young, id).ok, false);
  const away = { ...s, quests: { ...s.quests, active: [{ id: 'q1', party: [id], offer: {} }] } };
  assert.equal(retirePreview(away, away.heroes[0]).can, false);
  const r = retireHero(s, id);
  assert.ok(r.ok, r.error);
  const gain = legacyGain(s, s.heroes[0]);
  assert.ok(gain > 0);
  assert.equal(r.state.heroes.length, 2);
  assert.equal(r.state.prestige.legacy, gain);
  assert.equal(r.state.prestige.legacyTotal, gain);
  assert.equal(r.state.prestige.legacyEra, gain);
  assert.equal(r.state.hall.length, 1);
  assert.equal(r.state.hall[0].legacy, gain);
  assert.equal(r.state.hall[0].startLevel, Math.floor(50 * DATA.legacy.descendants.startShare));
  assert.ok(r.state.items.some((i) => i.id === 'i90'), 'their gear returns to the bag');
  assert.ok(globalMultiplier(r.state) > globalMultiplier(s));
  assert.equal(retireOpen(rebuild({ ...r.state, stats: { ...r.state.stats, lifetimeGold: 1e9 } }).state), true, 'Legacy history keeps retirement open');
});

test('retiring takes the hero out of standing orders', () => {
  const s = vets(3);
  const [a, b] = s.heroes.map((h) => h.id);
  const withOrders = { ...s, quests: { ...s.quests, orders: [
    { id: 'o1', mode: 'best', template: null, party: [a, b], minOdds: 0.75, potion: null, paused: false, wait: 0, note: '', runs: 0 },
    { id: 'o2', mode: 'best', template: null, party: [s.heroes[2].id], minOdds: 0.75, potion: null, paused: false, wait: 0, note: '', runs: 0 },
  ] } };
  const r = retireHero(retireHero(withOrders, a).state, s.heroes[2].id);
  assert.deepEqual(r.state.quests.orders.map((o) => [o.id, o.party]), [['o1', [b]]]);
});

test('heirs come from the Hall, cost less, start higher and carry an ancestor bonus', () => {
  let s = vets(1, { level: 60, tier: 5 });
  const ancestor = s.heroes[0];
  s = retireHero(s, ancestor.id).state;
  const heirs = heirsOf(s);
  assert.equal(heirs.length, 1);
  const heir = heirs[0];
  assert.equal(heir.class, ancestor.class);
  assert.equal(heir.level, 30);
  assert.equal(heir.name.split(' ').slice(1).join(' '), ancestor.name.split(' ').slice(1).join(' '), 'the family name carries on');
  assert.deepEqual(heirsOf(s), heirs, 'the same save always shows the same heir');
  const plain = { ...heir, heir: false };
  assert.ok(recruitCost(s, heir) < recruitCost(s, plain) * (1 - DATA.legacy.descendants.discount) + 2);
  const r = recruitHero(withRes(s, { gold: 1e12 }), heir.id);
  assert.ok(r.ok, r.error);
  assert.equal(r.state.hall[0].claimed, true);
  assert.equal(heirsOf(r.state).length, 0);
  assert.equal(r.hero.ancestor.name, ancestor.name);
  const born = r.state.heroes[0];
  const base = { ...born, ancestor: undefined };
  assert.ok(sheetOf(r.state, born).hp > sheetOf(r.state, base).hp);
  assert.ok(sheetOf(r.state, born).power > sheetOf(r.state, base).power);
  assert.equal(recruitHero(r.state, heir.id).ok, false, 'an heir joins only once');
});

test('only the newest heirs are offered, and the ancestor bonus is capped', () => {
  let s = vets(5, { level: 50, tier: 3 });
  for (const h of [...s.heroes]) s = retireHero(s, h.id).state;
  assert.equal(s.hall.length, 5);
  assert.deepEqual(heirsOf(s).map((c) => c.hall), ['v5', 'v4', 'v3'].slice(0, DATA.legacy.descendants.max));
  assert.equal(heirBonus(1e9), DATA.legacy.descendants.cap);
});

test('Legacy talents and auras are bought with Legacy and take effect', () => {
  let s = vets(1, { level: 50 });
  const h = s.heroes[0];
  const up = DATA.classTalents[h.class][0];
  assert.equal(buyLegacy(s, up.id).ok, false, 'no Legacy yet');
  assert.equal(buyLegacy(s, 'nope').ok, false);
  s = { ...s, prestige: { ...s.prestige, legacy: 1e6, legacyTotal: 1e6 } };
  const before = sheetOf(s, h);
  const r = buyLegacy(s, up.id);
  assert.ok(r.ok, r.error);
  assert.equal(r.cost, up.cost.base);
  assert.equal(r.state.prestige.legacy, 1e6 - up.cost.base);
  const after = sheetOf(r.state, h);
  assert.ok(after[up.effect === 'power' ? 'power' : up.effect] > before[up.effect === 'power' ? 'power' : up.effect] || up.effect === 'haste', up.effect);
  const other = r.state.heroes.length ? { ...h, class: DATA.heroes.classes.find((c) => c.id !== h.class).id, talents: [] } : h;
  assert.equal(sheetOf(r.state, other).hp, sheetOf(s, other).hp, 'talents only reach their own class');
  let a = r.state;
  const gold = DATA.bonusSources.goldBoost.find((x) => x.field === 'legacyUpgrades').up;
  assert.equal(bonusOf(a, 'goldBoost') - bonusOf(s, 'goldBoost'), 0);
  a = buyLegacy(a, gold.id).state;
  assert.equal(bonusOf(a, 'goldBoost'), gold.values[0]);
  for (let i = 1; i < gold.values.length; i += 1) a = buyLegacy(a, gold.id).state;
  assert.equal(buyLegacy(a, gold.id).ok, false, 'already at the top');
});

test('the Legacy and Sands multipliers are separate and permanent through a Rebuild', () => {
  let s = vets(1);
  s = { ...s, prestige: { ...s.prestige, legacyTotal: 100, sandsTotal: 10 } };
  const m = globalMultiplier(s);
  assert.ok(Math.abs(m / globalMultiplier({ ...s, prestige: { ...s.prestige, legacyTotal: 0, sandsTotal: 0 } }) - legacyMultiplier(100) * sandsMultiplier(10)) < 1e-9);
  s = { ...s, stats: { ...s.stats, lifetimeGold: 1e9 } };
  const r = rebuild(s);
  assert.equal(r.state.prestige.legacyTotal, 100);
  assert.equal(r.state.prestige.sandsTotal, 10);
  assert.equal(r.state.era, 1);
  assert.equal(r.state.hall, s.hall);
});

test('a raid first clear pays Legacy and an era boss opens the Epoch', () => {
  let s = vets(10, { level: 60, tier: 3 });
  s = { ...s, quests: { ...s.quests, board: [{ id: 'q1', n: 1, template: 'zul_gurub', type: 'raid', zone: 'stranglethorn', level: 36, modifier: 'standard', title: 'Zul', text: '', duration: 60, rec: 1 }] } };
  const go = startRun(s, 'q1', s.heroes.map((h) => h.id), DATA);
  assert.ok(go.ok, go.error);
  const done = step(go.state, 61);
  assert.equal(done.quests.history[0].ok, true);
  assert.equal(done.prestige.legacy, DATA.legacy.raidPoints.zul_gurub);
  assert.equal(done.prestige.legacyEra, DATA.legacy.raidPoints.zul_gurub);
  assert.deepEqual(done.prestige.bosses, [], 'Zul\'Gurub is not an era boss');
  // The same raid again, in the same run, pays nothing more.
  const again = { ...done, quests: { ...done.quests, board: [{ ...s.quests.board[0], id: 'q2', n: 2 }] }, heroes: done.heroes.map((h) => ({ ...h, injury: 0 })) };
  const go2 = startRun(again, 'q2', again.heroes.map((h) => h.id), DATA);
  assert.equal(step(go2.state, 61).prestige.legacy, DATA.legacy.raidPoints.zul_gurub);
  // Ragnaros is the Era 1 boss.
  const rag = { ...s, quests: { ...s.quests, board: [{ ...s.quests.board[0], template: 'ragnaros', zone: 'molten', level: 60, title: 'Ragnaros' }] } };
  const go3 = startRun(rag, 'q1', rag.heroes.map((h) => h.id), DATA);
  assert.ok(go3.ok, go3.error);
  const won = step(go3.state, 61);
  assert.equal(won.quests.history[0].ok, true);
  assert.deepEqual(won.prestige.bosses, ['era1']);
  assert.equal(won.prestige.legacy, DATA.legacy.raidPoints.ragnaros);
});

test('the Epoch needs the era boss, retires veterans, and resets the right state', () => {
  let s = vets(4, { level: 55, tier: 4 });
  s = { ...s, heroes: s.heroes.map((h, i) => (i === 3 ? { ...h, level: 20 } : h)) };
  s = { ...s, prestige: { ...s.prestige, renown: 7, renownTotal: 30, upgrades: { headstart: 2 }, legacy: 12, legacyTotal: 12, legacyEra: 12, legacyUpgrades: { a_gold: 1 } },
    zones: { ...s.zones, elwynn: { cleared: ['fargodeep_mine'], rep: 77, trophies: 3, story: 2 } },
    achievements: { first_hero: 1 }, stats: { ...s.stats, lifetimeGold: 5e6 } };
  const blocked = epoch(s);
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /Era 1 boss/);
  s = { ...s, prestige: { ...s.prestige, bosses: ['era1'] } };
  const pre = epochPreview(s);
  assert.equal(pre.can, true);
  assert.equal(pre.retiring, 3);
  assert.equal(pre.lost, 1);
  assert.ok(pre.gain >= DATA.sands.gain.perEra);
  const r = epoch(s);
  assert.ok(r.ok, r.error);
  const n = r.state;
  assert.equal(n.era, 2);
  assert.equal(n.heroes.length, 0);
  assert.deepEqual(n.items, []);
  assert.equal(n.hall.length, 3);
  assert.equal(n.stats.epochs, 1);
  assert.equal(n.stats.pastGold, 5e6);
  assert.equal(n.prestige.renown, 0);
  assert.equal(n.prestige.renownTotal, 0);
  assert.deepEqual(n.prestige.upgrades, {});
  assert.equal(n.prestige.legacyEra, 0);
  assert.ok(n.prestige.legacy > 12, 'veterans paid Legacy');
  assert.equal(n.prestige.legacyTotal, n.prestige.legacy);
  assert.deepEqual(n.prestige.legacyUpgrades, { a_gold: 1 });
  assert.equal(n.prestige.sands, r.gain);
  assert.equal(n.prestige.sandsTotal, r.gain);
  assert.equal(n.town.townHall, 1);
  assert.equal(n.town.buildings.tavern, 0);
  assert.equal(n.res.gold, startingTown ? DATA.economy.startingResources.gold : 0);
  assert.deepEqual(n.zones.elwynn.cleared, []);
  assert.equal(n.zones.elwynn.rep, 77, 'zone standing is kept');
  assert.equal(n.zones.elwynn.story, 2);
  assert.deepEqual(n.achievements, s.achievements);
  assert.equal(n.quests.active.length, 0);
  assert.equal(n.raids.won + n.raids.lost, 0);
  assert.equal(epoch(n).ok, false, 'Era 2 is the last written so far');
  assert.match(epoch(n).error, /last Era/);
});

test('Sands of Time scale with the Legacy earned in the Era', () => {
  assert.equal(sandsGain(0), DATA.sands.gain.perEra);
  assert.ok(sandsGain(400) > sandsGain(100));
  assert.ok(sandsMultiplier(10) > 1);
});

test('Sands upgrades are bought with Sands and feed the shared bonus reader', () => {
  let s = fresh();
  assert.equal(buySands(s, 'journal').ok, false);
  s = { ...s, prestige: { ...s.prestige, sands: 100, sandsTotal: 100 } };
  const r = buySands(s, 'keepsake');
  assert.ok(r.ok, r.error);
  assert.equal(bonusOf(r.state, 'townHall'), 2);
  assert.equal(startingTown(r.state).townHall, 2);
  assert.equal(r.state.prestige.sands, 100 - DATA.sandsById.keepsake.cost.base);
  assert.equal(buySands(s, 'nope').ok, false);
  const b = buySands(s, 'second_board').state;
  assert.equal(bonusOf(b, 'boardSlots'), 4);
  const h = buySands(s, 'hourglass').state;
  assert.ok(effectiveSeconds(86400, DATA.economy.offlineTiers, bonusOf(h, 'offlineRate')) > effectiveSeconds(86400));
  assert.equal(effectiveSeconds(1000, DATA.economy.offlineTiers, 0.5), 1000, 'the first tier was already full rate');
});

test('the Warden\'s Journal records long absences only when bought', () => {
  const base = { ...fresh(), savedAt: T0 };
  const off = advance(base, T0 + 3600 * 1000).state;
  assert.deepEqual(off.journal, []);
  const bought = { ...base, prestige: { ...base.prestige, sandsUpgrades: { journal: 1 } } };
  const on = advance(bought, T0 + 3600 * 1000).state;
  assert.equal(on.journal.length, 1);
  assert.equal(on.journal[0].away, 3600);
});

test('Era 2 raises the level cap and opens Hellfire Peninsula', () => {
  const s = fresh();
  assert.equal(heroCap(s), 60);
  assert.equal(heroCap({ ...s, era: 2 }), 70);
  assert.equal(zoneOpen(s, 'hellfire'), false);
  assert.equal(zoneOpen({ ...s, era: 2 }, 'hellfire'), true);
  const hero = { level: 60, xp: 0 };
  assert.equal(addXp(hero, 1e9, DATA).level, 60);
  assert.equal(addXp(hero, 1e9, DATA, 70).level, 70);
  assert.equal(DATA.templateById.ragnaros.eraBoss, 1);
  assert.equal(DATA.templateById.hellfire_ramparts.eraBoss, 2);
});

test('a version 8 save migrates to version 9 in Era 1 with empty Legacy and Sands', () => {
  const base = newState({ seed: 4, now: 1000 });
  const old = JSON.parse(JSON.stringify({ ...base, v: 8 }));
  for (const k of ['era', 'hall', 'journal']) delete old[k];
  old.prestige = { renown: 5, renownTotal: 9, legacy: 0, sands: 0, upgrades: { headstart: 1 } };
  delete old.stats.epochs;
  const m = normalize(migrate(old, MIGRATIONS, SAVE_VERSION));
  assert.equal(m.v, SAVE_VERSION);
  assert.equal(m.era, 1);
  assert.deepEqual(m.hall, []);
  assert.equal(m.prestige.renown, 5);
  assert.equal(m.prestige.renownTotal, 9);
  assert.deepEqual(m.prestige.upgrades, { headstart: 1 });
  assert.equal(m.prestige.legacyTotal, 0);
  assert.equal(m.stats.epochs, 0);
});

test('bad Legacy, Hall and Era values in a save are cleaned', () => {
  const base = newState({ seed: 4, now: 1000 });
  const dirty = JSON.parse(JSON.stringify(base));
  dirty.era = 99;
  dirty.hall = [{ id: 'v1', n: 1, name: 'Old Hero', race: 'human', class: 'warrior', trait: 'stalwart', level: 55, tier: 4, legacy: 20, era: 1, bonus: 5, startLevel: 27, claimed: false }, { id: 'v1' }, null, { id: 'v2', class: 'nope' }];
  dirty.prestige = { ...dirty.prestige, legacy: 5, legacyTotal: 1, legacyUpgrades: { warrior_1: 99, nope: 3 }, sandsUpgrades: { journal: 5 }, bosses: ['era1', 'era1', 'bad'], sands: -3 };
  dirty.heroes = [{ id: 'h1', name: 'Tall', race: 'human', class: 'warrior', trait: 'stalwart', level: 99, xp: 5, talents: [], gear: {}, ancestor: { name: 'Elder', bonus: 99 } }];
  const n = normalize(dirty);
  assert.equal(n.era, DATA.sands.maxEra);
  assert.equal(n.hall.length, 1);
  assert.equal(n.hall[0].bonus, DATA.legacy.descendants.cap);
  assert.equal(n.counters.hall, 1);
  assert.equal(n.prestige.legacyTotal, 5, 'the total is never below the balance');
  assert.deepEqual(n.prestige.legacyUpgrades, { warrior_1: DATA.legacyById.warrior_1.values.length });
  assert.deepEqual(n.prestige.sandsUpgrades, { journal: 1 });
  assert.deepEqual(n.prestige.bosses, ['era1']);
  assert.equal(n.prestige.sands, 0);
  assert.equal(n.heroes[0].level, 70, 'Era 2 allows level 70');
  assert.equal(n.heroes[0].ancestor.bonus, DATA.legacy.descendants.cap);
  const era1 = normalize({ ...dirty, era: 1 });
  assert.equal(era1.heroes[0].level, 60, 'Era 1 caps at 60');
  const round = deserialize(serialize(n));
  assert.deepEqual(round, n);
});
