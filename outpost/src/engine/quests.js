// Quests: the board, parties, timers and rewards. Pure functions over state.
// Whether a party wins is decided by the combat resolver (combat.js) the moment it leaves,
// from the save's seed, so the odds shown beforehand are measured by simulating the same fight.
import { DATA, isDelve } from './data.js';
import { levelOf, questSpeedMultiplier, productionParts, storageCap } from './derive.js';
import { bonusOf } from './renown.js';
import { sheetOf, addXp, heroCap, xpToNext, autoEquip, rollItem, itemValue } from './heroes.js';
import { seedFrom, makeRng } from './rng.js';
import { openZones, zoneOpen, zoneState, repMult, repLuck, perks, nextStory, tierIndex, repTiers } from './zones.js';
import { potionStock } from './alchemy.js';
import { heroUnit, encountersFor, runFight, winOdds, fightSeed } from './combat.js';

const QD = (data) => data.quests;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const round5 = (x) => Math.max(5, Math.round(x / 5) * 5);

export const newQuests = (data = DATA) => ({
  board: [], active: [], orders: [], counter: 0, refreshIn: QD(data).board.refreshSeconds, history: [], seq: 0, focus: null, orderSeq: 0,
});

export const busyIds = (state) => new Set(state.quests.active.flatMap((r) => r.party));
export const isBusy = (state, heroId) => state.quests.active.some((r) => r.party.includes(heroId));

export const isStory = (offer, data = DATA) => !!data.templateById[offer.template]?.story;
// Lore notices and a zone's headline dungeon (until it is first cleared) are pinned: they do not use
// up one of the board's ordinary places and cannot be taken down.
export const isPinned = (offer, state, data = DATA) => {
  const t = data.templateById[offer.template];
  if (!t) return false;
  if (t.story) return true;
  return isDelve(t.type) && data.zoneById[t.zone]?.headline === t.id && !zoneState(state, t.zone).cleared.includes(t.id);
};
// Ordinary notices the board holds: the base size plus the Sands of Time's second board.
export const boardSize = (state, data = DATA) => QD(data).board.size + Math.floor(bonusOf(state, 'boardSlots', data));

export const regularCount = (state, data = DATA) => state.quests.board.filter((o) => !isPinned(o, state, data)).length;

// ---- Ratings ----

// A hero's rough strength as one number. It sets the recommended rating shown on notices;
// the actual odds come from simulating the fight.
export function heroRating(state, hero, data = DATA) {
  const w = QD(data).rating;
  const s = sheetOf(state, hero, data);
  return s.power * s.haste * (1 + s.crit / 100) + w.healing * s.healing + w.hp * s.hp;
}

export const partyRating = (state, ids, data = DATA) =>
  ids.reduce((sum, id) => {
    const hero = state.heroes.find((h) => h.id === id);
    return sum + (hero ? heroRating(state, hero, data) : 0);
  }, 0);

// The chance of winning with this party, measured by running the fight many times with other seeds.
export function oddsFor(state, offer, ids, data = DATA, potion = null) {
  const heroes = ids.map((id) => state.heroes.find((h) => h.id === id)).filter(Boolean);
  return heroes.length ? winOdds(state, offer, heroes, data, potion) : 0;
}

// What the party will face, for display: "3 Timber wolf".
export function enemySummary(offer, data = DATA) {
  const t = data.templateById[offer.template];
  if (!t) return [];
  if (isDelve(t.type)) return t.encounters.map((e) => ({ name: e.name, boss: !!e.boss, count: e.enemies.reduce((a, g) => a + g.n, 0) }));
  return t.enemies.map((g) => ({ name: data.enemyById[g.id].name, count: g.n }));
}

// Travel is shorter with Stables. The reward does not shrink with it.
export function runSeconds(state, offer, data = DATA) {
  const s = QD(data).stables;
  return Math.max(5, offer.duration * (1 - Math.min(s.max, s.perLevel * levelOf(state, 'stables'))));
}

// ---- Rewards ----

export function heroXpFor(state, hero, offer, data = DATA) {
  const r = QD(data).reward;
  const type = QD(data).types[offer.type];
  let xp = (xpToNext(offer.level, data) / r.xpDivisor) * (offer.duration / 60) * data.modifierById[offer.modifier].reward * type.xpMult;
  const gap = hero.level - offer.level;
  if (gap > r.overLevelStart) xp *= Math.max(r.overLevelFloor, 1 - r.overLevelStep * (gap - r.overLevelStart));
  const bonus = 1 + data.heroes.drill.barracksBonus * levelOf(state, 'barracks');
  return xp * bonus * sheetOf(state, hero, data).xpMult * (1 + perks(state, data).xp);
}

export function rewardFor(state, offer, partySize, data = DATA) {
  const q = QD(data);
  const mod = data.modifierById[offer.modifier];
  const minutes = offer.duration / 60;
  const standing = repMult(state, offer.zone, data);
  const bonus = perks(state, data);
  if (offer.type === 'gathering') {
    const gross = productionParts(state, data).gross[offer.resource] ?? 0;
    const base = q.gather.base[offer.resource] * q.gather.growth ** (offer.level - 1) * minutes;
    const amount = (base + q.gather.share * gross * offer.duration) * mod.reward * (1 + q.gather.partyBonus * (partySize - 1)) * standing * (1 + bonus.res);
    return { gold: 0, res: { [offer.resource]: Math.max(1, Math.round(amount)) } };
  }
  const mult = isDelve(offer.type) ? q.types[offer.type].rewardMult : 1;
  return { gold: Math.round(q.reward.goldPerMinute * q.reward.goldGrowth ** (offer.level - 1) * minutes * mod.reward * mult * (q.types[offer.type].goldMult ?? 1) * standing * (1 + bonus.gold) * (1 + bonusOf(state, 'questGold', data))), res: {} };
}

// ---- The board ----

export function eligible(t, state, data = DATA) {
  if (t.story) return false;
  if (!meets(t, state, data)) return false;
  if (isDelve(t.type)) {
    const q = state.quests;
    if (q.board.some((o) => o.template === t.id) || q.active.some((r) => r.offer.template === t.id)) return false;
  }
  return true;
}

// Whether the town can take on a template at all: buildings, roster size, an open zone.
export function meets(t, state, data = DATA) {
  if (!zoneOpen(state, t.zone, data)) return false;
  if (t.requires?.building && levelOf(state, t.requires.building) < t.requires.level) return false;
  if (t.requires?.heroes && state.heroes.length < t.requires.heroes) return false;
  if (state.heroes.length < QD(data).types[t.type].party[0]) return false;
  return true;
}

// The rating a quest of this level asks for per unit of difficulty. Heroes grow more slowly past the knee.
export function recommendedFor(level, data = DATA) {
  const r = QD(data).recommended;
  const knee = r.kneeLevel ?? Infinity;
  return r.base * r.growth ** (Math.min(level, knee) - 1) * (r.growthAfter ?? r.growth) ** Math.max(0, level - knee);
}

function makeOffer(state, n, t, zone, mod, level, duration, data) {
  const q = QD(data);
  const type = q.types[t.type];
  return {
    id: `q${n}`, n, template: t.id, type: t.type, zone: zone.id, level, modifier: mod.id,
    title: mod.name ? `${mod.name}: ${t.title}` : t.title, text: t.text, resource: t.resource ?? null,
    duration, rec: Math.round(recommendedFor(level, data) * type.difficulty * mod.rec * 10) / 10,
  };
}

export function rollOffer(state, n, data = DATA) {
  const q = QD(data);
  const rng = makeRng(seedFrom(state.seed, n, 303));
  const open = openZones(state, data);
  const focus = open.find((z) => z.id === state.quests.focus);
  const pool = focus ? [focus] : open;
  const zone = pool[Math.floor(rng() * pool.length)];
  // The very first offer is always a bounty, so a new board has something a lone hero can do for gold.
  const options = q.templates.filter((t) => t.zone === zone.id && eligible(t, state, data) && (n > 1 || t.type === 'bounty'));
  let pickT = rng() * options.reduce((a, t) => a + (t.weight ?? 1), 0);
  let t = options[0];
  for (const o of options) { pickT -= o.weight ?? 1; if (pickT <= 0) { t = o; break; } }
  const mods = q.modifiers.filter((m) => m.types.includes(t.type));
  let pick = rng() * mods.reduce((a, m) => a + m.weight, 0);
  let mod = mods[0];
  for (const m of mods) { pick -= m.weight; if (pick <= 0) { mod = m; break; } }
  const top = state.heroes.reduce((a, h) => Math.max(a, h.level), 1);
  const [lo, hi] = q.levelSpread;
  const spread = lo + Math.floor(rng() * (hi - lo + 1));
  const level = isDelve(t.type) ? t.level : clamp(top + spread, zone.levels[0], zone.levels[1]);
  const type = q.types[t.type];
  const span = type.duration[0] + rng() * (type.duration[1] - type.duration[0]);
  const duration = isDelve(t.type) ? t.duration : round5(span * mod.duration);
  return makeOffer(state, n, t, zone, mod, level, duration, data);
}

// A lore quest: fixed level and time, never changed by a modifier.
function storyOffer(state, n, t, data) {
  return makeOffer(state, n, t, data.zoneById[t.zone], data.modifierById.standard, t.level, t.duration, data);
}

// A fresh standard notice for a standing order that repeats a template. It never touches the board.
export function orderOffer(state, n, t, party, data) {
  const q = QD(data);
  const zone = data.zoneById[t.zone];
  const top = party.reduce((a, h) => Math.max(a, h.level), 1);
  const type = q.types[t.type];
  const level = isDelve(t.type) ? t.level : clamp(top, zone.levels[0], zone.levels[1]);
  const duration = isDelve(t.type) ? t.duration : round5((type.duration[0] + type.duration[1]) / 2);
  return makeOffer(state, n, t, zone, data.modifierById.standard, level, duration, data);
}

function addOffers(state, count, data) {
  let s = state;
  for (let i = 0; i < count && regularCount(s, data) < boardSize(s, data); i += 1) {
    const n = s.quests.counter + 1;
    s = { ...s, quests: { ...s.quests, counter: n, board: [...s.quests.board, rollOffer(s, n, data)] } };
  }
  return s;
}

// Pin the next lore quest of every open zone to the front of the board.
function ensureStory(state, data) {
  let s = state;
  // A notice for a step that is already told (an edited or imported save) is taken down.
  const stale = s.quests.board.filter((o) => { const st = data.templateById[o.template]?.story; return st && st.step <= zoneState(s, st.zone).story; });
  if (stale.length) s = { ...s, quests: { ...s.quests, board: s.quests.board.filter((o) => !stale.includes(o)) } };
  for (const z of openZones(s, data)) {
    const t = nextStory(s, z.id, data);
    if (!t) continue;
    if (s.quests.board.some((o) => o.template === t.id) || s.quests.active.some((r) => r.offer.template === t.id)) continue;
    const n = s.quests.counter + 1;
    s = { ...s, quests: { ...s.quests, counter: n, board: [storyOffer(s, n, t, data), ...s.quests.board] } };
  }
  // Each open zone's headline dungeon is always on the board until it has been cleared once.
  for (const z of openZones(s, data)) {
    const t = data.templateById[z.headline];
    if (!t || !isDelve(t.type) || zoneState(s, z.id).cleared.includes(t.id) || !meets(t, s, data)) continue;
    if (s.quests.board.some((o) => o.template === t.id) || s.quests.active.some((r) => r.offer.template === t.id)) continue;
    const n = s.quests.counter + 1;
    s = { ...s, quests: { ...s.quests, counter: n, board: [orderOffer(s, n, t, [], data), ...s.quests.board] } };
  }
  return s;
}

// ---- Loot ----

const rarityRank = (data, id) => data.gear.rarities.findIndex((r) => r.id === id);

// Items a finished quest drops, rolled from the save's seed. A full bag sells the overflow.
function dropLoot(state, run, firstClear, data) {
  const tplStory = data.templateById[run.offer.template]?.story;
  const cfg = QD(data).loot[run.offer.type] ?? { chance: 0, luck: 0 };
  const rng = makeRng(seedFrom(state.seed, run.offer.n, 505));
  const tier = data.zoneById[run.offer.zone].tier;
  const party = state.heroes.filter((h) => run.party.includes(h.id));
  const rolls = [];
  if (isDelve(run.offer.type)) {
    for (let i = 0; i < cfg.rolls; i += 1) rolls.push({});
    for (let i = 0; i < cfg.bossRolls; i += 1) rolls.push({ min: cfg.bossMinRarity });
    if (firstClear) rolls.push({ force: cfg.firstClearRarity });
  } else if (rng() < cfg.chance) rolls.push({});
  if (tplStory?.item) rolls.push({ story: tplStory.item });
  const luck = (cfg.luck ?? 0) + repLuck(state, run.offer.zone, data);
  let s = state;
  const names = [];
  let sold = 0;
  const slots = data.gear.slots.map((x) => x.id);
  for (const roll of rolls) {
    const owner = party[Math.floor(rng() * party.length)];
    const weights = owner ? data.classById[owner.class].weights : null;
    const slot = slots[Math.floor(rng() * slots.length)];
    if (roll.story) {
      const base = rollItem(rng, { slot: roll.story.slot, tier, rarityId: roll.story.rarity, weights }, data);
      const id = (s.counters?.item ?? 0) + 1;
      s = { ...s, counters: { ...s.counters, item: id } };
      const item = { ...base, name: roll.story.name, id: `i${id}` };
      if (s.items.length >= data.gear.inventoryCap) {
        const gold = itemValue(s, item, data);
        s = { ...s, res: { ...s.res, gold: s.res.gold + gold } };
        sold += gold;
      } else s = { ...s, items: [...s.items, item] };
      names.push(item.name);
      continue;
    }
    let item = rollItem(rng, { slot, tier, rarityId: roll.force ?? null, luck, weights }, data);
    if (roll.min && rarityRank(data, item.rarity) < rarityRank(data, roll.min)) {
      item = rollItem(rng, { slot, tier, rarityId: roll.min, weights }, data);
    }
    const id = (s.counters?.item ?? 0) + 1;
    item = { ...item, id: `i${id}` };
    s = { ...s, counters: { ...s.counters, item: id } };
    if (s.items.length >= data.gear.inventoryCap) {
      const gold = itemValue(s, item, data);
      s = { ...s, res: { ...s.res, gold: s.res.gold + gold } };
      sold += gold;
    } else s = { ...s, items: [...s.items, item] };
    names.push(item.name);
  }
  return { state: s, names, sold };
}

// ---- Fights ----

// Replay a party's fight with a full log, from the stats saved when it left. Same seed, same fight.
export function replayRun(state, run, data = DATA) {
  if (!run.units?.length) return null;
  return runFight(run.units, encountersFor(run.offer, data), run.offer.level, fightSeed(state, run.offer), data, { record: true });
}

// ---- Finishing a quest ----

function finishRun(state, run, data) {
  const q = state.quests;
  const names = run.party.map((id) => state.heroes.find((h) => h.id === id)?.name).filter(Boolean);
  const st = state.stats;
  const cfgLog = QD(data).history;
  const keepLog = data.combat.log;
  let s = state;
  const entry = { n: q.seq + 1, title: run.offer.title, type: run.offer.type, ok: run.success, party: names, gold: 0, xp: 0, res: {}, loot: [], sold: 0, firstClear: false, stolen: 0, rep: 0, story: false, opened: [], log: [] };
  const fight = replayRun(state, run, data);
  let line;

  if (run.success) {
    const tpl = data.templateById[run.offer.template];
    const zone = zoneState(s, run.offer.zone);
    const openBefore = new Set(openZones(s, data).map((z) => z.id));
    const firstClear = isDelve(run.offer.type) && !zone.cleared.includes(tpl.id);
    const stolen = run.stolen ?? 0;
    const gold = Math.round(run.reward.gold * (1 - stolen) * (firstClear ? QD(data).loot.dungeon.firstClearGoldMult : 1));
    let res = { ...s.res, gold: s.res.gold + gold };
    for (const [id, amt] of Object.entries(run.reward.res)) res[id] = Math.min(storageCap(s, id, data), (res[id] ?? 0) + amt);
    let xpTotal = 0;
    const heroes = s.heroes.map((h) => {
      if (!run.party.includes(h.id)) return h;
      const xp = heroXpFor(s, h, run.offer, data);
      xpTotal += xp;
      return addXp(h, xp, data, heroCap(s, data));
    });
    s = {
      ...s, res, heroes,
      stats: { ...st, lifetimeGold: st.lifetimeGold + gold, questsDone: (st.questsDone ?? 0) + 1, recentWins: Math.min(QD(data).winsFull, (st.recentWins ?? 0) + 1) },
    };
    const rc = data.zonesData.reputation;
    const gain = Math.round(((rc.gain[run.offer.type] ?? 0) + (tpl.story?.rep ?? 0) + (firstClear ? rc.firstClear : 0)) * (1 + bonusOf(s, 'repGain', data)));
    const tierBefore = tierIndex(zone.rep ?? 0, data);
    const next = {
      ...zone,
      rep: (zone.rep ?? 0) + gain,
      cleared: firstClear ? [...zone.cleared, tpl.id] : zone.cleared,
      trophies: (zone.trophies ?? 0) + (isDelve(run.offer.type) ? 1 : 0),
      story: tpl.story && tpl.story.step === (zone.story ?? 0) + 1 ? tpl.story.step : zone.story ?? 0,
    };
    s = { ...s, zones: { ...s.zones, [run.offer.zone]: next } };
    // A raid's first clear in a run pays Legacy; a headline boss also opens the way to the next Era.
    const points = firstClear ? data.legacy.raidPoints[tpl.id] ?? 0 : 0;
    const era = firstClear && tpl.eraBoss ? `era${tpl.eraBoss}` : null;
    if (points || era) {
      const p = s.prestige;
      s = { ...s, prestige: {
        ...p,
        legacy: (p.legacy ?? 0) + points,
        legacyTotal: (p.legacyTotal ?? 0) + points,
        legacyEra: (p.legacyEra ?? 0) + points,
        bosses: era && !(p.bosses ?? []).includes(era) ? [...(p.bosses ?? []), era] : p.bosses ?? [],
      } };
    }
    const opened = openZones(s, data).filter((z) => !openBefore.has(z.id));
    const tierAfter = tierIndex(next.rep, data);
    const loot = dropLoot(s, run, firstClear, data);
    s = loot.state;
    Object.assign(entry, { gold, xp: Math.round(xpTotal), res: run.reward.res, loot: loot.names, sold: loot.sold, firstClear, legacy: points, stolen, rep: gain, story: !!tpl.story, opened: opened.map((z) => z.name) });
    for (const z of opened) s = { ...s, log: [{ t: s.savedAt, text: `${z.name} is open to the outpost's parties.` }, ...s.log] };
    if (tierAfter > tierBefore) {
      const zn = data.zoneById[run.offer.zone];
      s = { ...s, log: [{ t: s.savedAt, text: `Standing in ${zn.name} is now ${repTiers(data)[tierAfter].name}: ${zn.titles[tierAfter]}.` }, ...s.log] };
      entry.tierUp = repTiers(data)[tierAfter].name;
    }
    const bits = [];
    if (gold) bits.push(`${gold} gold`);
    for (const [id, amt] of Object.entries(run.reward.res)) bits.push(`${amt} ${data.resourceById[id].name.toLowerCase()}`);
    bits.push(`${entry.xp} experience`);
    if (loot.names.length) bits.push(`${loot.names.length} ${loot.names.length === 1 ? 'item' : 'items'}`);
    line = `${names.join(' and ')} finished "${run.offer.title}": ${bits.join(', ')}.${tpl.story ? ' The story moves on.' : ''}${points ? ` ${points} Legacy earned.` : ''}`;
  } else {
    const rest = data.heroes.injury.restSeconds;
    const heroes = s.heroes.map((h) => (run.party.includes(h.id) ? { ...h, injury: rest } : h));
    const where = isDelve(run.offer.type) && run.wipedAt != null ? ` at ${encountersFor(run.offer, data)[run.wipedAt]?.name ?? 'the depths'}` : '';
    line = `${names.join(' and ')} failed "${run.offer.title}"${where} and came home hurt.`;
    s = { ...s, heroes, stats: { ...st, questsFailed: (st.questsFailed ?? 0) + 1, recentWins: Math.max(0, (st.recentWins ?? 0) - 1) } };
    entry.where = where.trim();
  }
  // Only the newest few results keep their combat log; older ones are dropped to keep saves small.
  if (fight?.keyLog) entry.log = fight.keyLog.slice(0, keepLog.keepLines);
  if (run.order) s = { ...s, quests: { ...s.quests, orders: s.quests.orders.map((o) => (o.id === run.order ? { ...o, runs: o.runs + 1 } : o)) } };
  const hist = [entry, ...q.history].map((e, i) => (i >= keepLog.keepEntries ? { ...e, log: [] } : e)).slice(0, cfgLog);
  s = {
    ...s,
    quests: { ...s.quests, seq: q.seq + 1, history: hist },
    log: [{ t: s.savedAt, text: line }, ...s.log].slice(0, data.economy.logLimit),
  };
  return run.success ? autoEquip(s, data) : s;
}

// ---- Standing orders ----

const setOrder = (state, id, patch) => ({
  ...state, quests: { ...state.quests, orders: state.quests.orders.map((o) => (o.id === id ? { ...o, ...patch } : o)) },
});

// Send idle, healthy parties out again. Each order either repeats one template or takes the best notice on the board.
function runOrders(state, data, credits) {
  let s = state;
  const cfg = QD(data).orders;
  for (const o of state.quests.orders) {
    const cur = s.quests.orders.find((x) => x.id === o.id);
    if (!cur || cur.paused || cur.wait > 0) continue;
    const heroes = cur.party.map((id) => s.heroes.find((h) => h.id === id));
    if (heroes.some((x) => !x)) { if (cur.note !== 'gone') s = setOrder(s, cur.id, { note: 'gone' }); continue; }
    if (heroes.some((x) => x.injury > 0 || isBusy(s, x.id))) continue;
    const potion = cur.potion && potionStock(s, cur.potion) >= heroes.length ? cur.potion : null;
    const retry = (note) => setOrder(s, cur.id, { wait: cfg.retrySeconds, note });
    let offer = null;
    let fromBoard = false;
    if (cur.mode === 'repeat') {
      const t = data.templateById[cur.template];
      const size = t && QD(data).types[t.type].party;
      if (!t || !meets(t, s, data)) { if (cur.note !== 'closed') s = retry('closed'); continue; }
      if (heroes.length < size[0] || heroes.length > size[1]) { if (cur.note !== 'size') s = retry('size'); continue; }
      const n = s.quests.counter + 1;
      offer = orderOffer(s, n, t, heroes, data);
      const p = winOdds(s, offer, heroes, data, potion);
      if (p < cur.minOdds) { s = retry(`odds:${Math.round(p * 100)}`); continue; }
      s = { ...s, quests: { ...s.quests, counter: n } };
    } else {
      const options = s.quests.board
        .filter((b) => !isStory(b, data) && heroes.length >= QD(data).types[b.type].party[0] && heroes.length <= QD(data).types[b.type].party[1] && meets(data.templateById[b.template], s, data))
        .sort((a, b) => b.rec - a.rec);
      let seen = 0;
      for (const b of options) {
        const p = winOdds(s, b, heroes, data, potion);
        if (p >= cur.minOdds) { offer = b; fromBoard = true; break; }
        seen = Math.max(seen, p);
      }
      if (!offer) { s = retry(options.length ? `odds:${Math.round(seen * 100)}` : 'none'); continue; }
    }
    const r = launch(s, offer, cur.party, data, { potion, order: cur.id, credit: credits[cur.id] ?? 0 });
    if (!r.ok) { s = retry(`error:${r.error}`); continue; }
    s = r.state;
    if (fromBoard) s = { ...s, quests: { ...s.quests, board: s.quests.board.filter((b) => b.id !== offer.id) } };
    s = setOrder(s, cur.id, { note: '' });
  }
  return s;
}

// Advance timers and the board by dt seconds.
export function stepQuests(state, dt, data = DATA) {
  let s = state;
  const q = QD(data);
  const refresh = q.board.refreshSeconds * (1 - bonusOf(s, 'boardRefresh', data));
  const credits = {};
  if (s.quests.active.length) {
    const speed = questSpeedMultiplier(s, data);
    const still = [];
    const done = [];
    for (const run of s.quests.active) {
      const left = run.remaining - dt * speed;
      if (left <= 1e-9) done.push({ run, over: -left / speed }); else still.push({ ...run, remaining: left });
    }
    s = { ...s, quests: { ...s.quests, active: still } };
    done.sort((a, b) => b.over - a.over);
    for (const d of done) {
      s = finishRun(s, d.run, data);
      if (d.run.order) credits[d.run.order] = d.over * speed;
    }
  }
  if (s.heroes.length === 0) return s;

  if (s.quests.orders.some((o) => o.wait > 0)) {
    s = { ...s, quests: { ...s.quests, orders: s.quests.orders.map((o) => (o.wait > 0 ? { ...o, wait: Math.max(0, o.wait - dt) } : o)) } };
  }

  if (s.quests.counter === 0 && regularCount(s, data) === 0) {
    s = addOffers(s, q.board.startOffers, data);
    s = { ...s, quests: { ...s.quests, refreshIn: refresh } };
  } else if (regularCount(s, data) < boardSize(s, data)) {
    let refreshIn = s.quests.refreshIn - dt;
    if (refreshIn <= 0) {
      const count = 1 + Math.floor(-refreshIn / refresh);
      refreshIn += count * refresh;
      s = addOffers(s, count, data);
    }
    s = { ...s, quests: { ...s.quests, refreshIn } };
  } else if (s.quests.refreshIn !== refresh) {
    s = { ...s, quests: { ...s.quests, refreshIn: refresh } };
  }
  s = ensureStory(s, data);
  if (s.quests.orders.length) s = runOrders(s, data, credits);
  return s;
}

// ---- Player commands ----

// Put a party on the road for an offer. The offer may be on the board or made up for a standing order.
export function launch(state, offer, partyIds, data = DATA, { potion = null, order = null, credit = 0 } = {}) {
  const type = QD(data).types[offer.type];
  const ids = [...new Set(partyIds)];
  if (ids.length < type.party[0] || ids.length > type.party[1]) {
    const noun = type.name.toLowerCase();
    return { ok: false, error: type.party[0] === type.party[1] ? `A ${noun} takes exactly ${type.party[0]} hero${type.party[0] > 1 ? 'es' : ''}.` : `A ${noun} takes ${type.party[0]} to ${type.party[1]} heroes.` };
  }
  for (const id of ids) {
    const hero = state.heroes.find((h) => h.id === id);
    if (!hero) return { ok: false, error: 'That hero is not in the roster.' };
    if (hero.injury > 0) return { ok: false, error: `${hero.name} is still recovering.` };
    if (isBusy(state, id)) return { ok: false, error: `${hero.name} is already out on a quest.` };
  }
  if (potion) {
    const p = data.potionById[potion];
    if (!p) return { ok: false, error: 'No such potion.' };
    if (potionStock(state, potion) < ids.length) return { ok: false, error: `The party needs ${ids.length} ${p.name}${ids.length > 1 ? 's' : ''}; the Lab has ${potionStock(state, potion)}.` };
  }
  const heroes = ids.map((id) => state.heroes.find((h) => h.id === id));
  const units = heroes.map((h) => heroUnit(state, h, data, potion));
  const fight = runFight(units, encountersFor(offer, data), offer.level, fightSeed(state, offer), data);
  const chance = winOdds(state, offer, heroes, data, potion);
  const total = runSeconds(state, offer, data);
  const run = {
    id: offer.id, offer, party: ids, remaining: Math.max(1, total - credit), total, chance, success: fight.won, units,
    stolen: fight.stolen, wipedAt: fight.wipedAt, reward: rewardFor(state, offer, ids.length, data), potion: potion ?? null, order: order ?? null,
  };
  const alchemy = potion ? { ...state.alchemy, stock: { ...state.alchemy.stock, [potion]: potionStock(state, potion) - ids.length } } : state.alchemy;
  return { ok: true, run, state: { ...state, alchemy, quests: { ...state.quests, active: [...state.quests.active, run] } } };
}

export function startRun(state, offerId, partyIds, data = DATA, opts = {}) {
  const offer = state.quests.board.find((o) => o.id === offerId);
  if (!offer) return { ok: false, error: 'That quest is no longer on the board.' };
  const r = launch(state, offer, partyIds, data, opts);
  if (!r.ok) return r;
  return { ...r, state: { ...r.state, quests: { ...r.state.quests, board: r.state.quests.board.filter((o) => o.id !== offerId) } } };
}

export function recallRun(state, offerId) {
  const run = state.quests.active.find((r) => r.id === offerId);
  if (!run) return { ok: false, error: 'That party is not out on a quest.' };
  return { ok: true, state: { ...state, quests: { ...state.quests, active: state.quests.active.filter((r) => r.id !== offerId) } } };
}

export function discardOffer(state, offerId, data = DATA) {
  const offer = state.quests.board.find((o) => o.id === offerId);
  if (!offer) return { ok: false, error: 'That quest is no longer on the board.' };
  if (isPinned(offer, state, data)) return { ok: false, error: 'This notice stays up until it is done.' };
  return { ok: true, state: { ...state, quests: { ...state.quests, board: state.quests.board.filter((o) => o.id !== offerId) } } };
}

// Choose which zone new notices come from, or null for every open zone.
export function setFocus(state, zoneId, data = DATA) {
  if (zoneId !== null && !zoneOpen(state, zoneId, data)) return { ok: false, error: 'That zone is not open yet.' };
  return { ok: true, state: { ...state, quests: { ...state.quests, focus: zoneId } } };
}
