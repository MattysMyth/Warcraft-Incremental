// Town raids: now and then something comes for the outpost. The town's Defence rating is tested
// against a threat that grows with the highest zone cleared. A failed raid costs a small share of
// the stockpiled raw resources. Gold and buildings are never touched.
import { DATA } from './data.js';
import { levelOf } from './derive.js';
import { heroRating, isBusy } from './quests.js';
import { zoneState } from './zones.js';
import { seedFrom, makeRng } from './rng.js';

const RD = (data) => data.raids;

export const newRaids = (data = DATA) => ({ next: RD(data).interval[1], seq: 0, won: 0, lost: 0, log: [] });

// The tier of the highest zone whose headline has been cleared this run (0 if none).
export function clearedTier(state, data = DATA) {
  let tier = 0;
  for (const z of data.zoneList) if (zoneState(state, z.id).cleared.includes(z.headline)) tier = Math.max(tier, z.tier);
  return tier;
}

export function threatOf(state, data = DATA) {
  const tier = clearedTier(state, data);
  if (tier < RD(data).startTier) return 0;
  return RD(data).threat.base * RD(data).threat.growth ** (tier - 1);
}

export const wallDefence = (state, data = DATA) => RD(data).wall.perLevel * levelOf(state, 'wall_watchtower') ** RD(data).wall.exp;

// Heroes at home stand guard.
export function guardDefence(state, data = DATA) {
  let sum = 0;
  for (const h of state.heroes) if (h.injury <= 0 && !isBusy(state, h.id)) sum += heroRating(state, h, data);
  return sum * RD(data).guard.share;
}

export const defenceOf = (state, data = DATA) => wallDefence(state, data) + guardDefence(state, data);

// What a raid right now would do, for display.
export function raidPreview(state, data = DATA) {
  const threat = threatOf(state, data);
  const defence = defenceOf(state, data);
  return { active: threat > 0, threat, defence, wall: wallDefence(state, data), guard: guardDefence(state, data), safe: threat > 0 && defence >= threat, next: state.raids?.next ?? 0 };
}

function resolve(state, data) {
  const r = state.raids;
  const rng = makeRng(seedFrom(state.seed, r.seq + 1, 909));
  const threat = threatOf(state, data) * (0.85 + 0.3 * rng());
  const defence = defenceOf(state, data);
  const won = defence >= threat;
  const res = { ...state.res };
  const lost = {};
  if (!won) {
    const share = RD(data).steal.share;
    for (const id of RD(data).steal.resources) {
      const take = Math.floor((res[id] ?? 0) * share);
      if (take > 0) { res[id] -= take; lost[id] = take; }
    }
  }
  const entry = { n: r.seq + 1, won, threat: Math.round(threat), defence: Math.round(defence), lost };
  const text = won
    ? `A raid on the outpost was beaten back (defence ${Math.round(defence)} against ${Math.round(threat)}).`
    : `A raid broke through (defence ${Math.round(defence)} against ${Math.round(threat)}) and carried off ${Object.keys(lost).length ? Object.entries(lost).map(([id, n]) => `${n} ${data.resourceById[id].name.toLowerCase()}`).join(', ') : 'what little there was'}.`;
  return {
    ...state,
    res,
    raids: { ...r, seq: r.seq + 1, won: r.won + (won ? 1 : 0), lost: r.lost + (won ? 0 : 1), log: [entry, ...r.log].slice(0, RD(data).history) },
    log: [{ t: state.savedAt, text }, ...state.log].slice(0, data.economy.logLimit),
  };
}

// Count the timer down. `budget` (set while catching up offline) caps how many raids may land.
export function stepRaids(state, dt, data = DATA) {
  const r = state.raids;
  if (!r) return state;
  let next = r.next - dt;
  if (next > 0) return { ...state, raids: { ...r, next } };
  const rng = makeRng(seedFrom(state.seed, r.seq + 1, 910));
  const [lo, hi] = RD(data).interval;
  next = lo + rng() * (hi - lo);
  const open = threatOf(state, data) > 0 && (r.budget === undefined || r.budget > 0);
  if (!open) return { ...state, raids: { ...r, next } };
  const after = resolve(state, data);
  return { ...after, raids: { ...after.raids, next, ...(r.budget !== undefined ? { budget: r.budget - 1 } : {}) } };
}
