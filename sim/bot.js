// The full-game bot: a headless player that drives the real engine from a new game through
// recruiting, forging, questing, clearing zones, Town Hall upgrades and Rebuilds.
// It is the check on the whole design: "does the game hit the pacing targets?" Run `npm run play`.
//
// The bot is deliberately ordinary. It acts at a steady cadence (every few seconds early, every
// half minute later), buys what a sensible player would and sends idle heroes on the best quest
// they are likely to win. Every number it uses lives in POLICY so a run can be repeated.
import { DATA, isLive, isWorkplace, liveBuildings, isDelve } from '../src/engine/data.js';
import { newState } from '../src/engine/state.js';
import { step } from '../src/engine/tick.js';
import {
  buyBuilding, buyTownHall, assignWorker, recruitHero, choosePerk, answerEvent, issueCommand, collectTribute, craftItem, craftCost, sellItem, chooseTalent, refreshPool, dispatchQuest, brewPotion,
} from '../src/engine/actions.js';
import {
  costOf, canAfford, levelOf, levelCap, isUnlocked, freeResidents, workersAt, workerCap, ecoFor, flows,
} from '../src/engine/derive.js';
import { itemValue } from '../src/engine/heroes.js';
import { rosterCap, recruitCost, refreshCost, pendingTalents, sheetOf } from '../src/engine/heroes.js';
import { heroRating, isBusy, isStory, oddsFor, rewardFor, heroXpFor, runSeconds, meets, orderOffer, isPinned } from '../src/engine/quests.js';
import { orderSlots, repeatable, createOrder, removeOrder, pauseOrder } from '../src/engine/orders.js';
import { recallQuest } from '../src/engine/actions.js';
import { rebuild, buyUpgrade } from '../src/engine/rebuild.js';
import { rebuildPreview, renownTotal, upgradeCost } from '../src/engine/renown.js';
import { zoneState } from '../src/engine/zones.js';
import { potionStock } from '../src/engine/alchemy.js';
import { nextPurchase } from './pacing.js';
import { advance } from '../src/engine/offline.js';
import { perkRows } from '../src/engine/engage.js';
import { choiceTerms, eventOf, commandWait } from '../src/engine/events.js';

export const POLICY = {
  // Seconds between decisions, by seconds since the run began.
  cadence: [[1800, 5], [7200, 15], [Infinity, 30]],
  // Fewest odds of winning at which a party is sent.
  minOdds: 0.75,
  dungeonOdds: 0.7,
  lateOdds: 0.85,
  // Gold a purchase of support (heroes, forge, helpful buildings) may use, as a share of gold on hand.
  spendShare: 0.5,
  // How many heroes the player wants by Town Hall level.
  roster: { 2: 2, 3: 3, 4: 4, 5: 5, 6: 5, 7: 5, 8: 6, 9: 6, 10: 7, 11: 7, 12: 8, 13: 8, 14: 9, 15: 10 },
  // Renown shop purchases, most wanted first.
  shop: ['purse', 'ledgers', 'foundations', 'headstart', 'hands', 'masons', 'charter', 'bounties', 'lessons', 'roads', 'cottages',
    'scouts', 'notices', 'standing', 'larders', 'reputation', 'forgelore', 'cellars', 'bedrest', 'bunks'],
  rebuild: true,
  // Hands-on play, off for the pacing baselines. With `engage` the bot picks perks, answers events and
  // uses hero commands; `tapsPerSec` is how fast it taps tribute while present.
  engage: false,
  tapsPerSec: 0,
  // null: always present. Otherwise the bot plays `sessionSeconds` out of every `everySeconds` and is
  // away the rest of the time, which the engine credits by its offline rules.
  presence: null,
  // Convert experience into gold when ranking quests.
  xpGold: 3,
};

const WORKER_ORDER = ['market', 'lumber_camp', 'quarry', 'farm', 'mine', 'blacksmith', 'alchemy_lab', 'mage_tower'];
const WANTED_ROLES = ['warrior', 'priest', 'rogue', 'mage', 'hunter', 'paladin'];

const pick = (list, f) => { let best = null; let bv = -Infinity; for (const x of list) { const v = f(x); if (v > bv) { bv = v; best = x; } } return best; };

export function playGame({ maxHours = 24, data = DATA, seed = 1, policy = POLICY, stopWhen = null, trace = false } = {}) {
  let s = newState({ seed, now: 0, data });
  let t = 0;
  const limit = maxHours * 3600;
  const marks = {};
  const runMarks = [{}];
  const timeline = [];
  const stats = { odds: 0, dispatched: 0, failed: 0, crafts: 0, recruits: 0, rebuilds: 0 };
  let runStart = 0;
  let lastLine = -1;

  const mark = (name) => {
    if (!(name in marks)) marks[name] = Math.round(t);
    const rm = runMarks.at(-1);
    if (!(name in rm)) rm[name] = Math.round(t - runStart);
  };
  const lv = (id) => levelOf(s, id);
  const apply = (r) => { if (r?.ok) { s = r.state; return true; } return false; };
  const gold = () => s.res.gold;

  // ---- Workers ----
  function assignWorkers() {
    let did = false;
    // Fill the full-value slots of every building first, then the smaller extra slots.
    for (const pass of [0, 1]) for (const id of WORKER_ORDER) {
      const limit = pass === 0 ? data.economy.workers.maxPerBuilding : workerCap(s, id, data);
      while (freeResidents(s) > 0 && lv(id) > 0 && workersAt(s, id) < limit) {
        if (!apply(assignWorker(s, id, 1, data))) break;
        did = true;
      }
    }
    return did;
  }

  // ---- Money the support spending may use: what is left once the pending purchase is paid ----
  // Things that unlock whole systems (the Tavern, the first heroes, the first forge) are bought at once.
  function surplusGold(pending, priority = false) {
    if (priority) return gold() * 0.9;
    const keep = pending && !canAfford(s.res, pending.cost) ? (pending.cost.gold ?? 0) : 0;
    return Math.max(0, gold() - keep) * policy.spendShare;
  }

  // Set when a system-unlocking purchase is wanted but cannot be paid yet: the town stops spending on growth to save for it.
  let saving = false;

  // ---- Support buildings: the ones heroes need ----
  function supportTargets() {
    const th = s.town.townHall;
    const want = policy.roster[th] ?? 10;
    const heroLevel = Math.max(0, ...s.heroes.map((h) => h.level));
    const tier = [...data.gear.tiers].reverse().find((x) => x.reqLevel <= heroLevel + 3) ?? data.gear.tiers[0];
    const t = {};
    t.tavern = th >= 2 ? Math.max(th >= 3 ? 3 : 1, 3 * Math.max(0, want - data.heroes.roster.base)) : 0;
    t.barracks = th >= 3 ? Math.min(th >= 8 ? 10 : th >= 5 ? 7 : 4, 12) : 0;
    t.blacksmith = th >= 6 && s.heroes.length ? Math.min(tier.smithLevel, levelCap(s, data)) : 0;
    t.chapel = th >= 3 ? Math.min(1 + Math.max(0, th - 4) * 2, 12) : 0;
    t.stables = th >= 10 ? Math.min(3 + (th - 10) * 2, 15) : 0;
    t.alchemy_lab = th >= 9 ? Math.min(4 + (th - 9) * 2, 14) : 0;
    t.wall_watchtower = th >= 11 ? Math.min(15 + (th - 11) * 8, 45) : 0;
    return t;
  }

  function buySupport(pending) {
    let did = false;
    const targets = supportTargets();
    for (const [id, target] of Object.entries(targets)) {
      const def = data.buildingById[id];
      if (!def || !isLive(def) || !isUnlocked(def, s)) continue;
      while (lv(id) < target && lv(id) < levelCap(s, data)) {
        const cost = costOf(def, lv(id), 1, ecoFor(s, data, id));
        const unlocksClass = (id === 'tavern' && lv(id) < 3) || (id === 'barracks' && lv(id) < 3) || (id === 'chapel' && lv(id) < 1);
        const first = lv(id) === 0 || unlocksClass || (id === 'tavern' && s.heroes.length >= rosterCap(s, data) && s.heroes.length < (policy.roster[s.town.townHall] ?? 10));
        const room = surplusGold(pending, first);
        if (!canAfford(s.res, cost) || (cost.gold ?? 0) > room) { if (first && (cost.gold ?? 0) <= gold() * 4) saving = false; break; }
        if (!apply(buyBuilding(s, id, 1, data))) break;
        mark(`${id}_${lv(id)}`);
        did = true;
      }
    }
    return did;
  }

  // ---- Heroes ----
  let lastRefresh = -1e9;
  function recruit(pending) {
    if (lv('tavern') < 1 || !s.tavern.pool) return false;
    if (s.heroes.length >= rosterCap(s, data) || s.heroes.length >= (policy.roster[s.town.townHall] ?? 10)) return false;
    const have = {};
    for (const h of s.heroes) have[h.class] = (have[h.class] ?? 0) + 1;
    const open = s.tavern.pool.filter((c) => !c.hired && data.classById[c.class] && (!data.classById[c.class].unlock || lv(data.classById[c.class].unlock.building) >= data.classById[c.class].unlock.level));
    const need = (c) => {
      const order = WANTED_ROLES.indexOf(c.class);
      const copies = have[c.class] ?? 0;
      const want = copies === 0 ? 3 : copies === 1 ? 1 : 0;
      const roleBonus = (c.class === 'warrior' && !have.warrior) ? 4 : (c.class === 'priest' && !have.priest) ? 3.5 : (c.class === 'paladin' && !have.priest && !have.paladin) ? 3 : 0;
      return want + roleBonus + c.level * 0.05 - order * 0.1;
    };
    const wantRole = (c) => {
      const healer = have.priest || have.paladin;
      const tank = have.warrior || have.paladin;
      const dps = (have.rogue ?? 0) + (have.mage ?? 0) + (have.hunter ?? 0);
      if (!tank) return c.class === 'warrior' || c.class === 'paladin';
      if (!healer && isUnlocked(data.buildingById.chapel, s)) return lv('chapel') > 0 && (c.class === 'priest' || c.class === 'paladin');
      if (dps < 2) return ['rogue', 'mage', 'hunter'].includes(c.class);
      return true;
    };
    const wanted = open.filter(wantRole);
    if (!wanted.length) {
      // Nobody useful in the pool: ask around, if it is cheap.
      if (t - lastRefresh >= 600 && gold() > refreshCost(s, data) * 4 && s.heroes.length < 6 && apply(refreshPool(s, data))) lastRefresh = t;
      return false;
    }
    const cand = pick(wanted, need);
    if (!cand) return false;
    const cost = recruitCost(s, cand, data);
    if (cost > surplusGold(pending, true)) { if (cost <= gold() * 4) saving = false; return false; }
    if (!apply(recruitHero(s, cand.id, data))) return false;
    stats.recruits += 1;
    mark(`hero_${s.heroes.length}_${s.heroes.at(-1).class}`);
    return true;
  }

  function talents() {
    let did = false;
    for (const h of s.heroes) {
      if (pendingTalents(h, data) < 1) continue;
      const cls = data.classById[h.class];
      const perk = cls.perks.find((p) => !h.talents.includes(p.id));
      if (perk && apply(chooseTalent(s, h.id, perk.id, data))) did = true;
    }
    return did;
  }

  // The bag fills with drops no hero wants. Sell the weakest down to a working size.
  function tidyBag() {
    if (s.items.length < data.gear.inventoryCap - 12) return false;
    const worst = [...s.items].sort((a, b) => itemValue(s, a, data) - itemValue(s, b, data));
    let did = false;
    for (const it of worst.slice(0, 20)) if (apply(sellItem(s, it.id, data))) did = true;
    return did;
  }

  function forge(pending) {
    if (lv('blacksmith') < 1 || !s.heroes.length || s.items.length >= data.gear.inventoryCap - 2) return false;
    const smith = lv('blacksmith');
    const slots = data.gear.slots.map((x) => x.id);
    let best = null;
    for (const h of s.heroes) {
      const tiers = data.gear.tiers.filter((x) => x.smithLevel <= smith && x.reqLevel <= h.level);
      const top = tiers.at(-1);
      if (!top) continue;
      for (const slot of slots) {
        const worn = h.gear[slot];
        const wornTier = worn ? worn.tier : 0;
        if (wornTier >= top.tier) continue;
        const cost = craftCost(s, slot, top.tier, data);
        const score = (top.tier - wornTier) * 10 + h.level * 0.01 - (cost.gold ?? 0) * 1e-9;
        if (!best || score > best.score) best = { slot, tier: top.tier, cost, score };
      }
    }
    if (!best) return false;
    if (!canAfford(s.res, best.cost) || (best.cost.gold ?? 0) > surplusGold(pending)) return false;
    if (!apply(craftItem(s, best.slot, best.tier, data))) return false;
    stats.crafts += 1;
    return true;
  }

  // ---- Quests ----
  const rating = (h) => heroRating(s, h, data);
  const roleOf = (h) => data.classById[h.class].role;
  const isTank = (h) => h.class === 'warrior' || h.class === 'paladin';
  const isHealer = (h) => h.class === 'priest' || h.class === 'paladin';

  function partyFor(offer, idle, size) {
    const sorted = [...idle].sort((a, b) => rating(b) - rating(a));
    if (isDelve(offer.type) || size >= 3) {
      const party = [];
      // A raid is two parties: two tanks and two healers where the roster has them.
      const lines = size >= 6 ? 2 : 1;
      for (let k = 0; k < lines; k += 1) {
        const tank = sorted.find((h) => isTank(h) && !party.includes(h));
        if (tank) party.push(tank);
        const healer = sorted.find((h) => isHealer(h) && !party.includes(h));
        if (healer) party.push(healer);
      }
      for (const h of sorted) if (party.length < size && !party.includes(h)) party.push(h);
      return party.slice(0, size);
    }
    return sorted.slice(0, size);
  }

  function candidates(idle) {
    const q = data.quests;
    const out = [];
    for (const o of s.quests.board) {
      const type = q.types[o.type];
      const tpl = data.templateById[o.template];
      if (!tpl || !meets(tpl, s, data)) continue;
      const lo = type.party[0];
      const hi = Math.min(type.party[1], idle.length);
      if (hi < lo) continue;
      out.push({ o, type, lo, hi });
    }
    return out;
  }

  const unpauseAll = () => { for (const o of s.quests.orders) if (o.paused) apply(pauseOrder(s, o.id, false)); };

  function dispatch() {
    const healthy = s.heroes.filter((h) => h.injury <= 0);
    const idle = healthy.filter((h) => !isBusy(s, h.id));
    if (!healthy.length) return false;

    // Dungeons and story notices come first. If the party for one is out on a standing order, hold the order.
    const prime = candidates(healthy).filter((c) => (c.o.type === 'dungeon' || c.o.type === 'raid') || isStory(c.o, data));
    for (const c of prime.sort((a, b) => (isDelve(b.o.type) ? 1 : 0) - (isDelve(a.o.type) ? 1 : 0))) {
      const size = Math.min(c.type.party[1], healthy.length);
      for (let n = size; n >= c.lo; n -= 1) {
        const party = partyFor(c.o, healthy, n);
        if (party.length < c.lo) continue;
        stats.odds += 1;
        if (oddsFor(s, c.o, party.map((h) => h.id), data) < (c.o.level >= 30 ? policy.lateOdds : policy.dungeonOdds)) continue;
        if (party.every((h) => !isBusy(s, h.id))) {
          let potion = null;
          if (isDelve(c.o.type)) potion = ['might', 'ward', 'vigour'].find((id) => potionStock(s, id) >= party.length) ?? null;
          if (apply(dispatchQuest(s, c.o.id, party.map((h) => h.id), data, potion))) { stats.dispatched += 1; mark(`sent_${c.o.template}`); unpauseAll(); return true; }
        } else {
          let did = false;
          for (const o of s.quests.orders) if (!o.paused && o.party.some((id) => party.some((h) => h.id === id)) && apply(pauseOrder(s, o.id, true))) did = true;
          // Heroes still out on a standing-order run are called home: the dungeon is worth more than the run.
          if (isDelve(c.o.type) && !isStory(c.o, data)) {
            for (const r of s.quests.active) if (r.order && r.party.some((id) => party.some((h) => h.id === id)) && apply(recallQuest(s, r.id, data))) did = true;
          }
          return did;
        }
      }
    }

    if (!idle.length) return false;
    const list = candidates(idle).filter((c) => !isDelve(c.o.type) && !isStory(c.o, data)).map((c) => {
      const size = c.type.party[0] === c.type.party[1] ? c.lo : Math.min(c.hi, Math.max(c.lo, c.o.type === 'slay' ? 2 : c.lo));
      const trial = partyFor(c.o, idle, size).slice(0, size);
      const g = rewardFor(s, c.o, size, data);
      const xp = trial.reduce((a, h) => a + heroXpFor(s, h, c.o, data), 0);
      const value = (g.gold + policy.xpGold * xp * 10 + (g.res ? Object.values(g.res).reduce((a, b) => a + b, 0) * 5 : 0)) / (runSeconds(s, c.o, data) * size);
      return { ...c, size, score: value };
    }).sort((a, b) => b.score - a.score);
    for (const c of list) {
      for (let size = c.size; size <= c.hi && size <= c.type.party[1]; size += 1) {
        const party = partyFor(c.o, idle, size);
        if (party.length < c.lo) continue;
        stats.odds += 1;
        if (oddsFor(s, c.o, party.map((h) => h.id), data) < policy.minOdds) continue;
        if (apply(dispatchQuest(s, c.o.id, party.map((h) => h.id), data, null))) { stats.dispatched += 1; return true; }
      }
    }
    return false;
  }

  // Standing orders: heroes without work repeat the best quest they can win alone.
  let ordersCheckedAt = -1e9;
  function manageOrders() {
    const slots = orderSlots(s, data);
    if (!slots) return false;
    let did = false;
    const refresh = t - ordersCheckedAt >= 1200;
    if (refresh) {
      ordersCheckedAt = t;
      for (const o of [...s.quests.orders]) if (!o.paused && apply(removeOrder(s, o.id))) did = true;
    }
    const used = new Set(s.quests.orders.flatMap((o) => o.party));
    const free = [...s.heroes].filter((h) => !used.has(h.id)).sort((a, b) => rating(b) - rating(a));
    for (const h of free) {
      if (s.quests.orders.length >= slots) break;
      // While a first-clear dungeon waits, keep solo orders short so the party is home when it is ready.
      const waiting = s.quests.board.some((o) => isDelve(o.type) && isPinned(o, s, data));
      const options = repeatable(s, data).filter((tpl) => data.quests.types[tpl.type].party[0] === 1 && !isDelve(tpl.type))
        .filter((tpl) => !waiting || runSeconds(s, orderOffer(s, s.quests.counter + 1, tpl, [h], data), data) <= 420);
      let best = null;
      for (const tpl of options) {
        const offer = orderOffer(s, s.quests.counter + 1, tpl, [h], data);
        const g = rewardFor(s, offer, 1, data);
        const xp = heroXpFor(s, h, offer, data);
        const value = (g.gold + policy.xpGold * xp * 10 + (g.res ? Object.values(g.res).reduce((a, b) => a + b, 0) * 5 : 0)) / runSeconds(s, offer, data);
        if (!best || value > best.value) best = { tpl, offer, value };
      }
      if (!best) continue;
      const sorted = options.map((tpl) => {
        const offer = orderOffer(s, s.quests.counter + 1, tpl, [h], data);
        const g = rewardFor(s, offer, 1, data);
        const xp = heroXpFor(s, h, offer, data);
        return { tpl, value: (g.gold + policy.xpGold * xp * 10 + (g.res ? Object.values(g.res).reduce((a, b) => a + b, 0) * 5 : 0)) / runSeconds(s, offer, data), offer };
      }).sort((a, b) => b.value - a.value);
      for (const c of sorted) {
        stats.odds += 1;
        if (oddsFor(s, c.offer, [h.id], data) >= 0.9 && apply(createOrder(s, { mode: 'repeat', template: c.tpl.id, party: [h.id], minOdds: 0.9 }, data))) { did = true; break; }
      }
    }
    return did;
  }

  function brew() {
    if (lv('alchemy_lab') < 1) return false;
    for (const id of ['might', 'ward', 'vigour']) {
      if (potionStock(s, id) + s.alchemy.queue.filter((q) => q.id === id).length >= 5) continue;
      if (data.potionById[id].lab > lv('alchemy_lab')) continue;
      const cost = data.potionById[id].cost;
      if (!canAfford(s.res, cost) || (cost.gold ?? 0) > gold() * 0.1) continue;
      if (apply(brewPotion(s, id, data))) return true;
    }
    return false;
  }

  // ---- Prestige ----
  function prestige() {
    let did = false;
    const p = rebuildPreview(s, data);
    if (policy.rebuild && p.can && p.advised) {
      const r = rebuild(s, data);
      if (r.ok) {
        s = r.state;
        stats.rebuilds += 1;
        mark(`rebuild_${stats.rebuilds}`);
        runStart = t;
        runMarks.push({});
        did = true;
      }
    }
    for (let guard = 0; guard < 60; guard += 1) {
      let bought = false;
      for (const id of policy.shop) {
        const up = data.renownById[id];
        const c = upgradeCost(s, up);
        if (c !== null && c <= s.prestige.renown && apply(buyUpgrade(s, id, data))) { bought = true; did = true; break; }
      }
      if (!bought) break;
    }
    return did;
  }

  // ---- Hands-on play: perks, events, hero commands ----
  function engageActions() {
    let did = false;
    for (const id of Object.keys(data.engage.perks.byBuilding)) {
      for (const row of perkRows(id, data)) {
        if (lv(id) >= row.at && !s.town.perks?.[id]?.[row.at] && apply(choosePerk(s, id, row.at, row.at === data.engage.perks.tiers[1] ? 'b' : 'a', data))) did = true;
      }
    }
    const def = eventOf(s, data);
    if (def) {
      let best = def.choices.findIndex((c) => !c.cost);
      def.choices.forEach((c, i) => {
        const t = choiceTerms(s, c, data);
        if ((c.buff || c.gain || c.residents) && (!t.cost || t.cost.amount <= 0.25 * (s.res[t.cost.res] ?? 0))) best = i;
      });
      if (best >= 0 && apply(answerEvent(s, best, data))) did = true;
    }
    for (const run of s.quests.active) for (const id of run.party) if (commandWait(s, id) <= 0 && apply(issueCommand(s, run.id, id, data))) did = true;
    return did;
  }

  // ---- One round of decisions ----
  function act() {
    let did = false;
    if (policy.engage && engageActions()) did = true;
    if (assignWorkers()) did = true;
    const pendingBuy = nextPurchase(s, data);
    const pending = pendingBuy && !canAfford(s.res, pendingBuy.cost) ? pendingBuy : null;
    saving = false;
    // Systems first: the Tavern, the Chapel, the first heroes and the forge, then the town's own growth.
    if (buySupport(pending)) did = true;
    if (recruit(pending)) did = true;
    if (talents()) did = true;
    if (tidyBag()) did = true;
    if (forge(pending)) did = true;
    if (brew()) did = true;
    if (pendingBuy && canAfford(s.res, pendingBuy.cost) && (!saving || pendingBuy.forced)) {
      const w = pendingBuy.kind === 'townhall' ? null : pendingBuy.def;
      const r = pendingBuy.kind === 'townhall' ? buyTownHall(s, data) : buyBuilding(s, w.id, 1, data);
      if (apply(r)) {
        did = true;
        if (pendingBuy.kind === 'townhall') mark(`townhall_${s.town.townHall}`);
        else mark(`first_${w.id}`);
      }
    }
    if (dispatch()) did = true;
    if (manageOrders()) did = true;
    if (prestige()) did = true;
    return did;
  }

  function observe() {
    if (s.heroes.length) mark('first_hero');
    if (lv('tavern') > 0) mark('tavern_open');
    const top = Math.max(0, ...s.heroes.map((h) => h.level));
    for (const L of [5, 10, 15, 20, 30, 40, 50, 60]) if (top >= L) mark(`hero_level_${L}`);
    for (const z of data.zoneList) for (const d of zoneState(s, z.id).cleared) mark(`cleared_${d}`);
    const p = rebuildPreview(s, data);
    if (p.can && p.gain >= 15) mark('rebuild_gain_15');
    if (p.can) mark('rebuild_gain_1');
    for (const g of [1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12]) if (s.stats.lifetimeGold >= g) mark(`run_gold_${g.toExponential(0).replace('+', '')}`);
    if (data.templateById.ragnaros && zoneState(s, 'molten').cleared.includes('ragnaros')) mark('ragnaros');
  }

  const cadence = () => policy.cadence.find(([until]) => t - runStart < until)[1];

  for (let guard = 0; guard < 2_000_000 && t < limit - 1e-6; guard += 1) {
    for (let k = 0; k < 40; k += 1) if (!act()) break;
    observe();
    if (stopWhen && stopWhen(s, marks)) break;
    if (trace && t - lastLine >= 3600) {
      lastLine = t;
      const lv2 = s.heroes.map((h) => h.level).join(',');
      timeline.push({ h: Math.round(t / 360) / 10, th: s.town.townHall, heroes: lv2, runGold: Math.round(s.stats.lifetimeGold), renown: renownTotal(s), rebuilds: stats.rebuilds });
    }
    let dt = Math.min(cadence(), limit - t);
    if (policy.presence) {
      const { everySeconds, sessionSeconds } = policy.presence;
      const into = t % everySeconds;
      if (into >= sessionSeconds - 1e-9) {
        // Leave until the next visit. The engine decides how much of the time away counts.
        const gap = Math.min(everySeconds - into, limit - t);
        const r = advance({ ...s, savedAt: t * 1000 }, (t + gap) * 1000, data);
        s = r.state;
        t += gap;
        continue;
      }
      dt = Math.min(dt, sessionSeconds - into);
    }
    // Tapping is simulated a second at a time so the Rally meter drains and fills as it would.
    const tapStep = policy.tapsPerSec > 0 ? 1 : 10;
    let owed = 0;
    while (dt > 1e-9) {
      const d = Math.min(tapStep, dt);
      if (policy.tapsPerSec > 0) {
        owed += policy.tapsPerSec * d;
        while (owed >= 1) { s = collectTribute(s, data).state; owed -= 1; }
      }
      s = step(s, d, data);
      dt -= d;
      t += d;
    }
  }
  return { marks, runMarks, timeline, stats, state: s, hours: t / 3600 };
}

export const fmtT = (sec) => {
  if (sec === undefined) return 'never';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(Math.floor(sec % 60)).padStart(2, '0')}s`;
};
