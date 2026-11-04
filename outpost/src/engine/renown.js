// Renown: the numbers behind Prestige 1. Pure helpers with no dependency on the rest of
// the engine except data, so derive.js, heroes.js and quests.js can all read shop bonuses.
// Renown has two figures: `renown` is the balance to spend, `renownTotal` is everything ever
// earned. Only the total sets the production multiplier, so spending never weakens the town.
import { DATA } from './data.js';

export const renownTotal = (state) => state.prestige?.renownTotal ?? state.prestige?.renown ?? 0;

export function renownMultiplier(total, data = DATA) {
  const m = data.renown?.multiplier;
  return m ? 1 + m.per * Math.max(0, total) ** m.exp : 1;
}

export function legacyMultiplier(total, data = DATA) {
  const m = data.legacy?.multiplier;
  return m ? 1 + m.per * Math.max(0, total) ** m.exp : 1;
}
export const legacyTotal = (state) => state.prestige?.legacyTotal ?? 0;

export function sandsMultiplier(total, data = DATA) {
  const m = data.sands?.multiplier;
  return m ? 1 + m.per * Math.max(0, total) ** m.exp : 1;
}
export const sandsTotal = (state) => state.prestige?.sandsTotal ?? 0;

export const upgradeLevel = (state, id) => Math.floor(state.prestige?.upgrades?.[id] ?? 0);

// The cumulative effect of one upgrade at a given level (0 when unbought).
export const valueAt = (up, level) => (level > 0 ? up.values[Math.min(level, up.values.length) - 1] : 0);

// Sum of every shop upgrade that carries this effect key, at the player's levels.
// Effects every hero of one class gets from Legacy class talents, as { effect: value }.
export function classEffects(state, cls, data = DATA) {
  const out = {};
  const levels = state.prestige?.legacyUpgrades;
  if (!levels) return out;
  for (const up of data.classTalents?.[cls] ?? []) {
    const v = valueAt(up, Math.floor(levels[up.id] ?? 0));
    if (v) out[up.effect] = (out[up.effect] ?? 0) + v;
  }
  return out;
}

// Renown, Legacy auras and Sands upgrades all feed this one reader, so every hook gets all three.
export function bonusOf(state, key, data = DATA) {
  let sum = 0;
  const p = state.prestige;
  for (const { up, field } of data.bonusSources?.[key] ?? []) sum += valueAt(up, Math.floor(p?.[field]?.[up.id] ?? 0));
  return sum;
}

// Renown price of the next level, or null at the top.
export function upgradeCost(state, up) {
  const level = upgradeLevel(state, up.id);
  if (level >= up.values.length) return null;
  return Math.ceil(up.cost.base * up.cost.growth ** level);
}

// Output boost for what a workplace makes: gold has its own upgrade, raw materials another.
export function resourceBoost(state, resourceId) {
  if (resourceId === 'gold') return 1 + bonusOf(state, 'goldBoost');
  if (resourceId === 'lumber' || resourceId === 'stone' || resourceId === 'food') return 1 + bonusOf(state, 'rawBoost');
  return 1;
}

export const archivesLevel = (state) => state.town?.buildings?.archives ?? 0;

// Renown a Rebuild would pay out right now.
export function renownGain(state, data = DATA) {
  const g = data.renown.gain;
  const base = Math.floor((Math.max(0, state.stats.lifetimeGold) / g.divisor) ** g.exp);
  return Math.floor(base * (1 + g.archivesPerLevel * archivesLevel(state)) * (1 + bonusOf(state, 'renownBoost', data)));
}

// Lifetime gold in the current run needed for a gain of `n`, ignoring the Archives.
export const goldForGain = (n, data = DATA) => data.renown.gain.divisor * n ** (1 / data.renown.gain.exp);

export const runSeconds = (state) => Math.max(0, state.stats.playSeconds - (state.stats.runFrom ?? 0));
export const totalGold = (state) => (state.stats.pastGold ?? 0) + state.stats.lifetimeGold;

// What a Rebuild would do, for the confirm screen.
export function rebuildPreview(state, data = DATA) {
  const rb = data.renown.rebuild;
  const gain = renownGain(state, data);
  const total = renownTotal(state);
  return {
    gain,
    can: gain >= rb.minGain,
    runGold: state.stats.lifetimeGold,
    runSeconds: runSeconds(state),
    total,
    totalAfter: total + gain,
    multiplier: renownMultiplier(total, data),
    multiplierAfter: renownMultiplier(total + gain, data),
    // Players who wait for the gain to match what they already hold finish later runs faster overall.
    advised: gain >= Math.max(rb.adviceFloor, Math.ceil(total * rb.adviceFactor)),
    adviceAt: Math.max(rb.adviceFloor, Math.ceil(total * rb.adviceFactor)),
  };
}
