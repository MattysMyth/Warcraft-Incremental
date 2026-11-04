// Hero rules: stats, levelling, the Tavern's recruit pool, gear and injury.
// Pure functions over state; nothing here is ever stored except the plain hero,
// item and tavern objects described in state.js.
import { DATA } from './data.js';
import { levelOf, isHungry } from './derive.js';
import { bonusOf, classEffects } from './renown.js';
import { seedFrom, makeRng } from './rng.js';

const HD = (data) => data.heroes;

// ---- Levelling ----

export const xpToNext = (level, data = DATA) => Math.round(HD(data).xp.base * level ** HD(data).xp.exp);

export const pendingTalents = (hero, data = DATA) =>
  Math.max(0, Math.floor(hero.level / HD(data).talentEvery) - hero.talents.length);

// Add experience, levelling up as often as it allows. Returns a new hero.
// The level ceiling of the current Era, and the highest any Era allows.
export const heroCap = (state, data = DATA) => HD(data).eraCaps[Math.min(HD(data).eraCaps.length, Math.max(1, state?.era ?? 1)) - 1];
export const topCap = (data = DATA) => Math.max(...HD(data).eraCaps);

export function addXp(hero, amount, data = DATA, cap = HD(data).maxLevel) {
  const max = cap;
  let { level, xp } = hero;
  xp += amount;
  while (level < max && xp >= xpToNext(level, data)) {
    xp -= xpToNext(level, data);
    level += 1;
  }
  if (level >= max) xp = 0;
  return level === hero.level && xp === hero.xp ? hero : { ...hero, level, xp };
}

// ---- Morale and effects ----

export function moraleOf(state, data = DATA) {
  const m = HD(data).morale;
  const fed = state.town.residents > 0 && !isHungry(state, data);
  const tavern = Math.min(1, levelOf(state, 'tavern') / m.tavernLevels);
  const wins = Math.min(1, (state.stats.recentWins ?? 0) / data.quests.winsFull);
  return m.base + (fed ? m.fed : 0) + m.tavernMax * tavern + m.winsMax * wins;
}

// Sum the percentage-style effects of a hero's race, trait and chosen perks.
export function effectsOf(hero, data = DATA) {
  const cls = data.classById[hero.class];
  const sum = {};
  const add = (e) => { for (const [k, v] of Object.entries(e ?? {})) sum[k] = (sum[k] ?? 0) + v; };
  add(data.raceById[hero.race]?.effect);
  add(data.traitById[hero.trait]?.effect);
  for (const id of hero.talents) add(cls.perks.find((p) => p.id === id)?.effect);
  if (hero.ancestor?.bonus) add({ hp: hero.ancestor.bonus, power: hero.ancestor.bonus });
  return sum;
}

// The full character sheet. Gear and morale feed the five stats; everything else follows from those.
export function sheetOf(state, hero, data = DATA) {
  const hd = HD(data);
  const cls = data.classById[hero.class];
  const race = data.raceById[hero.race];
  const fx = effectsOf(hero, data);
  for (const [k, v] of Object.entries(classEffects(state, hero.class, data))) fx[k] = (fx[k] ?? 0) + v;
  const morale = Math.min(1.1, Math.max(0.9, moraleOf(state, data) + (fx.morale ?? 0)));

  const stats = {};
  for (const id of data.statIds) {
    let raw = cls.base[id] + cls.growth[id] * (hero.level - 1);
    for (const item of Object.values(hero.gear)) {
      for (const line of item?.lines ?? []) if (line.stat === id) raw += line.value;
    }
    stats[id] = raw * (race.statMult?.[id] ?? 1) * morale;
  }

  const staminaMod = Math.max(hd.hp.floor, 1 + (stats.stamina - hd.hp.staminaRef) / hd.hp.staminaStep);
  return {
    stats,
    morale,
    staminaMod,
    hp: (hd.hp.base + hd.hp.perLevel * hero.level) * staminaMod * (1 + (fx.hp ?? 0)),
    power: stats[cls.primary] * (1 + (fx.power ?? 0)),
    healing: (stats.spirit * hd.healing.perSpirit + stats.intellect * hd.healing.perIntellect) * (1 + (fx.healing ?? 0)),
    crit: Math.min(hd.crit.cap, hd.crit.base + stats.agility * hd.crit.perAgility + (fx.crit ?? 0)),
    haste: 1 + stats.agility * hd.haste.perAgility + (fx.haste ?? 0),
    regen: stats.spirit * hd.regen.perSpirit * (1 + (fx.regen ?? 0)),
    armour: (stats.stamina * hd.armour.perStamina + stats.strength * hd.armour.perStrength) * (1 + (fx.armour ?? 0)),
    threat: cls.threat * (1 + (fx.threat ?? 0)),
    xpMult: 1 + (fx.xp ?? 0) + bonusOf(state, 'xp', data),
    recovery: 1 + (fx.recovery ?? 0) + bonusOf(state, 'recovery', data),
  };
}

// ---- Roster and classes ----

export const rosterCap = (state, data = DATA) => {
  const r = HD(data).roster;
  return levelOf(state, 'tavern') > 0 ? r.base + Math.floor(levelOf(state, 'tavern') / r.levelsPerSlot) + bonusOf(state, 'rosterSlots', data) : 0;
};

export const classUnlocked = (cls, state) => !cls.unlock || levelOf(state, cls.unlock.building) >= cls.unlock.level;
export const unlockedClasses = (state, data = DATA) => HD(data).classes.filter((c) => classUnlocked(c, state));

export const heroById = (state, id) => state.heroes.find((h) => h.id === id);

// ---- Gear ----

export function itemScore(cls, item) {
  return item.lines.reduce((sum, l) => sum + l.value * (cls.weights[l.stat] ?? 0), 0);
}

export function itemValue(state, item, data = DATA) {
  const points = item.lines.reduce((a, l) => a + l.value, 0);
  const { goldPerPoint, marketBonus } = data.gear.sell;
  return Math.round(points * goldPerPoint * (1 + marketBonus * levelOf(state, 'market')));
}

// Roll one item. `rarityId` forces a rarity; `weights` biases which stats appear.
export function rollItem(rng, { slot, tier, rarityId = null, luck = 0, weights = null }, data = DATA) {
  const gd = data.gear;
  let rarity = data.rarityById[rarityId];
  if (!rarity) {
    const r = 1 - (1 - rng()) ** (1 + luck);
    rarity = [...gd.rarities].reverse().find((x) => r >= x.above) ?? gd.rarities[0];
  }
  const [lo, hi] = rarity.lines;
  const count = lo + Math.floor(rng() * (hi - lo + 1));
  const pool = data.statIds.map((id) => ({ id, w: weights ? Math.max(0.05, weights[id] ?? 0) : 1 }));
  const chosen = [];
  for (let n = 0; n < count; n += 1) {
    const total = pool.reduce((a, p) => a + p.w, 0);
    let pick = rng() * total;
    let at = 0;
    for (let i = 0; i < pool.length; i += 1) {
      pick -= pool[i].w;
      if (pick <= 0) { at = i; break; }
      at = i;
    }
    chosen.push(pool.splice(at, 1)[0].id);
  }
  const budget = data.tierById[tier].budget * data.slotById[slot].share * rarity.mult * (count === 1 ? 1 : gd.twoLineShare);
  const names = gd.names[slot][tier - 1];
  return {
    slot,
    tier,
    rarity: rarity.id,
    name: `${rarity.name} ${names[Math.floor(rng() * names.length) % names.length]}`,
    lines: chosen.map((stat) => ({ stat, value: Math.round(budget * 10) / 10 })),
  };
}

// Give heroes the best item for each slot. Heroes with locked gear are left alone.
// Single pass in roster order; items that get displaced become available to later heroes.
export function autoEquip(state, data = DATA) {
  const slots = data.gear.slots.map((s) => s.id);
  const items = [...state.items];
  let changed = false;
  const heroes = state.heroes.map((hero) => {
    if (hero.lock) return hero;
    const cls = data.classById[hero.class];
    let gear = hero.gear;
    for (const slot of slots) {
      const cur = gear[slot];
      let best = null;
      let bestScore = cur ? itemScore(cls, cur) : -1;
      for (const it of items) {
        if (it.slot !== slot || data.tierById[it.tier].reqLevel > hero.level) continue;
        const sc = itemScore(cls, it);
        if (sc > bestScore + 1e-9) { best = it; bestScore = sc; }
      }
      if (best) {
        items.splice(items.indexOf(best), 1);
        if (cur) items.push(cur);
        gear = { ...gear, [slot]: best };
        changed = true;
      }
    }
    return gear === hero.gear ? hero : { ...hero, gear };
  });
  return changed ? { ...state, heroes, items } : state;
}

// ---- Tavern pool ----

export function poolSize(state, data = DATA) {
  const p = HD(data).pool;
  return Math.min(p.max, p.base + Math.floor(levelOf(state, 'tavern') / p.levelsPerExtra));
}

export const recruitCost = (state, candidate, data = DATA) => {
  const r = HD(data).recruit;
  const heir = candidate.heir ? 1 - data.legacy.descendants.discount : 1;
  return Math.round(r.cost * r.growth ** state.heroes.length * (1 + r.perStartLevel * (candidate.level - 1)) * (1 - bonusOf(state, 'recruitDiscount', data)) * heir);
};

export const refreshCost = (state, data = DATA) => {
  const r = HD(data).pool.refreshCost;
  return Math.round(r.base * (1 + r.perTavernLevel * levelOf(state, 'tavern')));
};

// Candidates are built from the save's seed and the pool's cycle, so a given save
// always shows the same people. Classes still locked are never offered.
export function rollPool(state, data = DATA) {
  const hd = HD(data);
  const classes = unlockedClasses(state, data);
  const tavern = levelOf(state, 'tavern');
  const startLevel = 1 + Math.floor(tavern / hd.pool.startLevelEvery);
  const out = [];
  for (let i = 0; i < poolSize(state, data); i += 1) {
    const rng = makeRng(seedFrom(state.seed, state.tavern.cycle, i, 101));
    const race = hd.races[Math.floor(rng() * hd.races.length)];
    const cls = classes[Math.floor(rng() * classes.length)];
    const trait = hd.traits[Math.floor(rng() * hd.traits.length)];
    const first = race.names.first[Math.floor(rng() * race.names.first.length)];
    const last = race.names.last[Math.floor(rng() * race.names.last.length)];
    const starter = rollItem(rng, { slot: 'weapon', tier: 1, rarityId: 'common', weights: cls.weights }, data);
    out.push({ id: `c${state.tavern.cycle}-${i}`, name: `${first} ${last}`, race: race.id, class: cls.id, trait: trait.id, level: startLevel, starter, hired: false });
  }
  return out;
}

export const newTavern = (data = DATA) => ({ cycle: 0, refreshIn: HD(data).pool.seconds, pool: null });

// ---- Time: training, rest, the pool timer ----

export const restRate = (state, hero, data = DATA) => {
  const inj = HD(data).injury;
  const base = Math.min(inj.restRateMax, inj.restRateBase + inj.restRatePerChapel * levelOf(state, 'chapel'));
  return base * sheetOf(state, hero, data).recovery;
};

// Experience per second from drilling in the yard. Quests (a later checkpoint) go much further.
export function drillRate(state, hero, data = DATA) {
  const d = HD(data).drill;
  if (hero.injury > 0 || hero.level >= d.maxLevel || state.quests.active.some((r) => r.party.includes(hero.id))) return 0;
  const bonus = 1 + d.barracksBonus * levelOf(state, 'barracks');
  return (xpToNext(hero.level, data) / (d.seconds * hero.level ** d.levelExp)) * bonus * sheetOf(state, hero, data).xpMult;
}

function trainHero(state, hero, dt, data) {
  let h = hero;
  let left = dt;
  if (h.injury > 0) {
    const rate = restRate(state, h, data);
    const need = h.injury / rate;
    if (left < need) return { ...h, injury: h.injury - left * rate };
    left -= need;
    h = { ...h, injury: 0 };
  }
  for (let guard = 0; left > 1e-9 && guard < 200; guard += 1) {
    const rate = drillRate(state, h, data);
    if (rate <= 0) break;
    const toLevel = (xpToNext(h.level, data) - h.xp) / rate;
    if (toLevel > left) { h = { ...h, xp: h.xp + rate * left }; break; }
    left -= toLevel;
    h = addXp({ ...h, xp: xpToNext(h.level, data) }, 0, data);
  }
  return h;
}

// Advance heroes and the Tavern by dt seconds. Returns only the pieces that changed.
export function stepHeroes(state, dt, data = DATA) {
  const out = {};
  let heroes = state.heroes;
  if (heroes.length) {
    const before = heroes;
    heroes = heroes.map((h) => trainHero(state, h, dt, data));
    const moved = heroes.some((h, i) => h !== before[i] && (h.level !== before[i].level || (before[i].injury > 0 && h.injury === 0)));
    if (heroes.some((h, i) => h !== before[i])) out.heroes = heroes;
    if (moved) {
      const eq = autoEquip({ ...state, heroes }, data);
      if (eq.heroes !== heroes) { out.heroes = eq.heroes; out.items = eq.items; }
    }
  }
  if (levelOf(state, 'tavern') > 0) {
    let t = state.tavern;
    const secs = HD(data).pool.seconds;
    if (!t.pool) {
      t = { ...t, pool: rollPool({ ...state, tavern: t }, data) };
    } else {
      let refreshIn = t.refreshIn - dt;
      if (refreshIn <= 0) {
        const cycles = 1 + Math.floor(-refreshIn / secs);
        refreshIn += cycles * secs;
        t = { ...t, cycle: t.cycle + cycles, refreshIn };
        t = { ...t, pool: rollPool({ ...state, tavern: t }, data) };
      } else {
        t = { ...t, refreshIn };
      }
    }
    out.tavern = t;
  }
  return out;
}
