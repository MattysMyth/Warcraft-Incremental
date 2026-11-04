import test from 'node:test';
import assert from 'node:assert/strict';
import {
  costOf, canAfford, maxAffordable, milestoneMultiplier, nextMilestone,
  productionOf, incomePerSec, incomeBreakdown, secondsToAfford,
} from '../src/engine/derive.js';
import { fresh, withRes, withBuildings, DATA, eco } from './helpers.js';

const market = DATA.buildingById.market;

test('cost follows base * 1.15^level for a single purchase', () => {
  for (const level of [0, 1, 5, 10, 40]) {
    const c = costOf(market, level, 1, eco);
    assert.ok(Math.abs(c.gold - 15 * 1.15 ** level) < 1e-9 * c.gold);
    assert.ok(Math.abs(c.lumber - 6 * 1.15 ** level) < 1e-9 * c.lumber);
  }
});

test('bulk cost equals the sum of single purchases', () => {
  for (const [level, count] of [[0, 10], [7, 25], [30, 3]]) {
    let sum = 0;
    for (let i = 0; i < count; i += 1) sum += costOf(market, level + i, 1, eco).gold;
    const bulk = costOf(market, level, count, eco).gold;
    assert.ok(Math.abs(bulk - sum) < 1e-9 * bulk, `level ${level} x${count}`);
  }
});

test('maxAffordable matches a brute-force count', () => {
  const cases = [
    { gold: 0, lumber: 0 },
    { gold: 15, lumber: 6 },
    { gold: 1000, lumber: 20 },
    { gold: 20, lumber: 5000 },
    { gold: 5e6, lumber: 5e6 },
  ];
  for (const have of cases) {
    for (const level of [0, 3, 12]) {
      let n = 0;
      let g = have.gold;
      let l = have.lumber;
      for (;;) {
        const c = costOf(market, level + n, 1, eco);
        if (c.gold > g || c.lumber > l) break;
        g -= c.gold; l -= c.lumber; n += 1;
        if (n > 5000) break;
      }
      assert.equal(maxAffordable(have, market, level, eco), n, JSON.stringify({ have, level }));
    }
  }
});

test('milestone doubling happens exactly at the listed levels', () => {
  const expected = { 0: 1, 9: 1, 10: 2, 24: 2, 25: 4, 49: 4, 50: 8, 200: 8 };
  for (const [level, m] of Object.entries(expected)) {
    assert.equal(milestoneMultiplier(Number(level), eco), m, `level ${level}`);
  }
  assert.deepEqual(nextMilestone(7, eco), { at: 10, remaining: 3 });
  assert.equal(nextMilestone(50, eco), null);
});

test('production is level x rate x doublings', () => {
  assert.equal(productionOf(market, 5, 1, eco), 5 * 0.6);
  assert.ok(Math.abs(productionOf(market, 10, 1, eco) - 10 * 0.6 * 2) < 1e-12);
  assert.ok(Math.abs(productionOf(market, 25, 1, eco) - 25 * 0.6 * 4) < 1e-12);
  assert.ok(Math.abs(productionOf(market, 50, 2, eco) - 50 * 0.6 * 8 * 2) < 1e-12);
});

test('income combines the stipend with every building', () => {
  const s = withBuildings(fresh(), { market: 10, lumber_camp: 3, quarry: 1, farm: 2 });
  const inc = incomePerSec(s);
  assert.ok(Math.abs(inc.gold - (0.5 + 10 * 0.6 * 2)) < 1e-12);
  assert.ok(Math.abs(inc.lumber - 3 * 0.4) < 1e-12);
  assert.ok(Math.abs(inc.stone - 0.25) < 1e-12);
  assert.ok(Math.abs(inc.food - 2 * 0.3) < 1e-12);
  const b = incomeBreakdown(s);
  assert.equal(b.gold.sources.length, 2);
  assert.ok(Math.abs(b.gold.sources.reduce((a, x) => a + x.amount, 0) - b.gold.total) < 1e-12);
});

test('secondsToAfford handles ready, waiting and impossible cases', () => {
  const s = withRes(fresh(), { gold: 0, lumber: 0 });
  const income = incomePerSec(withBuildings(s, { lumber_camp: 1 }));
  assert.equal(secondsToAfford({ gold: 100, lumber: 100 }, { gold: 50, lumber: 50 }, income), 0);
  assert.ok(Math.abs(secondsToAfford({ gold: 0, lumber: 0 }, { gold: 5 }, income) - 10) < 1e-9);
  assert.equal(secondsToAfford({ stone: 0 }, { stone: 5 }, income), Infinity);
});

test('canAfford needs every resource', () => {
  assert.ok(canAfford({ gold: 15, lumber: 6 }, { gold: 15, lumber: 6 }));
  assert.ok(!canAfford({ gold: 15, lumber: 5.9 }, { gold: 15, lumber: 6 }));
});
