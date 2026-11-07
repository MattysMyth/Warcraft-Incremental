// Validated player commands. Each returns { ok: true, state, ... } or
// { ok: false, error }. The UI never changes state any other way.
import { DATA, isLive, isWorkplace, liveBuildings } from './data.js';
import { bonusOf } from './renown.js';
import { rallyTap } from './engage.js';
export { choosePerk, setEdict, answerEvent, issueCommand } from './events.js';
import {
  costOf, canAfford, maxAffordable, milestoneMultiplier, globalMultiplier, ecoFor, townHallCostFor,
  isUnlocked, levelCap, levelOf, freeResidents, workersAt, workerCap, productionParts,
} from './derive.js';
import { NUMBER_FORMATS } from './numbers.js';
import {
  rosterCap, recruitCost, refreshCost, rollPool, rollItem, autoEquip, heroById, pendingTalents,
  itemValue,
} from './heroes.js';
import { seedFrom, makeRng } from './rng.js';
import { startRun, recallRun, discardOffer as dropOffer, setFocus as focusZone } from './quests.js';
import { createOrder as makeOrder, removeOrder as dropOrder, pauseOrder as holdOrder, setOrderOdds as changeOdds, setOrderPotion as changePotion } from './orders.js';
import { recruitStatus, swornCost } from './zones.js';
import { heirsOf } from './heirs.js';
import { potionStock, queuedOf, stockCap } from './alchemy.js';

export function addLog(state, text, data = DATA) {
  const log = [{ t: state.savedAt, text }, ...state.log].slice(0, data.economy.logLimit);
  return { ...state, log };
}

function spend(res, cost) {
  const out = { ...res };
  for (const [id, amount] of Object.entries(cost)) out[id] -= amount;
  return out;
}

export function buyBuilding(state, id, count, data = DATA) {
  const def = data.buildingById[id];
  if (!def || !isLive(def)) return { ok: false, error: `"${id}" cannot be built yet.` };
  if (!isUnlocked(def, state)) {
    return { ok: false, error: `The ${def.name} unlocks at Town Hall level ${def.unlockTownHall}.` };
  }
  const eco = ecoFor(state, data, id);
  const level = levelOf(state, id);
  const cap = levelCap(state, data);
  const room = cap - level;
  if (room <= 0) {
    return {
      ok: false,
      error: `Town Hall level ${state.town.townHall} allows buildings up to level ${cap}. Upgrade the Town Hall to build further.`,
    };
  }

  let n;
  if (count === 'max') n = maxAffordable(state.res, def, level, eco, room);
  else if (Number.isInteger(count) && count >= 1) n = Math.min(count, room);
  else return { ok: false, error: 'Choose a whole number of levels to buy.' };
  if (n < 1) return { ok: false, error: `Not enough resources for a ${def.name}.` };

  const cost = costOf(def, level, n, eco);
  if (!canAfford(state.res, cost)) {
    return { ok: false, error: `Not enough resources to buy ${n} ${def.name} level${n > 1 ? 's' : ''}.` };
  }

  const newLevel = level + n;
  let next = {
    ...state,
    res: spend(state.res, cost),
    town: { ...state.town, buildings: { ...state.town.buildings, [id]: newLevel } },
  };
  next = addLog(next, level === 0 ? `Built the ${def.name}.` : `${def.name} raised to level ${newLevel}.`, data);
  if (milestoneMultiplier(newLevel, eco) > milestoneMultiplier(level, eco)) {
    const reached = eco.milestones.filter((m) => newLevel >= m).at(-1);
    if (isWorkplace(def)) next = addLog(next, `${def.name} reached level ${reached}: output doubled.`, data);
  }
  return { ok: true, state: next, bought: n, cost, building: def, newLevel };
}

export function buyTownHall(state, data = DATA) {
  const target = state.town.townHall + 1;
  if (target > data.townHall.maxLevel) return { ok: false, error: 'The Town Hall is at its highest level.' };
  const cost = townHallCostFor(state, target, data);
  if (!cost) return { ok: false, error: `No cost is defined for Town Hall level ${target}.` };
  if (!canAfford(state.res, cost)) return { ok: false, error: `Not enough resources for Town Hall level ${target}.` };

  let next = {
    ...state,
    res: spend(state.res, cost),
    town: { ...state.town, townHall: target },
  };
  const opened = liveBuildings(data).filter((b) => b.unlockTownHall === target).map((b) => b.name);
  next = addLog(
    next,
    `Town Hall raised to level ${target}. ${opened.length ? `Unlocks: ${opened.join(', ')}. ` : ''}Buildings can reach level ${levelCap(next, data)}.`,
    data,
  );
  return { ok: true, state: next, cost, level: target, opened };
}

// delta is +1 (assign a free resident) or -1 (return a worker to the free pool).
export function assignWorker(state, id, delta, data = DATA) {
  const def = data.buildingById[id];
  if (!def || !isWorkplace(def)) return { ok: false, error: 'Only producing buildings take workers.' };
  if (levelOf(state, id) <= 0) return { ok: false, error: `Build the ${def.name} before assigning workers.` };
  if (delta !== 1 && delta !== -1) return { ok: false, error: 'Move workers one at a time.' };
  const now = workersAt(state, id);
  const max = workerCap(state, id, data);
  if (delta > 0) {
    if (now >= max) return { ok: false, error: `A building takes at most ${max} workers at this level.` };
    if (freeResidents(state) <= 0) return { ok: false, error: 'No free residents. Build Houses and keep the larder stocked.' };
  } else if (now <= 0) {
    return { ok: false, error: `No workers at the ${def.name}.` };
  }
  const workers = { ...state.town.workers, [id]: now + delta };
  if (workers[id] === 0) delete workers[id];
  return { ok: true, state: { ...state, town: { ...state.town, workers } } };
}

// Tribute is a flat sum plus a slice of the town's gold income, so it keeps pace with the town.
export function tributeGain(state, data = DATA) {
  return data.economy.tributeGold * globalMultiplier(state, data) + data.engage.rally.tributeSeconds * productionParts(state, data).gross.gold;
}

export function collectTribute(state, data = DATA) {
  const gain = tributeGain(state, data);
  const { started, ...rally } = rallyTap(state, data);
  return {
    ok: true,
    gain,
    rallied: !!started,
    state: {
      ...state,
      rally,
      res: { ...state.res, gold: state.res.gold + gain },
      stats: {
        ...state.stats,
        lifetimeGold: state.stats.lifetimeGold + gain,
        tributes: state.stats.tributes + 1,
      },
    },
  };
}

const SETTING_RULES = {
  numberFormat: (v) => NUMBER_FORMATS.includes(v),
  reducedMotion: (v) => ['auto', 'on', 'off'].includes(v),
  buyAmount: (v) => v === 1 || v === 10 || v === 'max',
  theme: (v) => ['auto', 'dark', 'light'].includes(v),
  textSize: (v) => ['normal', 'large'].includes(v),
  effects: (v) => ['on', 'off'].includes(v),
  scene: (v) => ['on', 'off'].includes(v),
  tutorial: (v) => ['on', 'done'].includes(v),
  events: (v) => ['on', 'off'].includes(v),
};

export function setSetting(state, key, value) {
  const rule = SETTING_RULES[key];
  if (!rule) return { ok: false, error: `Unknown setting "${key}".` };
  if (!rule(value)) return { ok: false, error: `"${value}" is not a valid ${key}.` };
  return { ok: true, state: { ...state, settings: { ...state.settings, [key]: value } } };
}

// ---- Heroes ----

const replaceHero = (state, id, fn) => ({ ...state, heroes: state.heroes.map((h) => (h.id === id ? fn(h) : h)) });

export function recruitHero(state, candidateId, data = DATA) {
  const pool = state.tavern.pool;
  const cand = pool?.find((c) => c.id === candidateId) ?? heirsOf(state, data).find((c) => c.id === candidateId);
  if (levelOf(state, 'tavern') < 1) return { ok: false, error: 'Build a Tavern to recruit adventurers.' };
  if (!cand || cand.hired) return { ok: false, error: 'That adventurer has already left the Tavern.' };
  if (state.heroes.length >= rosterCap(state, data)) {
    return { ok: false, error: `The roster is full (${rosterCap(state, data)}). Raise the Tavern to make room.` };
  }
  const cost = recruitCost(state, cand, data);
  if (state.res.gold < cost) return { ok: false, error: `${cand.name} asks for ${Math.round(cost)} gold.` };

  const n = (state.counters?.hero ?? 0) + 1;
  const iid = (state.counters?.item ?? 0) + 1;
  const slots = data.gear.slots.map((x) => x.id);
  const hero = {
    id: `h${n}`,
    name: cand.name,
    race: cand.race,
    class: cand.class,
    trait: cand.trait,
    level: cand.level,
    xp: 0,
    talents: [],
    gear: Object.fromEntries(slots.map((x) => [x, x === 'weapon' ? { ...cand.starter, id: `i${iid}` } : null])),
    lock: false,
    saveSignature: false,
    injury: 0,
    sworn: null,
    ...(cand.heir ? { ancestor: cand.ancestor } : {}),
  };
  let next = {
    ...state,
    res: { ...state.res, gold: state.res.gold - cost },
    heroes: [...state.heroes, hero],
    counters: { ...state.counters, hero: n, item: iid },
    tavern: cand.heir ? state.tavern : { ...state.tavern, pool: pool.map((c) => (c.id === candidateId ? { ...c, hired: true } : c)) },
    ...(cand.heir ? { hall: (state.hall ?? []).map((e) => (e.id === cand.hall ? { ...e, claimed: true } : e)) } : {}),
  };
  next = autoEquip(next, data);
  next = addLog(next, `${hero.name}, a ${data.raceById[hero.race].name} ${data.classById[hero.class].name}, joined the outpost${cand.heir ? `, heir of ${cand.ancestor.name}` : ''}.`, data);
  return { ok: true, state: next, hero, cost };
}

export function refreshPool(state, data = DATA) {
  if (levelOf(state, 'tavern') < 1) return { ok: false, error: 'Build a Tavern first.' };
  const cost = refreshCost(state, data);
  if (state.res.gold < cost) return { ok: false, error: `Asking around costs ${cost} gold.` };
  let tavern = { ...state.tavern, cycle: state.tavern.cycle + 1, refreshIn: data.heroes.pool.seconds };
  const next = { ...state, res: { ...state.res, gold: state.res.gold - cost }, tavern };
  tavern = { ...tavern, pool: rollPool(next, data) };
  return { ok: true, state: { ...next, tavern }, cost };
}

export function toggleLock(state, heroId) {
  const hero = heroById(state, heroId);
  if (!hero) return { ok: false, error: 'No such hero.' };
  let next = replaceHero(state, heroId, (h) => ({ ...h, lock: !h.lock }));
  if (hero.lock) next = autoEquip(next);
  return { ok: true, state: next };
}

// Equipping or unequipping by hand locks that hero's gear so auto-equip does not undo the choice.
export function equipItem(state, heroId, itemId, data = DATA) {
  const hero = heroById(state, heroId);
  const item = state.items.find((i) => i.id === itemId);
  if (!hero || !item) return { ok: false, error: 'That item is not in the bag.' };
  const need = data.tierById[item.tier].reqLevel;
  if (hero.level < need) return { ok: false, error: `${hero.name} needs level ${need} for ${item.name}.` };
  const old = hero.gear[item.slot];
  const items = state.items.filter((i) => i.id !== itemId);
  if (old) items.push(old);
  const next = replaceHero({ ...state, items }, heroId, (h) => ({ ...h, lock: true, gear: { ...h.gear, [item.slot]: item } }));
  return { ok: true, state: next };
}

export function unequipSlot(state, heroId, slot, data = DATA) {
  const hero = heroById(state, heroId);
  const item = hero?.gear[slot];
  if (!item) return { ok: false, error: 'Nothing is equipped there.' };
  if (state.items.length >= data.gear.inventoryCap) return { ok: false, error: 'The bag is full. Sell something first.' };
  const next = replaceHero({ ...state, items: [...state.items, item] }, heroId, (h) => ({ ...h, lock: true, gear: { ...h.gear, [slot]: null } }));
  return { ok: true, state: next };
}

export function chooseTalent(state, heroId, perkId, data = DATA) {
  const hero = heroById(state, heroId);
  if (!hero) return { ok: false, error: 'No such hero.' };
  if (pendingTalents(hero, data) < 1) return { ok: false, error: `${hero.name} has no talent point to spend.` };
  const perk = data.classById[hero.class].perks.find((p) => p.id === perkId);
  if (!perk) return { ok: false, error: 'That perk does not belong to this class.' };
  let next = replaceHero(state, heroId, (h) => ({ ...h, talents: [...h.talents, perkId] }));
  next = addLog(next, `${hero.name} learned ${perk.name}.`, data);
  return { ok: true, state: next, perk };
}

export function craftCost(state, slot, tier, data = DATA) {
  const sl = data.slotById[slot];
  const t = data.tierById[tier];
  const out = {};
  const k = 1 - bonusOf(state, 'forgeDiscount', data);
  for (const [id, base] of Object.entries(data.gear.craft)) out[id] = Math.round(base * sl.craft * t.craftMult * k);
  if (sl.leather > 0) for (const [id, base] of Object.entries(data.gear.craftLeather)) out[id] = Math.round(base * sl.leather * t.craftMult * k);
  return out;
}

export function craftItem(state, slot, tier, data = DATA) {
  const smith = levelOf(state, 'blacksmith');
  const t = data.tierById[tier];
  if (!data.slotById[slot] || !t) return { ok: false, error: 'Choose a slot and a tier to craft.' };
  if (smith < t.smithLevel) return { ok: false, error: `${data.slotById[slot].name} of ${t.zone} make needs Blacksmith level ${t.smithLevel}.` };
  if (state.items.length >= data.gear.inventoryCap) return { ok: false, error: 'The bag is full. Sell something first.' };
  const cost = craftCost(state, slot, tier, data);
  if (!canAfford(state.res, cost)) return { ok: false, error: 'Not enough resources to forge that.' };

  const n = (state.counters?.item ?? 0) + 1;
  const rng = makeRng(seedFrom(state.seed, n, 202));
  const item = { ...rollItem(rng, { slot, tier, luck: data.gear.luckPerSmithLevel * smith }, data), id: `i${n}` };
  let next = {
    ...state,
    res: spend(state.res, cost),
    items: [...state.items, item],
    counters: { ...state.counters, item: n },
  };
  next = autoEquip(next, data);
  const worn = next.heroes.find((h) => h.gear[slot]?.id === item.id);
  next = addLog(next, `The Blacksmith forged ${item.name}${worn ? `, now worn by ${worn.name}` : ''}.`, data);
  return { ok: true, state: next, item, cost };
}

export function sellItem(state, itemId, data = DATA) {
  const item = state.items.find((i) => i.id === itemId);
  if (!item) return { ok: false, error: 'That item is not in the bag.' };
  const gold = itemValue(state, item, data);
  return {
    ok: true,
    gold,
    state: {
      ...state,
      items: state.items.filter((i) => i.id !== itemId),
      res: { ...state.res, gold: state.res.gold + gold },
      stats: { ...state.stats, lifetimeGold: state.stats.lifetimeGold + gold },
    },
  };
}

// Used by quests and combat in later checkpoints: a hero who loses a fight rests instead of dying.
export function injureHero(state, heroId, data = DATA) {
  const hero = heroById(state, heroId);
  if (!hero) return { ok: false, error: 'No such hero.' };
  const next = replaceHero(state, heroId, (h) => ({ ...h, injury: data.heroes.injury.restSeconds }));
  return { ok: true, state: addLog(next, `${hero.name} was hurt and is resting.`, data) };
}


// ---- Quests ----

export function dispatchQuest(state, offerId, partyIds, data = DATA, potion = null) {
  const r = startRun(state, offerId, partyIds, data, { potion });
  if (!r.ok) return r;
  const names = r.run.party.map((id) => heroById(state, id).name).join(' and ');
  const drink = potion ? ` with ${data.potionById[potion].name}` : '';
  return { ...r, state: addLog(r.state, `${names} set out on "${r.run.offer.title}"${drink}.`, data) };
}

export function recallQuest(state, offerId, data = DATA) {
  const run = state.quests.active.find((x) => x.id === offerId);
  const r = recallRun(state, offerId);
  if (!r.ok) return r;
  return { ...r, state: addLog(r.state, `The party was called back from "${run.offer.title}". No reward.`, data) };
}

export function discardOffer(state, offerId, data = DATA) {
  return dropOffer(state, offerId, data);
}

export const setQuestFocus = (state, zoneId, data = DATA) => focusZone(state, zoneId, data);
export const createOrder = (state, spec, data = DATA) => makeOrder(state, spec, data);
export const removeOrder = (state, id) => dropOrder(state, id);
export const pauseOrder = (state, id, paused) => holdOrder(state, id, paused);
export const setOrderOdds = (state, id, odds, data = DATA) => changeOdds(state, id, odds, data);
export const setOrderPotion = (state, id, potion, data = DATA) => changePotion(state, id, potion, data);

// ---- Sworn recruits ----

export function recruitSworn(state, recruitId, data = DATA) {
  const r = data.recruitById[recruitId];
  if (!r) return { ok: false, error: 'No such recruit.' };
  if (levelOf(state, 'tavern') < 1) return { ok: false, error: 'Build a Tavern to recruit adventurers.' };
  const st = recruitStatus(state, r, data);
  if (st.hired) return { ok: false, error: `${r.name} already serves the outpost.` };
  if (!st.met) return { ok: false, error: st.why };
  const cls = data.classById[r.class];
  if (cls.unlock && levelOf(state, cls.unlock.building) < cls.unlock.level) return { ok: false, error: `${r.name} is a ${cls.name}: build ${data.buildingById[cls.unlock.building].name} level ${cls.unlock.level} first.` };
  if (state.heroes.length >= rosterCap(state, data)) return { ok: false, error: `The roster is full (${rosterCap(state, data)}). Raise the Tavern to make room.` };
  const cost = swornCost(state, r, data);
  if (state.res.gold < cost) return { ok: false, error: `${r.name} asks for ${cost} gold.` };
  const n = (state.counters?.hero ?? 0) + 1;
  const iid = (state.counters?.item ?? 0) + 1;
  const rng = makeRng(seedFrom(state.seed, n, 808));
  const tier = data.zoneById[r.zone].tier;
  const starter = rollItem(rng, { slot: 'weapon', tier, rarityId: 'uncommon', weights: cls.weights }, data);
  const slots = data.gear.slots.map((x) => x.id);
  const hero = {
    id: `h${n}`, name: r.name, race: r.race, class: r.class, trait: r.trait, level: r.level, xp: 0, talents: [],
    gear: Object.fromEntries(slots.map((x) => [x, x === 'weapon' ? { ...starter, id: `i${iid}` } : null])),
    lock: false, saveSignature: false, injury: 0, sworn: r.id,
  };
  let next = { ...state, res: { ...state.res, gold: state.res.gold - cost }, heroes: [...state.heroes, hero], counters: { ...state.counters, hero: n, item: iid } };
  next = autoEquip(next, data);
  next = addLog(next, `${hero.name}, a ${data.raceById[hero.race].name} ${cls.name}, swore to serve the outpost.`, data);
  return { ok: true, state: next, hero, cost };
}

// ---- Alchemy ----

export function brewPotion(state, potionId, data = DATA) {
  const p = data.potionById[potionId];
  const lab = levelOf(state, 'alchemy_lab');
  if (!p) return { ok: false, error: 'No such potion.' };
  if (lab < p.lab) return { ok: false, error: `${p.name} needs Alchemy Lab level ${p.lab}.` };
  if (state.alchemy.queue.length >= data.crafting.brew.queueMax) return { ok: false, error: `The Lab can only hold ${data.crafting.brew.queueMax} brews at a time.` };
  if (potionStock(state, potionId) + queuedOf(state, potionId) >= stockCap(state, data)) return { ok: false, error: `The Lab already holds as many ${p.name}s as it can store.` };
  if (!canAfford(state.res, p.cost)) return { ok: false, error: `Not enough resources to brew ${p.name}.` };
  return { ok: true, state: { ...state, res: spend(state.res, p.cost), alchemy: { ...state.alchemy, queue: [...state.alchemy.queue, { id: potionId, left: p.seconds }] } } };
}

// Cancelling returns everything that was paid.
export function cancelBrew(state, index, data = DATA) {
  const q = state.alchemy.queue[index];
  if (!q) return { ok: false, error: 'Nothing is brewing there.' };
  const res = { ...state.res };
  for (const [id, amt] of Object.entries(data.potionById[q.id].cost)) res[id] += amt;
  return { ok: true, state: { ...state, res, alchemy: { ...state.alchemy, queue: state.alchemy.queue.filter((_, i) => i !== index) } } };
}

// Players can hold a hero's signature ability back for boss fights (a Mage saving Fireball, say).
export function setSaveSignature(state, heroId, on) {
  const hero = state.heroes.find((h) => h.id === heroId);
  if (!hero) return { ok: false, error: 'No such hero.' };
  return { ok: true, state: { ...state, heroes: state.heroes.map((h) => (h.id === heroId ? { ...h, saveSignature: !!on } : h)) } };
}
