// The Rebuild: Prestige 1. Turns the run's gold into Renown and starts the town again.
//
// Resets: gold and resources, buildings and their workers, residents, the Town Hall, the
//   Tavern's pool, the quest board, parties on the road and standing orders, zone clears and
//   trophies, potions and the Alchemy queue, injuries, and the run's gold and clock.
// Keeps: heroes (levels, gear, talents), the bag, zone reputation and story progress,
//   Renown and the shop, Legacy and Sands of Time, settings, the log, the results record,
//   lifetime counters and the save's seed.
import { DATA, isLive } from './data.js';
import { newTavern } from './heroes.js';
import { newQuests } from './quests.js';
import { newAlchemy } from './alchemy.js';
import { newRaids } from './raids.js';
import { newEngage } from './engage.js';
import { levelCap } from './derive.js';
import { bonusOf, rebuildPreview, renownTotal, upgradeCost, upgradeLevel } from './renown.js';
import { addLog } from './actions.js';

// The town a new run opens with, given the shop. Pure: `state` only supplies the upgrades.
export function startingTown(state, data = DATA) {
  const buildings = {};
  for (const b of data.buildings) if (isLive(b)) buildings[b.id] = 0;
  const townHall = Math.min(data.townHall.maxLevel, Math.max(1, Math.floor(bonusOf(state, 'townHall', data)) || 1));
  const level = Math.floor(bonusOf(state, 'foundations', data));
  const cap = data.economy.levelsPerTownHall * townHall;
  if (level > 0) {
    for (const id of data.renown.foundations.buildings) {
      const def = data.buildingById[id];
      if (def && isLive(def) && def.unlockTownHall <= townHall) buildings[id] = Math.min(level, cap);
    }
  }
  return { buildings, workers: {}, townHall, residents: 0, arrival: 0, perks: {}, edict: null };
}

export function startingResources(state, data = DATA) {
  const res = {};
  for (const r of data.resources) res[r.id] = data.economy.startingResources?.[r.id] ?? 0;
  res.gold += bonusOf(state, 'startGold', data);
  return res;
}

// Dungeons the Scouts' Maps clear before the first quest of a run, by zone.
export function scoutedZones(state, zones, data = DATA) {
  const n = Math.floor(bonusOf(state, 'scouts', data));
  const gates = data.renown.scouts.gates.slice(0, n);
  const out = {};
  for (const [id, z] of Object.entries(zones)) {
    const add = gates.filter((g) => data.templateById[g]?.zone === id);
    out[id] = { ...z, cleared: add };
  }
  return out;
}

export function rebuild(state, data = DATA) {
  const pre = rebuildPreview(state, data);
  if (!pre.can) return { ok: false, error: 'The town has not earned any Renown yet. Keep building.' };

  const total = renownTotal(state) + pre.gain;
  const town = startingTown(state, data);
  const zones = scoutedZones(state, Object.fromEntries(Object.entries(state.zones).map(([id, z]) => [id, { ...z, cleared: [], trophies: 0 }])), data);
  const q = state.quests;
  const left = q.active.length;

  let next = {
    ...state,
    res: startingResources(state, data),
    town,
    tavern: newTavern(data),
    quests: { ...newQuests(data), history: q.history, seq: q.seq, orderSeq: q.orderSeq },
    alchemy: newAlchemy(),
    raids: newRaids(data),
    ...newEngage(data),
    zones,
    heroes: state.heroes.map((h) => (h.injury > 0 ? { ...h, injury: 0 } : h)),
    prestige: { ...state.prestige, renown: state.prestige.renown + pre.gain, renownTotal: total },
    stats: {
      ...state.stats,
      pastGold: (state.stats.pastGold ?? 0) + state.stats.lifetimeGold,
      lifetimeGold: 0,
      rebuilds: state.stats.rebuilds + 1,
      runFrom: state.stats.playSeconds,
    },
  };
  const bits = [`Rebuild ${next.stats.rebuilds}: the outpost was raised again and ${pre.gain} Renown was earned.`];
  if (left) bits.push(`${left} ${left === 1 ? 'party' : 'parties'} on the road came home with nothing.`);
  next = addLog(next, bits.join(' '), data);
  return { ok: true, state: next, gain: pre.gain, total, levelCap: levelCap(next, data) };
}

// Spend Renown on one level of a shop upgrade.
export function buyUpgrade(state, id, data = DATA) {
  const up = data.renownById[id];
  if (!up) return { ok: false, error: 'No such upgrade.' };
  const cost = upgradeCost(state, up);
  if (cost === null) return { ok: false, error: `${up.name} is already at its highest level.` };
  if (state.prestige.renown < cost) return { ok: false, error: `${up.name} costs ${cost} Renown.` };
  const level = upgradeLevel(state, id) + 1;
  const next = {
    ...state,
    prestige: { ...state.prestige, renown: state.prestige.renown - cost, upgrades: { ...state.prestige.upgrades, [id]: level } },
  };
  return { ok: true, state: addLog(next, `${up.name} reached level ${level}.`, data), cost, level };
}
