// Heirs: the children of retired heroes, offered in the Tavern beside the ordinary pool.
// They are derived from the Hall of Heroes and the save's seed, never stored, so a given
// save always shows the same heirs and nothing needs migrating if the numbers change.
import { DATA } from './data.js';
import { rollItem } from './heroes.js';
import { seedFrom, makeRng } from './rng.js';

export function heirOf(state, entry, data = DATA) {
  const rng = makeRng(seedFrom(state.seed, 7, entry.n, 303));
  const race = data.raceById[entry.race];
  const cls = data.classById[entry.class];
  const first = race.names.first[Math.floor(rng() * race.names.first.length)];
  const family = entry.name.split(' ').slice(1).join(' ') || race.names.last[Math.floor(rng() * race.names.last.length)];
  const starter = rollItem(rng, { slot: 'weapon', tier: 1, rarityId: 'common', weights: cls.weights }, data);
  return {
    id: `heir-${entry.id}`, name: `${first} ${family}`, race: entry.race, class: entry.class, trait: entry.trait,
    level: entry.startLevel, starter, hired: false, heir: true, hall: entry.id,
    ancestor: { name: entry.name, bonus: entry.bonus },
  };
}

// The newest unclaimed Hall entries, newest first, as Tavern candidates.
export function heirsOf(state, data = DATA) {
  const max = data.legacy.descendants.max;
  return (state.hall ?? []).filter((e) => !e.claimed).slice(-max).reverse().map((e) => heirOf(state, e, data));
}
