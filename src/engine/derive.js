// Everything derived from state plus data lives here. Nothing in this file is
// ever stored in a save.
import { DATA, isLive, isWorkplace, liveBuildings, townHallCost } from './data.js';
import { bonusOf, renownMultiplier, renownTotal, resourceBoost, legacyMultiplier, legacyTotal, sandsMultiplier, sandsTotal } from './renown.js';

export const levelOf = (state, id) => state.town.buildings[id] ?? 0;

// ---- Town Hall, caps, housing, workers ----

// The highest level any building may reach at the current Town Hall level.
export function levelCap(state, data = DATA) {
  return data.economy.levelsPerTownHall * state.town.townHall;
}

export function isUnlocked(def, state) {
  return isLive(def) && def.unlockTownHall <= state.town.townHall;
}

export function housingCapacity(state, data = DATA) {
  const { base, perHouseLevel } = data.economy.housing;
  return base + perHouseLevel * levelOf(state, 'house') + bonusOf(state, 'housing', data);
}

// Storage limit for a resource. Uncapped resources (gold, tier 2 and 3) are Infinity.
export function storageCap(state, resourceId, data = DATA) {
  if (!data.resourceById[resourceId].capped) return Infinity;
  const { base, perWarehouseLevel } = data.economy.caps;
  return base * perWarehouseLevel ** levelOf(state, 'warehouse') * (1 + bonusOf(state, 'storageBoost', data));
}

export function workersAt(state, id) {
  return state.town.workers[id] ?? 0;
}

export function workersAssigned(state) {
  return Object.values(state.town.workers).reduce((a, n) => a + n, 0);
}

export function freeResidents(state) {
  return state.town.residents - workersAssigned(state);
}

export function workerMultiplier(state, id, data = DATA) {
  const { maxPerBuilding, bonusEach } = data.economy.workers;
  return 1 + bonusEach * Math.min(workersAt(state, id), maxPerBuilding);
}

// ---- Levels and costs ----

export function milestoneMultiplier(level, eco = DATA.economy) {
  let m = 1;
  for (const at of eco.milestones) if (level >= at) m *= eco.milestoneMultiplier;
  return m;
}

// Next milestone above `level`, or null when every doubling has been reached.
export function nextMilestone(level, eco = DATA.economy) {
  const at = eco.milestones.find((m) => level < m);
  return at === undefined ? null : { at, remaining: at - level };
}

// Product of every global multiplier: Renown, Legacy, Sands of Time and achievements.
export function globalMultiplier(state, data = DATA) {
  return renownMultiplier(renownTotal(state), data) * legacyMultiplier(legacyTotal(state), data) * sandsMultiplier(sandsTotal(state), data)
    * (1 + data.achievements.bonusEach * Object.keys(state.achievements ?? {}).length);
}

// The economy as this player sees it: building prices carry the Guild Masons discount.
export function ecoFor(state, data = DATA) {
  const cut = bonusOf(state, 'buildingDiscount', data);
  return cut > 0 ? { ...data.economy, costScale: 1 - cut } : data.economy;
}

// Cost of buying `count` levels of a building that is currently at `level`.
export function costOf(def, level, count = 1, eco = DATA.economy) {
  const g = eco.costGrowth;
  const k = eco.costScale ?? 1;
  const sum = (g ** level) * ((g ** count - 1) / (g - 1)) * k;
  const out = {};
  for (const [id, base] of Object.entries(def.cost)) out[id] = base * sum;
  return out;
}

// Town Hall prices carry the Royal Charter discount.
export function townHallCostFor(state, level, data = DATA) {
  const base = townHallCost(level, data);
  if (!base) return null;
  const k = 1 - bonusOf(state, 'townHallDiscount', data);
  if (k >= 1) return base;
  return Object.fromEntries(Object.entries(base).map(([id, n]) => [id, n * k]));
}

export function canAfford(res, cost) {
  for (const [id, amount] of Object.entries(cost)) if ((res[id] ?? 0) < amount) return false;
  return true;
}

// Largest number of levels (up to `limit`) the player can afford right now.
export function maxAffordable(res, def, level, eco = DATA.economy, limit = 1e6) {
  const g = eco.costGrowth;
  let best = limit;
  for (const [id, base] of Object.entries(def.cost)) {
    const have = res[id] ?? 0;
    const unit = base * g ** level * (eco.costScale ?? 1);
    const k = Math.floor(Math.log(1 + (have * (g - 1)) / unit) / Math.log(g) + 1e-9);
    best = Math.min(best, k);
  }
  best = Math.max(0, Math.floor(best));
  // Floating point guard: settle on the exact boundary.
  while (best > 0 && !canAfford(res, costOf(def, level, best, eco))) best -= 1;
  while (best < limit && canAfford(res, costOf(def, level, best + 1, eco))) best += 1;
  return best;
}

// A capped resource whose cost is larger than the storage limit can never be paid.
export function costExceedsStorage(state, cost, data = DATA) {
  for (const [id, amount] of Object.entries(cost)) {
    if (amount > storageCap(state, id, data) + 1e-9) return id;
  }
  return null;
}

export function productionOf(def, level, mult = 1, eco = DATA.economy) {
  return level * def.rate * milestoneMultiplier(level, eco) * mult;
}

// Output per second of one workplace, with the global multiplier and its workers.
export function outputOf(state, def, data = DATA, levelOverride = null) {
  const level = levelOverride ?? levelOf(state, def.id);
  return productionOf(def, level, globalMultiplier(state, data) * workerMultiplier(state, def.id, data) * resourceBoost(state, def.produces, data), data.economy);
}

// Food one resident eats each second, after the Thrifty Larders discount.
export const foodPerResident = (state, data = DATA) => data.economy.residents.foodPerSecEach * (1 - bonusOf(state, 'foodSaver', data));

// ---- Flows ----

// What each workplace makes before any stock limits: producer output per resource,
// and converter capacity (how much it could make if its input never ran short).
export function productionParts(state, data = DATA) {
  const gross = Object.fromEntries(data.resources.map((r) => [r.id, 0]));
  const stipend = data.economy.stipendGoldPerSec * globalMultiplier(state, data) * resourceBoost(state, 'gold', data);
  gross.gold += stipend;
  const converters = [];
  for (const def of liveBuildings(data)) {
    const level = levelOf(state, def.id);
    if (level <= 0) continue;
    if (def.kind === 'producer') gross[def.produces] += outputOf(state, def, data);
    else if (def.kind === 'converter') converters.push({ def, level, capacity: outputOf(state, def, data) });
  }
  return { gross, stipend, converters };
}

// Per-second rates for display and for time-to-afford estimates.
// A converter runs at full capacity while it has stock, otherwise at the pace of its input.
export function flows(state, data = DATA) {
  const eco = data.economy;
  const { gross, stipend, converters } = productionParts(state, data);
  const spend = Object.fromEntries(data.resources.map((r) => [r.id, 0]));
  const sources = Object.fromEntries(data.resources.map((r) => [r.id, []]));
  const uses = Object.fromEntries(data.resources.map((r) => [r.id, []]));

  if (stipend > 0) sources.gold.push({ label: "Warden's stipend", amount: stipend });
  for (const def of liveBuildings(data)) {
    const level = levelOf(state, def.id);
    if (level <= 0 || def.kind !== 'producer') continue;
    sources[def.produces].push({
      label: `${def.name} level ${level}`,
      amount: outputOf(state, def, data),
      doubled: milestoneMultiplier(level, eco) > 1,
      workers: workersAt(state, def.id),
    });
  }
  for (const { def, level, capacity } of converters) {
    const fed = state.res[def.from] > 1e-9 ? capacity : Math.min(capacity, gross[def.from] / def.ratio);
    gross[def.produces] += fed;
    spend[def.from] += fed * def.ratio;
    sources[def.produces].push({ label: `${def.name} level ${level} smelting`, amount: fed, workers: workersAt(state, def.id) });
    uses[def.from].push({ label: `${def.name} smelting`, amount: fed * def.ratio });
  }

  const eat = state.town.residents * foodPerResident(state, data);
  if (eat > 0) {
    spend.food += eat;
    uses.food.push({ label: `${state.town.residents} residents eating`, amount: eat });
  }

  const net = {};
  for (const r of data.resources) net[r.id] = gross[r.id] - spend[r.id];
  return { gross, spend, net, sources, uses, multiplier: globalMultiplier(state) };
}

export function incomeBreakdown(state, data = DATA) {
  const f = flows(state, data);
  const out = { multiplier: f.multiplier };
  for (const r of data.resources) {
    out[r.id] = { total: f.net[r.id], gross: f.gross[r.id], sources: f.sources[r.id], uses: f.uses[r.id] };
  }
  return out;
}

// Net income per second for every resource.
export function incomePerSec(state, data = DATA) {
  return flows(state, data).net;
}

// Seconds until `cost` can be paid at the current income. 0 if affordable now,
// Infinity if some missing resource has no net income at all.
export function secondsToAfford(res, cost, income) {
  let wait = 0;
  for (const [id, amount] of Object.entries(cost)) {
    const deficit = amount - (res[id] ?? 0);
    if (deficit <= 0) continue;
    const rate = income[id] ?? 0;
    if (rate <= 0) return Infinity;
    wait = Math.max(wait, deficit / rate);
  }
  return wait;
}

// ---- Residents and hunger ----

// Hungry means residents are living on an empty larder. Quests run slower then.
export function isHungry(state, data = DATA) {
  if (state.town.residents <= 0 || state.res.food > 1e-9) return false;
  return flows(state, data).net.food < 0;
}

// Multiplier for quest speed. Quests arrive in a later checkpoint; this is the rule they will read.
export function questSpeedMultiplier(state, data = DATA) {
  return (isHungry(state, data) ? data.economy.hungerQuestSpeed : 1) * (1 + bonusOf(state, 'questSpeed', data));
}

// Why the next resident has or has not arrived.
export function arrivalStatus(state, data = DATA) {
  const { arrivalSeconds, arrivalFood } = data.economy.residents;
  if (state.town.residents >= housingCapacity(state, data)) return { state: 'full' };
  if (state.res.food < arrivalFood) return { state: 'needsFood', need: arrivalFood };
  return { state: 'arriving', secondsLeft: Math.max(0, arrivalSeconds - state.town.arrival) };
}
