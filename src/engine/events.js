// Player decisions that need attention: building perks, edicts, timed events and hero commands.
// Each of these is a plain function from state to a new state, like every other action.
import { DATA, isWorkplace } from './data.js';
import { productionParts, housingCapacity, storageCap, levelOf, townHallCostFor } from './derive.js';
import { perkRows, perkChoice, edictOf } from './engage.js';
import { seedFrom, makeRng } from './rng.js';

const logLine = (state, text, data) => ({ ...state, log: [{ t: state.savedAt, text }, ...state.log].slice(0, data.economy.logLimit) });
const grossGold = (state, data) => productionParts(state, data).gross.gold;

// A price quoted in seconds of the town's present gold income, never below a floor.
export const feeFor = (state, seconds, min, data = DATA) => Math.ceil(Math.max(min, seconds * grossGold(state, data)));

export const respecFee = (state, data = DATA) => feeFor(state, data.engage.perks.respecSeconds, data.engage.perks.respecMin, data);
export const edictSwapFee = (state, data = DATA) => feeFor(state, data.engage.edicts.swapSeconds, data.engage.edicts.swapMin, data);

const pay = (state, fee) => ({ ...state, res: { ...state.res, gold: state.res.gold - fee } });

// ---- Perks ----

// Pick one of the two perks of a tier. The first pick is free; changing it costs a fee.
export function choosePerk(state, id, at, pick, data = DATA) {
  const def = data.buildingById[id];
  if (!def || !isWorkplace(def)) return { ok: false, error: 'Only producing buildings have perks.' };
  const row = perkRows(id, data).find((r) => r.at === at);
  if (!row) return { ok: false, error: 'No such perk tier.' };
  if (pick !== 'a' && pick !== 'b') return { ok: false, error: 'Choose one of the two perks.' };
  if (levelOf(state, id) < at) return { ok: false, error: `The ${def.name} needs level ${at} for this choice.` };
  const had = perkChoice(state, id, at);
  if (had === pick) return { ok: false, error: 'That perk is already chosen.' };
  const fee = had ? respecFee(state, data) : 0;
  if (fee > state.res.gold) return { ok: false, error: `Changing a perk costs ${fee} gold.` };
  const perks = { ...(state.town.perks ?? {}), [id]: { ...(state.town.perks?.[id] ?? {}), [at]: pick } };
  let next = { ...pay(state, fee), town: { ...state.town, perks } };
  next = logLine(next, `${def.name}: ${row[pick].name}${had ? ` (changed for ${fee} gold)` : ''}.`, data);
  return { ok: true, state: next, fee, perk: row[pick] };
}

// ---- Edicts ----

export function setEdict(state, id, data = DATA) {
  if (state.town.townHall < data.engage.edicts.townHall) return { ok: false, error: `Edicts need Town Hall level ${data.engage.edicts.townHall}.` };
  const cur = edictOf(state, data);
  if (id === null) {
    if (!cur) return { ok: false, error: 'No edict is in force.' };
    return { ok: true, state: logLine({ ...state, town: { ...state.town, edict: null } }, `${cur.name} was lifted.`, data), fee: 0 };
  }
  const ed = data.edictById[id];
  if (!ed) return { ok: false, error: 'No such edict.' };
  if (cur?.id === id) return { ok: false, error: `${ed.name} is already in force.` };
  const fee = cur ? edictSwapFee(state, data) : 0;
  if (fee > state.res.gold) return { ok: false, error: `Changing the edict costs ${fee} gold.` };
  return { ok: true, state: logLine({ ...pay(state, fee), town: { ...state.town, edict: id } }, `${ed.name} proclaimed${fee ? ` (${fee} gold)` : ''}.`, data), fee };
}

// ---- Timed events ----

// What a choice costs and gives right now, in whole units.
export function choiceTerms(state, choice, data = DATA) {
  const gross = productionParts(state, data).gross;
  const amount = (p) => Math.ceil(Math.max(p.min ?? 0, p.seconds * (gross[p.res] ?? 0)));
  return {
    cost: choice.cost ? { res: choice.cost.res, amount: amount(choice.cost) } : null,
    gain: choice.gain ? { res: choice.gain.res, amount: amount(choice.gain) } : null,
  };
}

export const eventOf = (state, data = DATA) => (state.event ? data.eventById[state.event.id] ?? null : null);

const nextInterval = (state, data) => {
  const [lo, hi] = data.engage.events.interval;
  return lo + makeRng(seedFrom(state.seed, (state.events?.seq ?? 0) + 1, 1313))() * (hi - lo);
};

function eligible(def, state, data) {
  if (def.needsRoom && state.town.residents >= housingCapacity(state, data)) return false;
  return true;
}

// Count the event timer down: a new decision arrives now and then, and each one lapses without penalty.
export function stepEvents(state, dt, data = DATA) {
  const ev = state.events;
  if (!ev) return state;
  const cfg = data.engage.events;
  if (state.event) {
    const left = state.event.left - dt;
    if (left > 0) return { ...state, event: { ...state.event, left } };
    return { ...state, event: null, events: { ...ev, next: nextInterval(state, data) } };
  }
  if (state.settings?.events === 'off') return state;
  const next = ev.next - dt;
  if (next > 0) return { ...state, events: { ...ev, next } };
  if (levelOf(state, 'market') < cfg.minMarket) return { ...state, events: { ...ev, next: 30 } };
  const pool = cfg.list.filter((d) => eligible(d, state, data));
  const rng = makeRng(seedFrom(state.seed, ev.seq + 1, 1212));
  const def = pool[Math.floor(rng() * pool.length)];
  if (!def) return { ...state, events: { ...ev, next: 30 } };
  return { ...state, event: { id: def.id, left: cfg.window, total: cfg.window }, events: { ...ev, seq: ev.seq + 1, next: 0 } };
}

export function answerEvent(state, index, data = DATA) {
  const def = eventOf(state, data);
  if (!def) return { ok: false, error: 'That chance has passed.' };
  const choice = def.choices[index];
  if (!choice) return { ok: false, error: 'No such choice.' };
  const terms = choiceTerms(state, choice, data);
  if (terms.cost && (state.res[terms.cost.res] ?? 0) < terms.cost.amount) return { ok: false, error: `That needs ${terms.cost.amount} ${data.resourceById[terms.cost.res].name.toLowerCase()}.` };
  const res = { ...state.res };
  if (terms.cost) res[terms.cost.res] -= terms.cost.amount;
  if (terms.gain) res[terms.gain.res] = Math.max(res[terms.gain.res] ?? 0, Math.min(storageCap(state, terms.gain.res, data), (res[terms.gain.res] ?? 0) + terms.gain.amount));
  let next = { ...state, res, event: null, events: { ...state.events, taken: (state.events.taken ?? 0) + (terms.cost || choice.buff || choice.residents ? 1 : 0), next: nextInterval(state, data) } };
  const bits = [];
  if (terms.cost) bits.push(`paid ${terms.cost.amount} ${data.resourceById[terms.cost.res].name.toLowerCase()}`);
  if (terms.gain) bits.push(`took ${terms.gain.amount} ${data.resourceById[terms.gain.res].name.toLowerCase()}`);
  if (choice.buff) {
    const b = choice.buff;
    next = { ...next, buffs: [...(next.buffs ?? []).filter((x) => x.id !== def.id), { id: def.id, name: b.name, left: b.seconds, total: b.seconds, output: b.output ?? 0, questSpeed: b.questSpeed ?? 0 }] };
    bits.push(`${b.name} for ${Math.round(b.seconds / 60)} min`);
  }
  if (choice.residents) {
    const room = Math.max(0, housingCapacity(next, data) - next.town.residents);
    const n = Math.min(choice.residents, room);
    next = { ...next, town: { ...next.town, residents: next.town.residents + n } };
    bits.push(`${n} ${n === 1 ? 'resident' : 'residents'} settled`);
  }
  return { ok: true, state: logLine(next, `${def.name}: ${choice.label.toLowerCase()}${bits.length ? ` (${bits.join(', ')})` : ''}.`, data) };
}

// ---- Hero commands ----

export const commandOf = (hero, data = DATA) => data.engage.commands.byClass[hero.class] ?? null;
export const commandWait = (state, heroId) => state.quests.cmd?.[heroId] ?? 0;

// Order a hero on the road to use their class command. It works on this trip only, then rests.
export function issueCommand(state, runId, heroId, data = DATA) {
  const run = state.quests.active.find((r) => r.id === runId);
  if (!run) return { ok: false, error: 'That party is not on the road.' };
  if (!run.party.includes(heroId)) return { ok: false, error: 'That hero is not in this party.' };
  const hero = state.heroes.find((h) => h.id === heroId);
  const cmd = hero && commandOf(hero, data);
  if (!cmd) return { ok: false, error: 'That hero has no command.' };
  const wait = commandWait(state, heroId);
  if (wait > 0) return { ok: false, error: `${hero.name} needs ${Math.ceil(wait)} more seconds to rest.` };
  const bonus = { gold: (run.bonus?.gold ?? 0) + (cmd.gold ?? 0), xp: (run.bonus?.xp ?? 0) + (cmd.xp ?? 0) };
  const remaining = cmd.time ? Math.max(1, run.remaining - run.total * cmd.time) : run.remaining;
  const active = state.quests.active.map((r) => (r.id === runId ? { ...r, remaining, bonus } : r));
  const next = { ...state, quests: { ...state.quests, active, cmd: { ...(state.quests.cmd ?? {}), [heroId]: data.engage.commands.cooldownSeconds } } };
  return { ok: true, state: logLine(next, `${hero.name} used ${cmd.name} on "${run.offer.title}".`, data), command: cmd };
}
