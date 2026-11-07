import { DATA, isLive } from './data.js';
import { newTavern } from './heroes.js';
import { newQuests } from './quests.js';
import { newAlchemy } from './alchemy.js';
import { newRaids } from './raids.js';
import { newEngage } from './engage.js';

export const SAVE_VERSION = 11;

export const DEFAULT_SETTINGS = Object.freeze({
  numberFormat: 'suffix',
  reducedMotion: 'auto',
  buyAmount: 1,
  theme: 'auto',
  textSize: 'normal',
  effects: 'on',
  scene: 'on',
  tutorial: 'on',
  events: 'on',
});

// A fresh game. `seed` and `now` are passed in so tests are reproducible.
export function newState({ seed, now, data = DATA }) {
  const res = {};
  for (const r of data.resources) res[r.id] = data.economy.startingResources?.[r.id] ?? 0;
  const buildings = {};
  for (const b of data.buildings) if (isLive(b)) buildings[b.id] = 0;
  return {
    v: SAVE_VERSION,
    savedAt: now,
    seed: seed >>> 0,
    res,
    town: { buildings, workers: {}, townHall: 1, residents: 0, arrival: 0, perks: {}, edict: null },
    ...newEngage(data),
    era: 1,
    heroes: [],
    items: [],
    hall: [],
    journal: [],
    tavern: newTavern(data),
    counters: { hero: 0, item: 0, hall: 0 },
    quests: newQuests(data),
    alchemy: newAlchemy(),
    raids: newRaids(data),
    achievements: {},
    zones: Object.fromEntries(data.zoneList.map((z) => [z.id, { cleared: [], rep: 0, trophies: 0, story: 0 }])),
    prestige: {
      renown: 0, renownTotal: 0, upgrades: {},
      legacy: 0, legacyTotal: 0, legacyEra: 0, legacyUpgrades: {},
      sands: 0, sandsTotal: 0, sandsUpgrades: {},
      bosses: [],
    },
    stats: { lifetimeGold: 0, pastGold: 0, runFrom: 0, rebuilds: 0, epochs: 0, playSeconds: 0, tributes: 0, questsDone: 0, questsFailed: 0, recentWins: 0 },
    settings: { ...DEFAULT_SETTINGS },
    log: [],
  };
}
