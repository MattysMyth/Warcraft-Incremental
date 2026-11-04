import test from 'node:test';
import assert from 'node:assert/strict';
import { serialize, deserialize, migrate, normalize, exportString, importString } from '../src/engine/save.js';
import { validateData } from '../src/engine/data.js';
import { SAVE_VERSION } from '../src/engine/state.js';
import { fresh, withBuildings, withRes, DATA } from './helpers.js';

test('serialize then deserialize returns the same state', () => {
  const s = withRes(withBuildings(fresh(), { market: 4, farm: 2 }), { gold: 123.5, lumber: 9 });
  assert.deepEqual(deserialize(serialize(s)), s);
});

test('export and import strings round trip, compressed or not', async () => {
  const s = withBuildings(fresh(), { market: 40, lumber_camp: 33 });
  const text = await exportString(s);
  assert.match(text, /^OOA1\.[zj]\./);
  assert.deepEqual(await importString(text), s);
  assert.deepEqual(await importString(`  ${text}\n`), s, 'surrounding whitespace is ignored');
});

test('import rejects junk with a readable message', async () => {
  await assert.rejects(importString('hello'), /does not look like/);
  await assert.rejects(importString('OOA1.z.@@@@'), /damaged or incomplete/);
  const text = await exportString(fresh());
  await assert.rejects(importString(text.slice(0, -12)), /damaged or incomplete|not valid JSON/);
});

test('deserialize rejects saves that are not saves', () => {
  assert.throws(() => deserialize('not json'), /not valid JSON/);
  assert.throws(() => deserialize('[]'), /not an object/);
  assert.throws(() => deserialize('{}'), /no version/);
  assert.throws(() => deserialize(JSON.stringify({ v: SAVE_VERSION + 1 })), /newer version/);
});

test('migrations run in order from the save version up to the target', () => {
  const migrations = [
    (o) => ({ ...o, renamed: o.old }), // v1 -> v2
    (o) => ({ ...o, extra: 'added' }), // v2 -> v3
  ];
  const out = migrate({ v: 1, old: 'x' }, migrations, 3);
  assert.equal(out.v, 3);
  assert.equal(out.renamed, 'x');
  assert.equal(out.extra, 'added');
  assert.throws(() => migrate({ v: 1 }, [], 2), /No migration/);
});

test('normalize repairs missing and invalid fields', () => {
  const broken = {
    v: 1, savedAt: 5, seed: -1,
    res: { gold: 'lots', lumber: -4, stone: NaN },
    town: { buildings: { market: 3.7, ghost: 9 } },
    settings: { numberFormat: 'roman', buyAmount: 3 },
    log: [{ text: 'ok' }, null, { nope: 1 }],
  };
  const n = normalize(broken);
  assert.deepEqual(n.res, Object.fromEntries(DATA.resources.map((r) => [r.id, 0])));
  assert.equal(n.town.buildings.market, 3);
  assert.equal(n.town.buildings.farm, 0);
  assert.equal('ghost' in n.town.buildings, false);
  assert.equal(n.settings.numberFormat, 'suffix');
  assert.equal(n.settings.buyAmount, 1);
  assert.equal(n.log.length, 1);
  assert.equal(n.town.townHall, 1);
});

test('shipped data passes validation', () => {
  assert.deepEqual(validateData(DATA), []);
});

test('validator catches broken data', () => {
  const bad = structuredClone({
    economy: DATA.economy,
    resources: DATA.resources,
    buildings: DATA.buildings,
  });
  const byId = (id) => bad.buildings.find((b) => b.id === id);
  byId('lumber_camp').produces = 'mana';
  byId('farm').cost = { gold: -5, wood: 1 };
  byId('quarry').rate = 0;
  bad.buildings.push({ ...byId('market') });
  bad.economy.costGrowth = 1;
  bad.economy.milestones = [10, 5];
  const problems = validateData(bad).join('\n');
  assert.match(problems, /unknown resource "mana"/);
  assert.match(problems, /costs unknown resource "wood"/);
  assert.match(problems, /must be positive/);
  assert.match(problems, /needs a positive rate/);
  assert.match(problems, /duplicate building id/);
  assert.match(problems, /costGrowth/);
  assert.match(problems, /milestones/);
});
