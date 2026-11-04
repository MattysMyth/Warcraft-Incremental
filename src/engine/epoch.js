// The Epoch: Prestige 3. When an Era's boss has fallen, the outpost may end the Era. Every
// hero of level 40 or more retires into Legacy, the town and the Renown it earned are wiped, and the
// world moves on to the next Era, paying out Sands of Time: a rare currency for the deepest upgrades.
//
// Resets: everything a Rebuild resets, plus every hero (those under the retirement level simply
//   go home), the bag, Renown (balance, total and shop upgrades) and this Era's Legacy tally.
// Keeps: Legacy, its shop and talents, the Hall of Heroes, Sands and their upgrades, zone standing
//   and story, achievements, settings, the log and the results record.
import { DATA } from './data.js';
import { newTavern } from './heroes.js';
import { newQuests } from './quests.js';
import { newAlchemy } from './alchemy.js';
import { newRaids } from './raids.js';
import { addLog } from './actions.js';
import { startingTown, startingResources, scoutedZones } from './rebuild.js';
import { retireAll } from './legacy.js';
import { sandsMultiplier, sandsTotal } from './renown.js';

export { sandsMultiplier, sandsTotal };

export const sandsLevel = (state, id) => Math.floor(state.prestige?.sandsUpgrades?.[id] ?? 0);

export function sandsCost(state, up) {
  const level = sandsLevel(state, up.id);
  if (level >= up.values.length) return null;
  return Math.ceil(up.cost.base * up.cost.growth ** level);
}

export function buySands(state, id, data = DATA) {
  const up = data.sandsById[id];
  if (!up) return { ok: false, error: 'No such upgrade.' };
  const cost = sandsCost(state, up);
  if (cost === null) return { ok: false, error: `${up.name} is already at its highest level.` };
  if ((state.prestige.sands ?? 0) < cost) return { ok: false, error: `${up.name} costs ${cost} Sands of Time.` };
  const level = sandsLevel(state, id) + 1;
  const next = {
    ...state,
    prestige: { ...state.prestige, sands: state.prestige.sands - cost, sandsUpgrades: { ...state.prestige.sandsUpgrades, [id]: level } },
  };
  return { ok: true, state: addLog(next, `${up.name} reached level ${level}.`, data), cost, level };
}

export const eraOf = (state) => Math.max(1, state.era ?? 1);

export function sandsGain(legacyThisEra, data = DATA) {
  const g = data.sands.gain;
  return Math.floor(g.perEra + Math.max(0, legacyThisEra) ** g.legacyExp);
}

// What an Epoch would do right now, for the confirm screen.
export function epochPreview(state, data = DATA) {
  const era = eraOf(state);
  const maxEra = data.sands.maxEra;
  const bossDown = (state.prestige?.bosses ?? []).includes(`era${era}`);
  const retiring = state.heroes.filter((h) => h.level >= data.legacy.gain.minLevel);
  const lost = state.heroes.length - retiring.length;
  const busy = state.quests.active.length;
  const retired = retireAll(state, data);
  const legacyEra = (state.prestige?.legacyEra ?? 0) + retired.gain;
  const gain = sandsGain(legacyEra, data);
  const total = sandsTotal(state);
  let why = '';
  if (era >= maxEra) why = 'This is the last Era the chronicle has been written for. The next one is still being written.';
  else if (!bossDown) why = `Defeat the Era ${era} boss first.`;
  return {
    can: !why, why, era, nextEra: era + 1, bossDown, gain, legacyEra,
    retiring: retiring.length, retireLegacy: retired.gain, lost, busy,
    total, totalAfter: total + gain, multiplier: sandsMultiplier(total, data), multiplierAfter: sandsMultiplier(total + gain, data),
  };
}

export function epoch(state, data = DATA) {
  const pre = epochPreview(state, data);
  if (!pre.can) return { ok: false, error: pre.why };

  const retired = retireAll(state, data);
  const s = retired.state;
  // The new Era's town is built as if Renown had never been earned, so only the Sands of Time shape it.
  const wiped = { ...s, prestige: { ...s.prestige, renown: 0, renownTotal: 0, upgrades: {} } };
  const q = s.quests;
  const zones = scoutedZones(wiped, Object.fromEntries(Object.entries(s.zones).map(([id, z]) => [id, { ...z, cleared: [], trophies: 0 }])), data);
  const era = pre.nextEra;
  let next = {
    ...s,
    era,
    res: startingResources(wiped, data),
    town: startingTown(wiped, data),
    tavern: newTavern(data),
    quests: { ...newQuests(data), history: q.history, seq: q.seq, orderSeq: q.orderSeq },
    alchemy: newAlchemy(),
    raids: newRaids(data),
    zones,
    heroes: [],
    items: [],
    prestige: {
      ...s.prestige,
      renown: 0, renownTotal: 0, upgrades: {},
      legacyEra: 0,
      sands: (s.prestige.sands ?? 0) + pre.gain,
      sandsTotal: sandsTotal(s) + pre.gain,
    },
    stats: {
      ...s.stats,
      pastGold: (s.stats.pastGold ?? 0) + s.stats.lifetimeGold,
      lifetimeGold: 0,
      epochs: (s.stats.epochs ?? 0) + 1,
      runFrom: s.stats.playSeconds,
      recentWins: 0,
    },
  };
  const bits = [`Era ${era} begins. The Sands of Time gave ${pre.gain}.`];
  if (retired.entries.length) bits.push(`${retired.entries.length} ${retired.entries.length === 1 ? 'hero' : 'heroes'} entered the Hall of Heroes for ${retired.gain} Legacy.`);
  if (pre.lost) bits.push(`${pre.lost} younger ${pre.lost === 1 ? 'hero' : 'heroes'} went home.`);
  next = addLog(next, bits.join(' '), data);
  return { ok: true, state: next, gain: pre.gain, era, retired: retired.entries.length, legacy: retired.gain };
}
