// The hands-on layer: the Rally meter, building perks, edicts and timed buffs.
// Everything here is a lookup on state plus data. Nothing is saved except the small
// records described in newEngage() and `town.perks` / `town.edict`.
import { DATA } from './data.js';

export const newEngage = (data = DATA) => ({
  rally: { charge: 0, burst: 0, bursts: 0 },
  buffs: [],
  event: null,
  events: { next: data.engage.events.firstDelaySeconds, seq: 0, taken: 0 },
});

const product = (xs) => xs.reduce((a, x) => a * x, 1);

// ---- Rally ----

export const rallyBurst = (state) => state.rally?.burst ?? 0;
export const rallyCharge = (state) => state.rally?.charge ?? 0;

// One tap on the tribute button. While a burst runs the tap pays tribute but charges nothing.
export function rallyTap(state, data = DATA) {
  const cfg = data.engage.rally;
  const r = state.rally ?? { charge: 0, burst: 0, bursts: 0 };
  if (r.burst > 0) return { ...r, burst: r.burst };
  const charge = r.charge + cfg.tapCharge;
  if (charge >= cfg.full) return { charge: 0, burst: cfg.burstSeconds, bursts: (r.bursts ?? 0) + 1, started: true };
  return { ...r, charge };
}

// ---- Perks ----

// Perk rows for a building: one per tier, with the level it opens at.
export function perkRows(id, data = DATA) {
  const rows = data.engage.perks.byBuilding[id];
  if (!rows) return [];
  return rows.map((row, i) => ({ at: data.engage.perks.tiers[i], a: row.a, b: row.b }));
}

export const perkChoice = (state, id, at) => state.town.perks?.[id]?.[at] ?? null;

// Sum of the effects of every perk chosen for a building whose level has been reached.
export function perkEffects(state, id, data = DATA) {
  const out = { output: 0, discount: 0, workerBonus: 0, slots: 0 };
  const chosen = state.town.perks?.[id];
  if (!chosen) return out;
  const level = state.town.buildings[id] ?? 0;
  for (const row of perkRows(id, data)) {
    const pick = chosen[row.at];
    if (!pick || level < row.at) continue;
    const p = row[pick];
    for (const k of Object.keys(out)) out[k] += p?.[k] ?? 0;
  }
  return out;
}

export function describePerk(p) {
  const bits = [];
  if (p.output) bits.push(`+${Math.round(p.output * 100)}% output`);
  if (p.discount) bits.push(`${Math.round(p.discount * 100)}% cheaper levels`);
  if (p.workerBonus) bits.push(`workers add +${Math.round(p.workerBonus * 100)}% more each`);
  if (p.slots) bits.push(`+${p.slots} worker slots`);
  return bits.join(', ');
}

// ---- Edicts ----

export const edictOf = (state, data = DATA) => data.edictById[state.town.edict] ?? null;

// ---- Timed buffs ----

export const buffTotal = (state, key) => (state.buffs ?? []).reduce((a, b) => a + (b[key] ?? 0), 0);

// ---- What the layer does to the economy ----

// Multiplier on what a building makes, from the Rally burst, buffs, the building's perks and the edict.
export function outputBoost(state, def, data = DATA) {
  const edict = edictOf(state, data);
  return product([
    1 + (rallyBurst(state) > 0 ? data.engage.rally.boost : 0),
    1 + buffTotal(state, 'output'),
    1 + perkEffects(state, def.id, data).output,
    edict?.res?.[def.produces] ?? 1,
  ]);
}

// The Warden's stipend follows the same rules as gold from a workplace, without perks.
export function stipendBoost(state, data = DATA) {
  const edict = edictOf(state, data);
  return product([1 + (rallyBurst(state) > 0 ? data.engage.rally.boost : 0), 1 + buffTotal(state, 'output'), edict?.res?.gold ?? 1]);
}

// Price multiplier for one building's levels: its perk discount and any edict.
export function costMultiplier(state, id, data = DATA) {
  const edict = edictOf(state, data);
  return (1 - Math.min(0.9, perkEffects(state, id, data).discount)) * (edict?.costMult ?? 1);
}

export const questSpeedBoost = (state, data = DATA) => buffTotal(state, 'questSpeed') + (edictOf(state, data)?.questSpeed ?? 0);

// Count the Rally meter and the buffs down.
export function stepEngage(state, dt, data = DATA) {
  const r = state.rally;
  let next = state;
  if (r && (r.charge > 0 || r.burst > 0)) {
    const burst = Math.max(0, r.burst - dt);
    const charge = burst > 0 ? 0 : Math.max(0, r.charge - data.engage.rally.decayPerSec * dt);
    next = { ...next, rally: { ...r, burst, charge } };
  }
  const cmd = state.quests?.cmd;
  if (cmd && Object.keys(cmd).length) {
    const rest = {};
    for (const [id, left] of Object.entries(cmd)) if (left - dt > 0) rest[id] = left - dt;
    next = { ...next, quests: { ...next.quests, cmd: rest } };
  }
  if (state.buffs?.length) {
    const buffs = state.buffs.map((b) => ({ ...b, left: b.left - dt })).filter((b) => b.left > 0);
    next = { ...next, buffs };
  }
  return next;
}
