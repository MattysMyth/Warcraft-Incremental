// Legacy: Prestige 2. A hero who has gone as far as the outpost can take them retires into the
// Hall of Heroes. Their deeds turn into Legacy, a currency that buys permanent class talents and
// town auras, and a child of theirs may join the Tavern later, born a little stronger.
//
// Legacy has two figures, like Renown: `legacy` is the balance to spend and `legacyTotal` is
// everything ever earned, which alone sets the production multiplier. `legacyEra` counts what was
// earned since the last Epoch, which sets the Sands of Time paid out by the next one.
import { DATA } from './data.js';
import { levelOf } from './derive.js';
import { bonusOf, legacyTotal, legacyMultiplier } from './renown.js';
import { itemValue } from './heroes.js';
import { addLog } from './actions.js';

export { legacyTotal, legacyMultiplier };

export const legacyLevel = (state, id) => Math.floor(state.prestige?.legacyUpgrades?.[id] ?? 0);

export function legacyCost(state, up) {
  const level = legacyLevel(state, up.id);
  if (level >= up.values.length) return null;
  return Math.ceil(up.cost.base * up.cost.growth ** level);
}

export function buyLegacy(state, id, data = DATA) {
  const up = data.legacyById[id];
  if (!up) return { ok: false, error: 'No such upgrade.' };
  const cost = legacyCost(state, up);
  if (cost === null) return { ok: false, error: `${up.name} is already at its highest level.` };
  if ((state.prestige.legacy ?? 0) < cost) return { ok: false, error: `${up.name} costs ${cost} Legacy.` };
  const level = legacyLevel(state, id) + 1;
  const next = {
    ...state,
    prestige: { ...state.prestige, legacy: state.prestige.legacy - cost, legacyUpgrades: { ...state.prestige.legacyUpgrades, [id]: level } },
  };
  return { ok: true, state: addLog(next, `${up.name} reached level ${level}.`, data), cost, level };
}

// ---- Retiring ----

// The best tier among a hero's equipped gear (1 when they carry nothing).
export const heroTier = (hero) => Math.max(1, ...Object.values(hero.gear ?? {}).map((i) => i?.tier ?? 0));

export function legacyGain(state, hero, data = DATA) {
  const g = data.legacy.gain;
  if (hero.level < g.minLevel) return 0;
  const base = ((hero.level - g.fromLevel) ** g.exp * heroTier(hero)) / g.divisor;
  return Math.floor(base * (1 + bonusOf(state, 'legacyBoost', data)));
}

// Retirement opens with the Archives, and stays open once the outpost has any Legacy history.
export const retireOpen = (state) =>
  levelOf(state, 'archives') > 0 || legacyTotal(state) > 0 || (state.hall ?? []).length > 0;

export function heirBonus(total, data = DATA) {
  const d = data.legacy.descendants;
  return Math.min(d.cap, d.base + d.perLegacy * total);
}

const HALL_KEEP = 60;

// Turns a hero into a Hall entry and pays out Legacy. Does not check eligibility.
function applyRetire(state, hero, data, tell = true) {
  const gain = legacyGain(state, hero, data);
  const p = state.prestige;
  const total = (p.legacyTotal ?? 0) + gain;
  const n = (state.counters?.hall ?? 0) + 1;
  const entry = {
    id: `v${n}`, n, name: hero.name, race: hero.race, class: hero.class, trait: hero.trait, level: hero.level,
    tier: heroTier(hero), legacy: gain, era: state.era ?? 1, bonus: heirBonus(total, data),
    startLevel: Math.max(1, Math.floor(hero.level * data.legacy.descendants.startShare)), claimed: false,
  };
  // Gear goes back to the bag; whatever does not fit is sold.
  let items = state.items;
  let gold = 0;
  for (const item of Object.values(hero.gear ?? {})) {
    if (!item) continue;
    if (items.length < data.gear.inventoryCap) items = [...items, item];
    else gold += itemValue(state, item, data);
  }
  const orders = state.quests.orders
    .map((o) => ({ ...o, party: o.party.filter((id) => id !== hero.id) }))
    .filter((o) => o.party.length);
  let next = {
    ...state,
    heroes: state.heroes.filter((x) => x.id !== hero.id),
    items,
    res: gold ? { ...state.res, gold: state.res.gold + gold } : state.res,
    quests: { ...state.quests, orders },
    counters: { ...state.counters, hall: n },
    hall: [...(state.hall ?? []), entry].slice(-HALL_KEEP),
    prestige: { ...p, legacy: (p.legacy ?? 0) + gain, legacyTotal: total, legacyEra: (p.legacyEra ?? 0) + gain },
  };
  if (tell) next = addLog(next, `${hero.name} retired from the road at level ${hero.level}. The Hall of Heroes remembers: ${gain} Legacy.`, data);
  return { state: next, gain, entry };
}

export function retirePreview(state, hero, data = DATA) {
  const busy = state.quests.active.some((r) => r.party.includes(hero.id));
  const gain = legacyGain(state, hero, data);
  let why = '';
  if (!retireOpen(state)) why = 'Retirement opens with the Archives (Town Hall 14).';
  else if (hero.level < data.legacy.gain.minLevel) why = `Heroes retire from level ${data.legacy.gain.minLevel}.`;
  else if (busy) why = 'They are on the road. Wait for the party to come home.';
  const total = legacyTotal(state) + gain;
  return { can: !why, why, gain, tier: heroTier(hero), heirLevel: Math.max(1, Math.floor(hero.level * data.legacy.descendants.startShare)), heirBonus: heirBonus(total, data), orders: state.quests.orders.some((o) => o.party.includes(hero.id)) };
}

export function retireHero(state, heroId, data = DATA) {
  const hero = state.heroes.find((x) => x.id === heroId);
  if (!hero) return { ok: false, error: 'That hero is not in the roster.' };
  const pre = retirePreview(state, hero, data);
  if (!pre.can) return { ok: false, error: pre.why };
  const r = applyRetire(state, hero, data);
  return { ok: true, state: r.state, gain: r.gain, entry: r.entry };
}

// Used by the Epoch: retire every eligible hero, quietly, in roster order.
export function retireAll(state, data = DATA) {
  let s = state;
  let gain = 0;
  const entries = [];
  for (const hero of state.heroes) {
    if (hero.level < data.legacy.gain.minLevel) continue;
    const r = applyRetire(s, hero, data, false);
    s = r.state;
    gain += r.gain;
    entries.push(r.entry);
  }
  return { state: s, gain, entries };
}
