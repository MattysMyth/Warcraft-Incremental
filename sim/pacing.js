// Headless pacing simulation. A rule-following buyer plays the real engine with
// no clicking, and the time of each milestone is recorded. Run `npm run sim`.
// `npm run sim -- --write` stores the result as the baseline that the test
// suite compares against (a milestone moving more than 15% is flagged).
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DATA, isWorkplace, liveBuildings } from '../src/engine/data.js';
import { newState } from '../src/engine/state.js';
import { step } from '../src/engine/tick.js';
import { buyBuilding, buyTownHall, assignWorker } from '../src/engine/actions.js';
import {
  costOf, canAfford, flows, ecoFor, townHallCostFor, secondsToAfford, productionOf, globalMultiplier, levelOf, levelCap,
  isUnlocked, housingCapacity, storageCap, freeResidents, workersAt, workerCap, costExceedsStorage,
} from '../src/engine/derive.js';

export const BASELINE_PATH = fileURLToPath(new URL('../data/pacing-baseline.json', import.meta.url));

// How much the simulated player values one unit of each resource when ranking purchases.
const WEIGHT = { gold: 1, lumber: 0.5, stone: 0.5, food: 0.05, iron_ore: 0.5, iron_bars: 1, herbs: 1, arcane_dust: 2 };
// Residents go to workplaces in this order, five per building.
const WORKER_ORDER = ['market', 'lumber_camp', 'quarry', 'farm', 'mine', 'blacksmith', 'alchemy_lab', 'mage_tower'];

// The economy rules of a sensible player: what to buy next, given the state. Shared with the full-game bot.
// `forced` purchases (food, housing, storage, bottlenecks) come before the greedy payback ranking.
export function nextPurchase(s, data = DATA) {
  const lv = (id) => levelOf(s, id);
  const wait = (cost) => secondsToAfford(s.res, cost, flows(s, data).net);

  const net = flows(s, data).net;
  const th = s.town.townHall;
  const cap = levelCap(s, data);
  const wanted = [];

  const consider = (def, forced, why) => {
    if (!isUnlocked(def, s) || lv(def.id) >= cap) return null;
    const cost = costOf(def, lv(def.id), 1, ecoFor(s, data, def.id));
    return { kind: 'building', def, cost, forced, why };
  };

  // Rules a sensible player follows.
  const farm = data.buildingById.farm;
  const house = data.buildingById.house;
  const warehouse = data.buildingById.warehouse;
  if (lv('farm') === 0 && lv('market') >= 3) wanted.push(consider(farm, true, 'first farm'));
  if (lv('house') === 0 && s.res.food >= 5) wanted.push(consider(house, true, 'first house'));
  if (s.town.residents > 0 && (net.food < 0 || s.res.food < 20) && s.res.food < 200) wanted.push(consider(farm, true, 'food'));
  const workplaces = liveBuildings(data).filter((d) => isWorkplace(d) && lv(d.id) > 0).length;
  const desired = Math.min(workplaces * data.economy.workers.maxPerBuilding, 25);
  if (housingCapacity(s, data) - s.town.residents < 1 && s.town.residents < desired && s.res.food >= 5) {
    wanted.push(consider(house, true, 'housing'));
  }

  // Storage: if anything the player is saving for no longer fits, build a Warehouse.
  const nextTh = th < data.townHall.maxLevel ? townHallCostFor(s, th + 1, data) : null;
  const blockedBy = nextTh && costExceedsStorage(s, nextTh, data);
  if (blockedBy && isUnlocked(warehouse, s)) wanted.push(consider(warehouse, true, 'storage'));

  // Bottleneck: if the Town Hall is waiting on something other than gold, grow what makes it.
  if (nextTh && !blockedBy) {
    const waits = Object.entries(nextTh).map(([id, amount]) => [id, Math.max(0, amount - s.res[id]) / Math.max(net[id], 1e-9)]);
    const goldWait = waits.find(([id]) => id === 'gold')?.[1] ?? 0;
    const [slowId, slowWait] = waits.filter(([id]) => id !== 'gold').sort((a, b) => b[1] - a[1])[0] ?? [];
    if (slowId && slowWait > Math.max(goldWait, 1) * 1.2) {
      let maker = liveBuildings(data).find((d) => d.produces === slowId);
      if (maker?.kind === 'converter') {
        const feeder = liveBuildings(data).find((d) => d.produces === maker.from);
        const feederOut = lv(feeder.id) * feeder.rate;
        const makerIn = lv(maker.id) * maker.rate * maker.ratio;
        if (lv(maker.id) > 0 && makerIn > feederOut) maker = feeder;
        else if (lv(feeder.id) === 0) maker = feeder;
      }
      if (maker) wanted.push(consider(maker, true, `bottleneck ${slowId}`));
    }
  }

  const forced = wanted.filter(Boolean).filter((c) => Number.isFinite(wait(c.cost)));
  if (forced.length) return forced.sort((a, b) => wait(a.cost) - wait(b.cost))[0];

  // Greedy: best payback among producers still under their level cap.
  let best = null;
  const mult = globalMultiplier(s);
  for (const def of liveBuildings(data)) {
    if (!isWorkplace(def) || !isUnlocked(def, s) || lv(def.id) >= cap) continue;
    const cost = costOf(def, lv(def.id), 1, ecoFor(s, data, def.id));
    if (costExceedsStorage(s, cost, data)) continue;
    const w = wait(cost);
    if (!Number.isFinite(w)) continue;
    const gain = (productionOf(def, lv(def.id) + 1, mult, data.economy) - productionOf(def, lv(def.id), mult, data.economy)) * (WEIGHT[def.produces] ?? 0.5);
    if (gain <= 0) continue;
    const spend = Object.entries(cost).reduce((a, [id, n]) => a + n * (WEIGHT[id] ?? 1), 0);
    const score = w + spend / gain;
    if (!best || score < best.score) best = { kind: 'building', def, cost, score };
  }

  // Town Hall: buy it once it is the better use of the wait, or when nothing else is left to build.
  if (nextTh && !blockedBy) {
    const w = wait(nextTh);
    if (Number.isFinite(w) && (!best || w <= best.score || w < 30)) return { kind: 'townhall', cost: nextTh };
  }
  return best;
}

export function simulate({ maxHours = 24, data = DATA } = {}) {
  let s = newState({ seed: 1, now: 0, data });
  let t = 0;
  const limit = maxHours * 3600;
  const marks = {};
  const mark = (name) => { if (!(name in marks)) marks[name] = Math.round(t); };
  const lv = (id) => levelOf(s, id);

  const wait = (cost) => secondsToAfford(s.res, cost, flows(s, data).net);
  const advance = (dt) => { s = step(s, Math.min(dt, limit - t), data); t = Math.min(limit, t + dt); };
  const bought = (id) => {
    mark(`first_${id}`);
    for (const m of data.economy.milestones) if (lv(id) >= m) mark(`${id}_level_${m}`);
  };

  function assignWorkers() {
    // Fill the full-value slots of every building first, then the smaller extra slots.
    for (const pass of [0, 1]) for (const id of WORKER_ORDER) {
      const limit = pass === 0 ? data.economy.workers.maxPerBuilding : workerCap(s, id, data);
      while (freeResidents(s) > 0 && lv(id) > 0 && workersAt(s, id) < limit) {
        const r = assignWorker(s, id, 1, data);
        if (!r.ok) break;
        s = r.state;
      }
    }
  }

  for (let guard = 0; guard < 200_000 && t < limit; guard += 1) {
    assignWorkers();
    const pick = nextPurchase(s, data);
    if (!pick) { advance(limit - t); break; }
    const w = wait(pick.cost);
    if (t + w > limit) { advance(limit - t); break; }
    advance(w);
    assignWorkers();
    if (pick.kind === 'townhall') {
      const r = buyTownHall(s, data);
      if (!r.ok) { advance(1); continue; }
      s = r.state;
      mark(`townhall_${s.town.townHall}`);
    } else {
      const r = buyBuilding(s, pick.def.id, 1, data);
      if (!r.ok) { advance(1); continue; }
      s = r.state;
      bought(pick.def.id);
    }
    if (s.town.residents >= 1) mark('first_resident');
    for (const g of [1e4, 1e5, 1e6, 1e7, 1e8, 1e9]) {
      if (s.stats.lifetimeGold >= g) mark(`lifetime_gold_${g.toExponential(0).replace('+', '')}`);
    }
  }
  return {
    marks,
    final: {
      hours: Math.round((t / 3600) * 100) / 100,
      townHall: s.town.townHall,
      residents: s.town.residents,
      levels: { ...s.town.buildings },
      lifetimeGold: Math.round(s.stats.lifetimeGold),
    },
  };
}

export function loadBaseline() {
  return existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : null;
}

export const fmtT = (sec) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const x = sec % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : m ? `${m}m ${String(x).padStart(2, '0')}s` : `${x}s`;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const hours = Number(process.argv.find((a) => a.startsWith('--hours='))?.split('=')[1] ?? 24);
  const result = simulate({ maxHours: hours });
  console.log(`Simulated ${result.final.hours} h. Town Hall ${result.final.townHall}, ${result.final.residents} residents.`);
  console.log(`Levels: ${JSON.stringify(result.final.levels)}`);
  console.log(`Lifetime gold: ${result.final.lifetimeGold.toLocaleString('en')}`);
  for (const [name, sec] of Object.entries(result.marks)) console.log(`  ${name.padEnd(22)} ${fmtT(sec)}`);
  if (process.argv.includes('--write')) {
    writeFileSync(BASELINE_PATH, `${JSON.stringify({ maxHours: hours, marks: result.marks }, null, 2)}\n`);
    console.log(`Baseline written to ${BASELINE_PATH}`);
  }
}
