import { DATA, isLive, isWorkplace, isDelve } from './data.js';
import { SAVE_VERSION, DEFAULT_SETTINGS } from './state.js';
import { NUMBER_FORMATS } from './numbers.js';
import { newTavern, xpToNext } from './heroes.js';
import { newQuests } from './quests.js';
import { newAlchemy } from './alchemy.js';
import { newRaids } from './raids.js';
import { newEngage } from './engage.js';

// Ordered migrations. MIGRATIONS[i] upgrades a save from version i+1 to i+2.
// Version 1 is the baseline, so the list is empty until the first format change.
export const MIGRATIONS = [
  // v1 -> v2 (Checkpoint 2): Town Hall gating, residents and workers arrive.
  // Keep the player's progress: raise the Town Hall just enough that every
  // building they already own is unlocked and within its level cap.
  (o) => {
    const town = o.town ?? {};
    let needed = Math.max(1, Math.floor(town.townHall ?? 1));
    for (const [id, level] of Object.entries(town.buildings ?? {})) {
      const def = DATA.buildingById[id];
      if (!def || !(level > 0)) continue;
      needed = Math.max(needed, def.unlockTownHall, Math.ceil(level / DATA.economy.levelsPerTownHall));
    }
    return { ...o, town: { ...town, townHall: Math.min(needed, DATA.townHall.maxLevel), residents: 0, arrival: 0 } };
  },
  // v2 -> v3 (Checkpoint 3): heroes, the Tavern's pool and a bag of gear arrive.
  (o) => ({ ...o, heroes: [], items: [], tavern: newTavern(), counters: { hero: 0, item: 0 } }),
  // v3 -> v4 (Checkpoint 4): the Quest Board, parties on the road and a record of results.
  (o) => ({
    ...o,
    quests: newQuests(),
    stats: { ...(o.stats ?? {}), questsDone: 0, questsFailed: 0, recentWins: 0 },
  }),
  // v4 -> v5 (Checkpoint 5): combat. Heroes get a signature-ability setting, zones count boss trophies,
  // and parties already on the road keep the outcome they were given (they have no fight record to replay).
  (o) => ({
    ...o,
    heroes: (o.heroes ?? []).map((h) => ({ ...h, saveSignature: false })),
    zones: Object.fromEntries(Object.entries(o.zones ?? { elwynn: {} }).map(([id, z]) => [id, { cleared: [], rep: 0, trophies: 0, ...z }])),
  }),
  // v5 -> v6 (Checkpoint 6): zones with reputation and story, standing orders, sworn recruits, the Alchemy Lab's potions.
  (o) => ({
    ...o,
    heroes: (o.heroes ?? []).map((h) => ({ ...h, sworn: null })),
    zones: Object.fromEntries(DATA.zoneList.map((z) => [z.id, { cleared: [], rep: 0, trophies: 0, story: 0, ...(o.zones?.[z.id] ?? {}) }])),
    quests: { ...(o.quests ?? {}), focus: null, orders: [], orderSeq: 0 },
    alchemy: newAlchemy(),
  }),
  // v6 -> v7 (Checkpoint 7): Renown and the Rebuild. Lifetime gold becomes the run's gold, so
  // earlier gold is kept in pastGold only after the first Rebuild; a v6 save is still on its first run.
  (o) => ({
    ...o,
    prestige: { renown: 0, legacy: 0, sands: 0, upgrades: {}, ...(o.prestige ?? {}), renownTotal: o.prestige?.renown ?? 0 },
    stats: { ...(o.stats ?? {}), pastGold: 0, runFrom: 0 },
  }),
  // v7 -> v8 (Checkpoint 8): town raids and achievements. Achievements are earned on the next tick.
  (o) => ({ ...o, raids: newRaids(), achievements: {} }),
  // v8 -> v9 (Checkpoint 9): Legacy, the Hall of Heroes, the Epoch and Sands of Time. A v8 save is in Era 1.
  (o) => ({
    ...o,
    era: 1,
    hall: [],
    journal: [],
    prestige: {
      renown: 0, renownTotal: 0, upgrades: {},
      ...(o.prestige ?? {}),
      legacy: 0, legacyTotal: 0, legacyEra: 0, legacyUpgrades: {}, sands: 0, sandsTotal: 0, sandsUpgrades: {}, bosses: [],
    },
    stats: { ...(o.stats ?? {}), epochs: 0 },
  }),
  // v9 -> v10 (Checkpoint 10): theme, text size, effects, town picture and a first-run tutorial. Anyone who has
  // already built something or played a few minutes is past the tutorial.
  (o) => {
    const built = Object.values(o.town?.buildings ?? {}).some((n) => n > 0);
    const seasoned = built || (o.heroes ?? []).length > 0 || (o.stats?.playSeconds ?? 0) > 300;
    return { ...o, settings: { ...(o.settings ?? {}), tutorial: seasoned ? 'done' : 'on' } };
  },
  // v10 -> v11 (hands-on layer): the Rally meter, building perks, edicts, timed events and hero commands.
  // Nothing to carry over; the fields start empty and normalize() fills them in.
  (o) => ({ ...o, town: { ...(o.town ?? {}), perks: {}, edict: null }, ...newEngage(), settings: { ...(o.settings ?? {}), events: 'on' } }),
];

export function migrate(raw, migrations = MIGRATIONS, target = SAVE_VERSION) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Save is not an object.');
  let obj = raw;
  let v = Number.isInteger(obj.v) ? obj.v : 0;
  if (v < 1) throw new Error('Save has no version number.');
  if (v > target) throw new Error(`Save is from a newer version (v${v}) than this build understands (v${target}).`);
  while (v < target) {
    const fn = migrations[v - 1];
    if (!fn) throw new Error(`No migration from save version ${v}.`);
    obj = { ...fn(obj), v: v + 1 };
    v += 1;
  }
  return obj;
}

const num = (x, fallback = 0) => (Number.isFinite(x) && x >= 0 ? x : fallback);

const idNum = (id) => Number(String(id).replace(/\D/g, '')) || 0;

function cleanItem(raw, data, withId = true) {
  if (!raw || typeof raw !== 'object') return null;
  if (!data.slotById[raw.slot] || !data.tierById[raw.tier] || !data.rarityById[raw.rarity]) return null;
  if ((withId && typeof raw.id !== 'string') || typeof raw.name !== 'string') return null;
  const lines = (Array.isArray(raw.lines) ? raw.lines : [])
    .filter((l) => l && data.statIds.includes(l.stat) && Number.isFinite(l.value) && l.value > 0)
    .slice(0, 2)
    .map((l) => ({ stat: l.stat, value: l.value }));
  if (!lines.length) return null;
  const item = { slot: raw.slot, tier: raw.tier, rarity: raw.rarity, name: raw.name.slice(0, 60), lines };
  return withId ? { id: raw.id, ...item } : item;
}

function cleanHeroes(raw, data, cap = data.heroes.maxLevel) {
  const out = [];
  const seen = new Set();
  const slots = data.gear.slots.map((s) => s.id);
  for (const h of Array.isArray(raw) ? raw : []) {
    if (!h || typeof h.id !== 'string' || seen.has(h.id)) continue;
    const cls = data.classById[h.class];
    if (!cls || !data.raceById[h.race] || !data.traitById[h.trait]) continue;
    seen.add(h.id);
    const level = Math.min(cap, Math.max(1, Math.floor(num(h.level, 1))));
    const gear = {};
    for (const slot of slots) {
      const item = cleanItem(h.gear?.[slot], data);
      gear[slot] = item && item.slot === slot ? item : null;
    }
    const perks = (Array.isArray(h.talents) ? h.talents : []).filter((id) => cls.perks.some((p) => p.id === id));
    out.push({
      id: h.id,
      name: String(h.name ?? 'Adventurer').slice(0, 40),
      race: h.race,
      class: h.class,
      trait: h.trait,
      level,
      xp: level >= cap ? 0 : Math.min(num(h.xp), xpToNext(level, data) - 1),
      talents: perks.slice(0, Math.floor(level / data.heroes.talentEvery)),
      gear,
      lock: h.lock === true,
      saveSignature: h.saveSignature === true,
      sworn: typeof h.sworn === 'string' && data.recruitById[h.sworn] ? h.sworn : null,
      injury: num(h.injury),
      ...(h.ancestor && typeof h.ancestor.name === 'string' && h.ancestor.bonus > 0
        ? { ancestor: { name: h.ancestor.name.slice(0, 40), bonus: Math.min(data.legacy.descendants.cap, num(h.ancestor.bonus)) } }
        : {}),
    });
  }
  return out;
}

function cleanTavern(raw, data) {
  const base = newTavern(data);
  if (!raw || typeof raw !== 'object') return base;
  const pool = Array.isArray(raw.pool)
    ? raw.pool
        .filter((c) => c && typeof c.id === 'string' && data.classById[c.class] && data.raceById[c.race] && data.traitById[c.trait] && cleanItem(c.starter, data, false))
        .map((c) => ({
          id: c.id, name: String(c.name ?? 'Adventurer').slice(0, 40), race: c.race, class: c.class, trait: c.trait,
          level: Math.min(data.heroes.maxLevel, Math.max(1, Math.floor(num(c.level, 1)))),
          starter: cleanItem(c.starter, data, false), hired: c.hired === true,
        }))
    : null;
  return {
    cycle: Math.floor(num(raw.cycle)),
    refreshIn: Math.min(data.heroes.pool.seconds, num(raw.refreshIn, base.refreshIn)) || base.refreshIn,
    pool: pool && pool.length ? pool : null,
  };
}


function cleanOffer(raw, data) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return null;
  const t = data.templateById[raw.template];
  const mod = data.modifierById[raw.modifier];
  if (!t || !mod || !data.zoneById[raw.zone]) return null;
  if (!(raw.duration > 0) || !(raw.rec > 0) || !(raw.level >= 1) || !Number.isInteger(raw.n)) return null;
  return {
    id: raw.id, n: raw.n, template: t.id, type: t.type, zone: raw.zone, level: Math.floor(raw.level),
    modifier: mod.id, title: String(raw.title ?? t.title).slice(0, 80), text: t.text,
    resource: t.resource ?? null, duration: raw.duration, rec: raw.rec,
  };
}

function cleanRun(raw, heroes, data) {
  const offer = cleanOffer(raw?.offer, data);
  if (!offer || !Array.isArray(raw.party)) return null;
  const party = [...new Set(raw.party)].filter((id) => heroes.some((h) => h.id === id));
  if (!party.length) return null;
  const rw = raw.reward ?? {};
  const res = {};
  for (const [id, amt] of Object.entries(rw.res ?? {})) if (data.resourceById[id] && num(amt) > 0) res[id] = Math.round(num(amt));
  const units = (Array.isArray(raw.units) ? raw.units : []).filter((u) => u && typeof u.id === 'string' && data.classById[u.cls] && Number.isFinite(u.hp) && u.hp > 0 && Number.isFinite(u.power) && Number.isFinite(u.interval) && u.interval > 0)
    .map((u) => ({
      id: u.id, name: String(u.name ?? 'Adventurer').slice(0, 40), cls: u.cls, level: Math.max(1, Math.floor(num(u.level, 1))),
      hp: u.hp, power: num(u.power), interval: u.interval, crit: num(u.crit), armour: num(u.armour), regen: num(u.regen),
      healing: num(u.healing), threat: num(u.threat, 1), save: u.save === true,
    }));
  return {
    id: offer.id, offer, party, total: Math.max(1, num(raw.total, offer.duration)),
    remaining: Math.min(num(raw.remaining, offer.duration), Math.max(1, num(raw.total, offer.duration))),
    chance: Math.min(1, num(raw.chance, 0.5)), success: raw.success === true, units: units.length === party.length ? units : [],
    stolen: Math.min(data.enemies.steal.max, num(raw.stolen)), wipedAt: Number.isInteger(raw.wipedAt) && raw.wipedAt >= 0 ? raw.wipedAt : null,
    reward: { gold: num(rw.gold), res },
    potion: data.potionById[raw.potion] ? raw.potion : null, order: typeof raw.order === 'string' ? raw.order : null,
    bonus: { gold: Math.min(2, num(raw.bonus?.gold)), xp: Math.min(2, num(raw.bonus?.xp)) },
  };
}

function cleanQuests(raw, heroes, data) {
  const base = newQuests(data);
  if (!raw || typeof raw !== 'object') return base;
  const seen = new Set();
  const busy = new Set();
  const active = [];
  for (const r of Array.isArray(raw.active) ? raw.active : []) {
    const run = cleanRun(r, heroes, data);
    if (!run || seen.has(run.id) || run.party.some((id) => busy.has(id))) continue;
    seen.add(run.id);
    run.party.forEach((id) => busy.add(id));
    active.push(run);
  }
  const board = [];
  for (const o of Array.isArray(raw.board) ? raw.board : []) {
    const offer = cleanOffer(o, data);
    if (offer && !seen.has(offer.id)) { seen.add(offer.id); board.push(offer); }
  }
  const history = (Array.isArray(raw.history) ? raw.history : [])
    .filter((e) => e && typeof e.title === 'string' && Number.isFinite(e.n))
    .slice(0, data.quests.history)
    .map((e) => ({
      n: e.n, title: e.title.slice(0, 80), type: data.quests.types[e.type] ? e.type : 'bounty', ok: e.ok === true,
      rep: num(e.rep), story: e.story === true, tierUp: typeof e.tierUp === 'string' ? e.tierUp.slice(0, 30) : '',
      opened: (Array.isArray(e.opened) ? e.opened : []).map((x) => String(x).slice(0, 40)).slice(0, 3),
      party: (Array.isArray(e.party) ? e.party : []).map((x) => String(x).slice(0, 40)).slice(0, 5),
      gold: num(e.gold), xp: num(e.xp), sold: num(e.sold), firstClear: e.firstClear === true, stolen: Math.min(1, num(e.stolen)),
      where: typeof e.where === 'string' ? e.where.slice(0, 80) : '',
      loot: (Array.isArray(e.loot) ? e.loot : []).map((x) => String(x).slice(0, 60)).slice(0, 8),
      log: (Array.isArray(e.log) ? e.log : []).map((x) => String(x).slice(0, 120)).slice(0, data.combat.log.keepLines),
      res: Object.fromEntries(Object.entries(e.res ?? {}).filter(([id, v]) => data.resourceById[id] && num(v) > 0)),
    }));
  const maxN = Math.max(0, ...[...board, ...active.map((r) => r.offer)].map((o) => o.n));
  const cfg = data.quests.orders;
  const inOrder = new Set();
  const orders = [];
  for (const o of Array.isArray(raw.orders) ? raw.orders : []) {
    if (!o || typeof o.id !== 'string' || orders.some((x) => x.id === o.id) || orders.length >= cfg.maxSlots) continue;
    const mode = o.mode === 'best' ? 'best' : 'repeat';
    const t = data.templateById[o.template];
    if (mode === 'repeat' && (!t || t.story)) continue;
    const party = [...new Set(Array.isArray(o.party) ? o.party : [])].filter((id) => heroes.some((h) => h.id === id) && !inOrder.has(id));
    if (!party.length) continue;
    party.forEach((id) => inOrder.add(id));
    orders.push({
      id: o.id, mode, template: mode === 'repeat' ? t.id : null, party,
      minOdds: cfg.minOdds.includes(o.minOdds) ? o.minOdds : cfg.defaultMinOdds,
      potion: data.potionById[o.potion] ? o.potion : null, paused: o.paused === true,
      wait: Math.min(cfg.retrySeconds, num(o.wait)), note: typeof o.note === 'string' ? o.note.slice(0, 60) : '', runs: Math.floor(num(o.runs)),
    });
  }
  const knownZone = data.zoneById[raw.focus] ? raw.focus : null;
  return {
    board: board.slice(0, data.quests.board.size + 8 + data.zoneList.length * 1), active, orders, focus: knownZone,
    orderSeq: Math.max(Math.floor(num(raw.orderSeq)), ...orders.map((o) => idNum(o.id))),
    counter: Math.max(Math.floor(num(raw.counter)), maxN),
    refreshIn: Math.min(data.quests.board.refreshSeconds, num(raw.refreshIn, base.refreshIn)) || base.refreshIn,
    history,
    seq: Math.max(Math.floor(num(raw.seq)), ...history.map((e) => e.n)),
    cmd: Object.fromEntries(Object.entries(raw.cmd ?? {}).filter(([id, v]) => heroes.some((h) => h.id === id) && num(v) > 0).map(([id, v]) => [id, Math.min(data.engage.commands.cooldownSeconds, num(v))])),
  };
}

function cleanZones(raw, data) {
  const dungeons = new Set(data.quests.templates.filter((t) => isDelve(t.type)).map((t) => t.id));
  return Object.fromEntries(data.zoneList.map((z) => {
    const r = raw?.[z.id] ?? {};
    const cleared = [...new Set(Array.isArray(r.cleared) ? r.cleared.filter((id) => dungeons.has(id) && data.templateById[id].zone === z.id) : [])];
    const steps = data.quests.templates.filter((t) => t.story?.zone === z.id).length;
    return [z.id, { cleared, rep: num(r.rep), trophies: Math.floor(num(r.trophies)), story: Math.min(steps, Math.floor(num(r.story))) }];
  }));
}

function cleanAlchemy(raw, data) {
  const stock = {};
  for (const p of data.crafting.potions) if (num(raw?.stock?.[p.id]) >= 1) stock[p.id] = Math.floor(num(raw.stock[p.id]));
  const queue = (Array.isArray(raw?.queue) ? raw.queue : [])
    .filter((q) => q && data.potionById[q.id])
    .slice(0, data.crafting.brew.queueMax)
    .map((q) => ({ id: q.id, left: Math.min(data.potionById[q.id].seconds, Math.max(0.1, num(q.left, data.potionById[q.id].seconds))) }));
  return { stock, queue };
}

function cleanRaids(raw, data) {
  const r = data.raids;
  const log = (Array.isArray(raw?.log) ? raw.log : []).slice(0, r.history).map((e) => ({
    n: Math.floor(num(e?.n)), won: e?.won === true, threat: Math.round(num(e?.threat)), defence: Math.round(num(e?.defence)),
    lost: Object.fromEntries(Object.entries(e?.lost ?? {}).filter(([id, v]) => r.steal.resources.includes(id) && num(v) > 0).map(([id, v]) => [id, Math.floor(num(v))])),
  }));
  return {
    next: Math.min(r.interval[1], Math.max(1, num(raw?.next, r.interval[1]))),
    seq: Math.max(Math.floor(num(raw?.seq)), ...log.map((e) => e.n)),
    won: Math.floor(num(raw?.won)), lost: Math.floor(num(raw?.lost)), log,
  };
}

function cleanAchievements(raw, data) {
  const out = {};
  for (const a of data.achievements.list) if (raw?.[a.id] !== undefined && raw[a.id] !== null) out[a.id] = Math.floor(num(raw[a.id]));
  return out;
}

function cleanPrestige(raw, data) {
  const upgrades = {};
  for (const up of data.renown.upgrades) {
    const level = Math.min(up.values.length, Math.floor(num(raw?.upgrades?.[up.id])));
    if (level > 0) upgrades[up.id] = level;
  }
  const renown = num(raw?.renown);
  return {
    renown,
    // The total can never be below what is left to spend.
    renownTotal: Math.max(renown, num(raw?.renownTotal)),
    legacy: num(raw?.legacy),
    // Like Renown, the totals can never be below the balance.
    legacyTotal: Math.max(num(raw?.legacy), num(raw?.legacyTotal)),
    legacyEra: num(raw?.legacyEra),
    legacyUpgrades: cleanLevels(raw?.legacyUpgrades, data.legacy.upgrades),
    sands: num(raw?.sands),
    sandsTotal: Math.max(num(raw?.sands), num(raw?.sandsTotal)),
    sandsUpgrades: cleanLevels(raw?.sandsUpgrades, data.sands.upgrades),
    upgrades,
    bosses: (Array.isArray(raw?.bosses) ? raw.bosses : []).filter((b, i, a) => /^era\d+$/.test(b) && a.indexOf(b) === i),
  };
}

function cleanLevels(raw, list) {
  const out = {};
  for (const up of list) {
    const level = Math.min(up.values.length, Math.floor(num(raw?.[up.id])));
    if (level > 0) out[up.id] = level;
  }
  return out;
}

function cleanHall(raw, data) {
  const out = [];
  const seen = new Set();
  for (const e of Array.isArray(raw) ? raw : []) {
    if (!e || typeof e.id !== 'string' || seen.has(e.id) || !data.classById[e.class] || !data.raceById[e.race] || !data.traitById[e.trait]) continue;
    seen.add(e.id);
    out.push({
      id: e.id, n: Math.max(1, Math.floor(num(e.n, idNum(e.id)))), name: String(e.name ?? 'Adventurer').slice(0, 40), race: e.race, class: e.class, trait: e.trait,
      level: Math.max(1, Math.floor(num(e.level, 1))), tier: Math.max(1, Math.floor(num(e.tier, 1))), legacy: Math.floor(num(e.legacy)),
      era: Math.max(1, Math.floor(num(e.era, 1))), bonus: Math.min(data.legacy.descendants.cap, num(e.bonus)),
      startLevel: Math.max(1, Math.floor(num(e.startLevel, 1))), claimed: e.claimed === true,
    });
  }
  return out.slice(-60);
}

function cleanJournal(raw, data) {
  return (Array.isArray(raw) ? raw : []).filter((e) => e && Number.isFinite(e.t)).slice(0, data.sands.journalKeep).map((e) => ({
    t: e.t, away: Math.floor(num(e.away)), done: Math.floor(num(e.done)), failed: Math.floor(num(e.failed)),
    gold: Math.floor(num(e.gold)), xp: Math.floor(num(e.xp)), levels: Math.floor(num(e.levels)),
  }));
}

// Keep only workers that make sense: built workplaces, within the per-building
// limit, and never more than there are residents.
function cleanWorkers(raw, buildings, residents, data) {
  const out = {};
  let left = residents;
  for (const def of data.buildings) {
    if (!isWorkplace(def) || !(buildings[def.id] > 0)) continue;
    const n = Math.min(Math.floor(num(raw?.[def.id])), data.economy.workers.maxPerBuilding + data.economy.workers.maxExtraSlots, left);
    if (n > 0) { out[def.id] = n; left -= n; }
  }
  return out;
}

// Perks: only known workplaces, known tiers, and picks a and b.
function cleanPerks(raw, buildings, data) {
  const out = {};
  for (const [id, rows] of Object.entries(data.engage.perks.byBuilding)) {
    const picks = {};
    for (const at of data.engage.perks.tiers) {
      const v = raw?.[id]?.[at];
      if ((v === 'a' || v === 'b') && (buildings[id] ?? 0) >= at) picks[at] = v;
    }
    if (Object.keys(picks).length) out[id] = picks;
  }
  return out;
}

// The Rally meter, buffs and the pending event.
function cleanEngage(obj, data) {
  const base = newEngage(data);
  const cfg = data.engage;
  const r = obj.rally ?? {};
  const rally = { charge: Math.min(cfg.rally.full, num(r.charge)), burst: Math.min(cfg.rally.burstSeconds, num(r.burst)), bursts: Math.floor(num(r.bursts)) };
  const buffs = (Array.isArray(obj.buffs) ? obj.buffs : []).filter((b) => b && typeof b.name === 'string' && num(b.left) > 0)
    .slice(0, 6).map((b) => ({ id: String(b.id ?? '').slice(0, 30), name: b.name.slice(0, 40), left: Math.min(3600, num(b.left)), total: Math.min(3600, Math.max(num(b.left), num(b.total))), output: Math.min(1, num(b.output)), questSpeed: Math.min(1, num(b.questSpeed)) }));
  const ev = obj.event && data.eventById[obj.event.id] && num(obj.event.left) > 0 ? { id: obj.event.id, left: Math.min(cfg.events.window, num(obj.event.left)), total: cfg.events.window } : null;
  const e = obj.events ?? {};
  return { rally, buffs, event: ev, events: { next: Math.min(cfg.events.interval[1], num(e.next, base.events.next)), seq: Math.floor(num(e.seq)), taken: Math.floor(num(e.taken)) } };
}

// Fill gaps and clamp nonsense so a hand-edited or partial save cannot crash the game.
export function normalize(obj, data = DATA) {
  const res = {};
  for (const r of data.resources) res[r.id] = num(obj.res?.[r.id]);
  const buildings = {};
  for (const b of data.buildings) if (isLive(b)) buildings[b.id] = Math.floor(num(obj.town?.buildings?.[b.id]));
  const residents = Math.floor(num(obj.town?.residents));
  const workers = cleanWorkers(obj.town?.workers, buildings, residents, data);
  const s = obj.settings ?? {};
  const era = Math.min(data.sands.maxEra, Math.max(1, Math.floor(num(obj.era, 1))));
  const heroes = cleanHeroes(obj.heroes, data, data.heroes.eraCaps[Math.min(era, data.heroes.eraCaps.length) - 1]);
  const hall = cleanHall(obj.hall, data);
  const items = (Array.isArray(obj.items) ? obj.items : []).map((i) => cleanItem(i, data)).filter(Boolean).slice(0, data.gear.inventoryCap);
  return {
    v: SAVE_VERSION,
    savedAt: num(obj.savedAt, Date.now()),
    seed: num(obj.seed) >>> 0,
    res,
    town: {
      buildings,
      workers,
      townHall: Math.min(data.townHall.maxLevel, Math.max(1, Math.floor(num(obj.town?.townHall, 1)))),
      residents,
      arrival: Math.min(num(obj.town?.arrival), data.economy.residents.arrivalSeconds),
      perks: cleanPerks(obj.town?.perks, buildings, data),
      edict: data.edictById[obj.town?.edict] ? obj.town.edict : null,
    },
    ...cleanEngage(obj, data),
    era,
    heroes,
    items,
    hall,
    journal: cleanJournal(obj.journal, data),
    tavern: cleanTavern(obj.tavern, data),
    counters: {
      hall: Math.max(Math.floor(num(obj.counters?.hall)), ...hall.map((e) => e.n)),
      hero: Math.max(Math.floor(num(obj.counters?.hero)), ...heroes.map((h) => idNum(h.id))),
      item: Math.max(
        Math.floor(num(obj.counters?.item)),
        ...items.map((i) => idNum(i.id)),
        ...heroes.flatMap((h) => Object.values(h.gear).filter(Boolean).map((i) => idNum(i.id))),
      ),
    },
    quests: cleanQuests(obj.quests, heroes, data),
    zones: cleanZones(obj.zones, data),
    alchemy: cleanAlchemy(obj.alchemy, data),
    raids: cleanRaids(obj.raids, data),
    achievements: cleanAchievements(obj.achievements, data),
    prestige: cleanPrestige(obj.prestige, data),
    stats: {
      lifetimeGold: num(obj.stats?.lifetimeGold),
      pastGold: num(obj.stats?.pastGold),
      runFrom: Math.min(num(obj.stats?.runFrom), num(obj.stats?.playSeconds)),
      rebuilds: Math.floor(num(obj.stats?.rebuilds)),
      playSeconds: num(obj.stats?.playSeconds),
      tributes: Math.floor(num(obj.stats?.tributes)),
      questsDone: Math.floor(num(obj.stats?.questsDone)),
      questsFailed: Math.floor(num(obj.stats?.questsFailed)),
      epochs: Math.floor(num(obj.stats?.epochs)),
      recentWins: Math.min(data.quests.winsFull, Math.floor(num(obj.stats?.recentWins))),
    },
    settings: {
      numberFormat: NUMBER_FORMATS.includes(s.numberFormat) ? s.numberFormat : DEFAULT_SETTINGS.numberFormat,
      reducedMotion: ['auto', 'on', 'off'].includes(s.reducedMotion) ? s.reducedMotion : DEFAULT_SETTINGS.reducedMotion,
      buyAmount: [1, 10, 'max'].includes(s.buyAmount) ? s.buyAmount : DEFAULT_SETTINGS.buyAmount,
      theme: ['auto', 'dark', 'light'].includes(s.theme) ? s.theme : DEFAULT_SETTINGS.theme,
      textSize: ['normal', 'large'].includes(s.textSize) ? s.textSize : DEFAULT_SETTINGS.textSize,
      effects: ['on', 'off'].includes(s.effects) ? s.effects : DEFAULT_SETTINGS.effects,
      scene: ['on', 'off'].includes(s.scene) ? s.scene : DEFAULT_SETTINGS.scene,
      tutorial: ['on', 'done'].includes(s.tutorial) ? s.tutorial : DEFAULT_SETTINGS.tutorial,
      events: ['on', 'off'].includes(s.events) ? s.events : DEFAULT_SETTINGS.events,
    },
    log: (Array.isArray(obj.log) ? obj.log : [])
      .filter((e) => e && typeof e.text === 'string')
      .slice(0, data.economy.logLimit),
  };
}

export function serialize(state) {
  return JSON.stringify(state);
}

export function deserialize(text, data = DATA, migrations = MIGRATIONS) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Save is not valid JSON.');
  }
  return normalize(migrate(parsed, migrations), data);
}

// ---- Export strings: "OOA1.z.<base64 of deflated JSON>" (or ".j." uncompressed) ----

const PREFIX = 'OOA1';

function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(text) {
  const bin = atob(text);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function pipe(bytes, transform) {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function exportString(state) {
  const bytes = new TextEncoder().encode(serialize(state));
  if (typeof CompressionStream === 'function') {
    try {
      return `${PREFIX}.z.${toBase64(await pipe(bytes, new CompressionStream('deflate-raw')))}`;
    } catch {
      /* fall through to uncompressed */
    }
  }
  return `${PREFIX}.j.${toBase64(bytes)}`;
}

export async function importString(text, data = DATA, migrations = MIGRATIONS) {
  const trimmed = String(text ?? '').trim();
  const parts = trimmed.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) {
    throw new Error('That does not look like an Outpost of Azeroth save string.');
  }
  let bytes;
  try {
    bytes = fromBase64(parts[2]);
    if (parts[1] === 'z') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    else if (parts[1] !== 'j') throw new Error('unknown encoding');
  } catch {
    throw new Error('The save string is damaged or incomplete. Copy it again in full.');
  }
  return deserialize(new TextDecoder().decode(bytes), data, migrations);
}
