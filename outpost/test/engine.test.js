import test from 'node:test';
import assert from 'node:assert/strict';
import { step } from '../src/engine/tick.js';
import { advance, effectiveSeconds } from '../src/engine/offline.js';
import { buyBuilding, collectTribute, setSetting } from '../src/engine/actions.js';
import { nextRandom } from '../src/engine/rng.js';
import { fmt, fmtDuration, fmtRate } from '../src/engine/numbers.js';
import { fresh, withRes, withBuildings, T0, eco } from './helpers.js';

const H = 3600;

test('a fresh game starts with the configured gold and no buildings', () => {
  const s = fresh();
  assert.equal(s.res.gold, 10);
  assert.ok(Object.values(s.town.buildings).every((n) => n === 0));
});

test('step adds income x dt and tracks lifetime gold', () => {
  const s = withBuildings(fresh(), { market: 2 });
  const s2 = step(s, 10);
  assert.ok(Math.abs(s2.res.gold - (10 + 10 * (0.5 + 1.2))) < 1e-9);
  assert.ok(Math.abs(s2.stats.lifetimeGold - 10 * 1.7) < 1e-9);
  assert.equal(step(s, 0), s);
});

test('stepping in small pieces equals one big step', () => {
  const s = withBuildings(fresh(), { market: 12, lumber_camp: 4, quarry: 2 });
  const big = step(s, 1000);
  let small = s;
  for (let i = 0; i < 100; i += 1) small = step(small, 10);
  for (const id of Object.keys(big.res)) {
    assert.ok(Math.abs(big.res[id] - small.res[id]) < 1e-6 * Math.max(1, big.res[id]), id);
  }
});

test('offline policy: 100% for 2h, 50% to 12h, 10% to 7 days, nothing beyond', () => {
  assert.equal(effectiveSeconds(0), 0);
  assert.equal(effectiveSeconds(1 * H), 1 * H);
  assert.equal(effectiveSeconds(2 * H), 2 * H);
  assert.equal(effectiveSeconds(4 * H), 2 * H + 1 * H);
  assert.equal(effectiveSeconds(12 * H), 2 * H + 5 * H);
  assert.equal(effectiveSeconds(7 * 24 * H), 7 * H + 0.1 * (156 * H));
  assert.equal(effectiveSeconds(30 * 24 * H), effectiveSeconds(7 * 24 * H));
});

test('advance credits offline time through the policy and reports it', () => {
  const s = withBuildings(fresh(), { market: 5 });
  const { state, report } = advance(s, T0 + 4 * H * 1000);
  const income = 0.5 + 5 * 0.6;
  assert.ok(Math.abs(report.credited - 3 * H) < 1e-6);
  assert.ok(Math.abs(state.res.gold - (10 + income * 3 * H)) < 1e-3 * state.res.gold);
  assert.equal(state.savedAt, T0 + 4 * H * 1000);
  assert.ok(report.gains.gold > 0);
  assert.equal(report.beyondLimit, false);
  assert.equal(advance(s, T0 + 8 * 24 * H * 1000).report.beyondLimit, true);
});

test('advance never runs time backwards', () => {
  const s = fresh();
  const { state, report } = advance(s, T0 - 5000);
  assert.equal(report.elapsed, 0);
  assert.equal(state.res.gold, s.res.gold);
});

test('live ticks and one long offline jump agree for the same credited time', () => {
  const s = withBuildings(fresh(), { market: 3 });
  let live = s;
  for (let i = 1; i <= 600; i += 1) live = advance(live, T0 + i * 100).state; // 60 s in 0.1 s ticks
  const jump = advance(s, T0 + 60_000).state;
  assert.ok(Math.abs(live.res.gold - jump.res.gold) < 1e-6 * jump.res.gold);
});

test('buying spends every cost resource and raises the level', () => {
  const s = withRes(fresh(), { gold: 100, lumber: 100 });
  const r = buyBuilding(s, 'market', 1);
  assert.ok(r.ok);
  assert.equal(r.state.town.buildings.market, 1);
  assert.ok(Math.abs(r.state.res.gold - 85) < 1e-9);
  assert.ok(Math.abs(r.state.res.lumber - 94) < 1e-9);
  assert.equal(s.town.buildings.market, 0, 'original state is untouched');
});

test('buying refuses when resources are short, and for unknown buildings', () => {
  assert.equal(buyBuilding(fresh(), 'market', 1).ok, false); // no lumber
  assert.equal(buyBuilding(fresh(), 'nope', 1).ok, false);
  assert.equal(buyBuilding(fresh(), 'lumber_camp', 0).ok, false);
  assert.equal(buyBuilding(withRes(fresh(), { gold: 0 }), 'lumber_camp', 'max').ok, false);
});

test('buy max spends exactly what max affordable allows', () => {
  const s = { ...withRes(fresh(), { gold: 200 }), town: { ...fresh().town, townHall: 5 } };
  const r = buyBuilding(s, 'lumber_camp', 'max');
  assert.ok(r.ok);
  assert.ok(r.bought > 10 && r.bought < 50);
  assert.ok(r.state.res.gold >= 0);
  const again = buyBuilding(r.state, 'lumber_camp', 1);
  assert.equal(again.ok, false, 'one more would not have been affordable');
});

test('reaching a milestone is logged', () => {
  const s = withBuildings(withRes(fresh(), { gold: 1e6 }), { lumber_camp: 9 });
  const r = buyBuilding(s, 'lumber_camp', 1);
  assert.ok(r.state.log.some((e) => /level 10: output doubled/.test(e.text)));
});

test('tribute adds gold and counts clicks', () => {
  const r = collectTribute(fresh());
  assert.equal(r.state.res.gold, 11);
  assert.equal(r.state.stats.tributes, 1);
  assert.equal(r.state.stats.lifetimeGold, 1);
});

test('settings validate their values', () => {
  assert.ok(setSetting(fresh(), 'buyAmount', 'max').ok);
  assert.equal(setSetting(fresh(), 'buyAmount', 7).ok, false);
  assert.equal(setSetting(fresh(), 'bogus', 1).ok, false);
  assert.equal(setSetting(fresh(), 'numberFormat', 'roman').ok, false);
});

test('the seeded generator is reproducible and spread out', () => {
  const run = (seed) => {
    const out = [];
    let s = seed;
    for (let i = 0; i < 5; i += 1) { const [v, n] = nextRandom(s); out.push(v); s = n; }
    return out;
  };
  assert.deepEqual(run(42), run(42));
  assert.notDeepEqual(run(42), run(43));
  assert.ok(run(7).every((v) => v >= 0 && v < 1));
});

test('number formatting truncates and switches notation', () => {
  assert.equal(fmt(0), '0');
  assert.equal(fmt(9.999), '9.99');
  assert.equal(fmt(15.96), '15.9');
  assert.equal(fmt(999.9), '999');
  assert.equal(fmt(1000), '1.00K');
  assert.equal(fmt(1234567), '1.23M');
  assert.equal(fmt(1e33), '1.00Dc');
  assert.equal(fmt(1e36), '1.00e36');
  assert.equal(fmt(12345, 'scientific'), '1.23e4');
  assert.equal(fmt(12345, 'engineering'), '12.34e3');
  assert.equal(fmtRate(0), '0/s');
  assert.equal(fmtRate(0.004), '<0.01/s');
  assert.equal(fmtRate(2.5), '2.50/s');
  assert.equal(fmtDuration(45), '45s');
  assert.equal(fmtDuration(192), '3m 12s');
  assert.equal(fmtDuration(7500), '2h 5m');
  assert.equal(fmtDuration(Infinity), 'never');
});

test('economy data keeps the design-doc offline tiers', () => {
  assert.deepEqual(eco.offlineTiers.map((t) => t.rate), [1, 0.5, 0.1]);
});
