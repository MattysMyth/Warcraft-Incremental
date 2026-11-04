import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate, loadBaseline } from '../sim/pacing.js';

const result = simulate({ maxHours: 100 });
const m = result.marks;

test('early game feels right: first build at once, first Market inside a minute', () => {
  assert.equal(m.first_lumber_camp, 0);
  assert.ok(m.first_market <= 60, `first market at ${m.first_market}s`);
  assert.ok(m.market_level_10 <= 10 * 60, 'Market level 10 inside ten minutes');
});

test('the first residents settle within five minutes', () => {
  assert.ok(m.first_resident <= 5 * 60, `first resident at ${m.first_resident}s`);
});

test('Town Hall upgrades follow the target schedule within 15%', () => {
  const minutes = [6, 20, 45, 90, 180, 300, 480, 720, 1080, 1560, 2280, 3180, 4380, 5940];
  minutes.forEach((target, i) => {
    const level = i + 2;
    const actual = m[`townhall_${level}`];
    assert.ok(actual !== undefined, `Town Hall ${level} never reached`);
    const want = target * 60;
    assert.ok(Math.abs(actual - want) <= want * 0.15, `Town Hall ${level}: ${actual}s vs target ${want}s`);
  });
});

test('every milestone matches the stored baseline within 15%', () => {
  const baseline = loadBaseline();
  assert.ok(baseline, 'data/pacing-baseline.json is missing: run "npm run sim -- --hours=100 --write"');
  const drifted = [];
  for (const [name, was] of Object.entries(baseline.marks)) {
    const now = m[name];
    if (now === undefined) { drifted.push(`${name}: no longer reached`); continue; }
    const tolerance = Math.max(10, was * 0.15); // 10 s floor for the first minutes
    if (Math.abs(now - was) > tolerance) drifted.push(`${name}: ${was}s -> ${now}s`);
  }
  assert.deepEqual(drifted, [], 'a milestone moved by more than 15%; re-tune or re-baseline on purpose');
});
