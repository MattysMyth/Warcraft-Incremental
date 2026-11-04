import { DATA } from './data.js';
import { productionParts, housingCapacity, storageCap, foodPerResident } from './derive.js';
import { stepHeroes } from './heroes.js';
import { stepQuests } from './quests.js';
import { stepAlchemy } from './alchemy.js';
import { stepRaids } from './raids.js';
import { checkAchievements } from './achievements.js';

// Advance the world by `dt` seconds of game time. Pure: returns a new state.
// Order within a step: producers, smelting, eating, new arrivals, storage limits.
export function step(state, dt, data = DATA) {
  if (!(dt > 0)) return state;
  const eco = data.economy;
  const { gross, converters } = productionParts(state, data);
  const res = { ...state.res };

  for (const r of data.resources) res[r.id] = (res[r.id] ?? 0) + gross[r.id] * dt;

  // A converter can only use ore that exists, so it is limited by the stock on hand.
  for (const { def, capacity } of converters) {
    const made = Math.min(capacity * dt, res[def.from] / def.ratio);
    res[def.from] -= made * def.ratio;
    res[def.produces] += made;
  }

  // Residents eat; the larder never goes below zero.
  res.food = Math.max(0, res.food - state.town.residents * foodPerResident(state, data) * dt);

  // Newcomers settle while there is room and enough food to bring them in.
  let { residents, arrival } = state.town;
  const room = housingCapacity(state, data);
  const { arrivalSeconds, arrivalFood } = eco.residents;
  if (residents < room && res.food >= arrivalFood) {
    arrival += dt;
    while (arrival >= arrivalSeconds && residents < room && res.food >= arrivalFood) {
      residents += 1;
      res.food -= arrivalFood;
      arrival -= arrivalSeconds;
    }
    // Progress toward the next settler does not carry over once housing is full.
    arrival = residents >= room ? 0 : Math.min(arrival, arrivalSeconds);
  }

  // Overflow above the Warehouse limit is lost.
  for (const r of data.resources) {
    if (r.capped) res[r.id] = Math.min(res[r.id], storageCap(state, r.id, data));
  }

  const next = {
    ...state,
    res,
    town: residents === state.town.residents && arrival === state.town.arrival
      ? state.town
      : { ...state.town, residents, arrival },
    stats: {
      ...state.stats,
      lifetimeGold: state.stats.lifetimeGold + gross.gold * dt,
      playSeconds: state.stats.playSeconds + dt,
    },
  };
  const grown = { ...next, ...stepHeroes(next, dt, data) };
  if (grown.alchemy?.queue.length) grown.alchemy = stepAlchemy(grown, dt, data);
  return checkAchievements(stepRaids(stepQuests(grown, dt, data), dt, data), data);
}
