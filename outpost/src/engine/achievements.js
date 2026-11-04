// Achievements: permanent, kept across every Rebuild. Each one adds a little to the global multiplier.
import { DATA } from './data.js';
import { levelOf } from './derive.js';
import { zoneState, tierIndex, repTiers } from './zones.js';
import { renownTotal, totalGold } from './renown.js';

const CHECKS = {
  townHall: (s, a) => s.town.townHall >= a.value,
  building: (s, a) => levelOf(s, a.key) >= a.value,
  heroes: (s, a) => s.heroes.length >= a.value,
  classes: (s, a) => new Set(s.heroes.map((h) => h.class)).size >= a.value,
  heroLevel: (s, a) => s.heroes.some((h) => h.level >= a.value),
  questsDone: (s, a) => s.stats.questsDone >= a.value,
  cleared: (s, a, data) => data.zoneList.some((z) => zoneState(s, z.id).cleared.includes(a.key)),
  topStanding: (s, a, data) => data.zoneList.some((z) => tierIndex(zoneState(s, z.id).rep, data) >= repTiers(data).length - 1),
  rebuilds: (s, a) => s.stats.rebuilds >= a.value,
  renown: (s, a) => renownTotal(s) >= a.value,
  totalGold: (s, a) => totalGold(s) >= a.value,
  raidsWon: (s, a) => (s.raids?.won ?? 0) >= a.value,
};

export const achievementCount = (state) => Object.keys(state.achievements ?? {}).length;

// The multiplier every unlocked achievement adds together.
export const achievementMultiplier = (state, data = DATA) => 1 + data.achievements.bonusEach * achievementCount(state);

// Unlock whatever has newly been earned. Returns the same state when nothing changed.
export function checkAchievements(state, data = DATA) {
  const have = state.achievements ?? {};
  let add = null;
  for (const a of data.achievements.list) {
    if (have[a.id] !== undefined) continue;
    if (CHECKS[a.kind](state, a, data)) (add ??= {})[a.id] = Math.floor(state.stats.playSeconds);
  }
  if (!add) return state;
  const names = Object.keys(add).map((id) => data.achievementById[id].name);
  const log = [{ t: state.savedAt, text: `Achievement${names.length > 1 ? 's' : ''} earned: ${names.join(', ')}.` }, ...state.log].slice(0, data.economy.logLimit);
  return { ...state, achievements: { ...have, ...add }, log };
}
