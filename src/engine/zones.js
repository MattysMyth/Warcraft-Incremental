// Zones: which are open, reputation tiers and perks, story chains and sworn recruits.
// Everything here is derived from state.zones plus data; nothing is stored beyond
// { cleared, rep, trophies, story } per zone and a `sworn` id on hired heroes.
import { DATA } from './data.js';
import { bonusOf } from './renown.js';

const ZD = (data) => data.zonesData;

export const zoneState = (state, id) => state.zones?.[id] ?? { cleared: [], rep: 0, trophies: 0, story: 0 };

// A zone is open when it has no gate or its gate dungeon has been cleared.
export function zoneOpen(state, id, data = DATA) {
  const z = data.zoneById[id];
  if (!z) return false;
  if ((z.era ?? 1) > (state.era ?? 1)) return false;
  if (!z.gate) return true;
  if (z.gate.townHall && (state.town?.townHall ?? 1) < z.gate.townHall) return false;
  return zoneState(state, z.gate.zone).cleared.includes(z.gate.dungeon);
}

export const openZones = (state, data = DATA) => data.zoneList.filter((z) => zoneOpen(state, z.id, data));

// ---- Reputation ----

export const repTiers = (data = DATA) => ZD(data).reputation.tiers;

export function tierIndex(rep, data = DATA) {
  const tiers = repTiers(data);
  let at = 0;
  tiers.forEach((t, i) => { if (rep >= t.at) at = i; });
  return at;
}

export function repInfo(state, id, data = DATA) {
  const tiers = repTiers(data);
  const rep = zoneState(state, id).rep;
  const index = tierIndex(rep, data);
  const next = tiers[index + 1] ?? null;
  return {
    rep, index, tier: tiers[index], next, top: !next,
    title: data.zoneById[id].titles[index],
    fraction: next ? (rep - tiers[index].at) / (next.at - tiers[index].at) : 1,
  };
}

export const repMult = (state, id, data = DATA) => repTiers(data)[tierIndex(zoneState(state, id).rep, data)].reward;
export const repLuck = (state, id, data = DATA) => repTiers(data)[tierIndex(zoneState(state, id).rep, data)].luck;

// Permanent bonuses from zones at the top tier. They live in zone reputation, which a Rebuild keeps.
export function perks(state, data = DATA) {
  const out = { gold: 0, res: 0, xp: 0 };
  const top = repTiers(data).length - 1;
  for (const z of data.zoneList) if (tierIndex(zoneState(state, z.id).rep, data) >= top) out[z.perk.key] += z.perk.value;
  return out;
}

// ---- Story ----

export const storySteps = (id, data = DATA) =>
  data.quests.templates.filter((t) => t.story?.zone === id).sort((a, b) => a.story.step - b.story.step);

export const storyDone = (state, id) => zoneState(state, id).story ?? 0;

// The next lore quest of an open zone, or null when the chain is finished.
export function nextStory(state, id, data = DATA) {
  if (!zoneOpen(state, id, data)) return null;
  return storySteps(id, data).find((t) => t.story.step === storyDone(state, id) + 1) ?? null;
}

// ---- Sworn recruits: named adventurers unlocked by story steps or reputation ----

export function recruitStatus(state, r, data = DATA) {
  const hired = state.heroes.some((h) => h.sworn === r.id);
  const need = r.requires ?? {};
  let met = true;
  let why = '';
  if (need.story && storyDone(state, r.zone) < need.story) {
    met = false;
    why = `Finish step ${need.story} of the ${data.zoneById[r.zone].name} story.`;
  } else if (need.tier && tierIndex(zoneState(state, r.zone).rep, data) < need.tier) {
    met = false;
    why = `Reach ${repTiers(data)[need.tier].name} standing in ${data.zoneById[r.zone].name}.`;
  }
  return { hired, met, why };
}

export function swornCost(state, r, data = DATA) {
  const hd = data.heroes.recruit;
  return Math.round(hd.cost * hd.growth ** state.heroes.length * (1 + hd.perStartLevel * (r.level - 1)) * (1 - ZD(data).recruit.discount) * (1 - bonusOf(state, 'recruitDiscount', data)));
}
