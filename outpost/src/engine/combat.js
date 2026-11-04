// The combat resolver. Automatic, deterministic and shared by every quest type.
// A fight steps in fixed ticks. Each combatant acts when its attack timer runs out.
// All randomness comes from a seeded generator, so one save, quest and party always
// replay the same fight, and the odds shown to the player are measured by simulating it.
import { DATA, isDelve } from './data.js';
import { sheetOf } from './heroes.js';
import { makeRng, seedFrom } from './rng.js';

const r2 = (x) => Math.round(x * 100) / 100;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

// ---- Building the two sides ----

// A hero as plain numbers, so a fight can be stored and replayed exactly.
export function heroUnit(state, hero, data = DATA, potion = null) {
  const s = sheetOf(state, hero, data);
  const fx = data.potionById?.[potion]?.effect ?? {};
  return {
    id: hero.id, name: hero.name, cls: hero.class, level: hero.level,
    hp: r2(s.hp * (1 + (fx.hp ?? 0))), power: r2(s.power * (1 + (fx.power ?? 0))),
    interval: r2(data.combat.attackSeconds / (s.haste + (fx.haste ?? 0))),
    crit: r2(s.crit + (fx.crit ?? 0)), armour: r2(s.armour * (1 + (fx.armour ?? 0))), regen: r2(s.regen),
    healing: r2(s.healing * (1 + (fx.healing ?? 0))), threat: r2(s.threat),
    save: hero.saveSignature === true,
  };
}

// The fights a quest consists of. Bounties and gathering trips are one fight; dungeons are a chain.
export function encountersFor(offer, data = DATA) {
  const t = data.templateById[offer.template];
  if (!t) return [];
  if (isDelve(t.type)) {
    const scale = { hp: data.quests.types[t.type].hpMult ?? 1, dps: data.quests.types[t.type].dpsMult ?? 1 };
    return t.encounters.map((e) => ({ name: e.name, boss: !!e.boss, mechanics: e.mechanics ?? [], enemies: e.enemies, budget: offer.rec * e.budget, scale }));
  }
  return [{ name: offer.title, boss: false, mechanics: [], enemies: t.enemies, budget: offer.rec, scale: { hp: 1, dps: 1 } }];
}

// Turn a group like [{id, n}] and a budget into enemy stat blocks. The budget is the quest's
// recommended rating: its share is split across the group by each enemy's weight.
export function buildGroup(group, budget, level, data = DATA, boss = false, scale = { hp: 1, dps: 1 }) {
  const ec = data.combat.enemy;
  const flat = [];
  for (const g of group) for (let i = 0; i < g.n; i += 1) flat.push({ tpl: data.enemyById[g.id], i, of: g.n });
  const total = flat.reduce((a, e) => a + e.tpl.weight, 0);
  return flat.map((e) => {
    const share = e.tpl.weight / total;
    const dps = ec.dpsPerRec * budget * share * scale.dps;
    return {
      tpl: e.tpl.id, family: e.tpl.family, name: e.of > 1 ? `${e.tpl.name} ${e.i + 1}` : e.tpl.name, level, boss,
      hp: r2(ec.hpPerRec * budget * share * scale.hp), power: r2(dps * e.tpl.interval), interval: e.tpl.interval,
      armour: r2(e.tpl.armour * (ec.armourBase + ec.armourPerLevel * level)),
    };
  });
}

// ---- The resolver ----

function armourCut(armour, level, data) {
  const a = data.combat.armour;
  return clamp(armour / (armour + a.ref + a.perLevel * level), 0, a.cap);
}

// Run a party through a list of encounters. `heroes` are heroUnit snapshots.
export function runFight(heroes, encounters, level, seed, data = DATA, { record = false } = {}) {
  const C = data.combat;
  const rng = makeRng(seed);
  const dt = C.tick;
  const log = record ? [] : null;
  const frames = record ? [] : null;
  const party = heroes.map((u, i) => ({
    u, hp: u.hp, alive: true, timer: 0, cds: [0, 0, 0], shield: 0, shieldLeft: 0, mit: 0, mitLeft: 0, opener: true,
    stacks: 0, spec: C.classes[u.cls], idx: i,
  }));
  const result = {
    won: false, wipedAt: null, seconds: 0, stolen: 0, knockouts: 0, heroes: heroes.map((u) => u.name),
    encounters: [], log, frames, hpEnd: [],
  };
  let T = 0;
  let nextFrame = 0;
  let enemies = [];
  let enc = null;
  // Ordinary lines stop at a cap so a long dungeon cannot flood the log; key lines (fights, knockouts, bosses) always get in.
  let chatter = 0;
  const say = (text, key = false) => {
    if (!log) return;
    if (key) { if (log.length < C.log.maxLines * 4) log.push({ t: T, text, k: true }); }
    else if (chatter < C.log.maxLines) { chatter += 1; log.push({ t: T, text, k: false }); }
  };

  const aliveHeroes = () => party.filter((h) => h.alive);
  const aliveEnemies = () => enemies.filter((e) => e.alive);
  const healMult = (h) => Math.min(C.healScale.cap, C.healScale.base + h.u.healing / C.healScale.ref);

  function hurtHero(h, raw, from) {
    let dmg = raw * (1 - armourCut(h.u.armour, from.level, data)) * (1 - (h.mitLeft > 0 ? h.mit : 0));
    dmg *= 1 + (h.stacks ? h.stacks * stackPer : 0);
    dmg *= enrage;
    if (h.shieldLeft > 0 && h.shield > 0) {
      const soak = Math.min(h.shield, dmg);
      h.shield -= soak;
      dmg -= soak;
    }
    h.hp -= dmg;
    if (h.hp <= 0) {
      h.hp = 0; h.alive = false; h.stacks = 0; result.knockouts += 1;
      say(`${h.u.name} is knocked out.`, true);
    }
    return dmg;
  }

  function hitEnemy(h, e, mult, label) {
    let dmg = h.u.power * mult * (1 + (rng() * 2 - 1) * C.variance);
    const crit = rng() * 100 < h.u.crit;
    if (crit) dmg *= C.critMult;
    dmg *= 1 - armourCut(e.armour, h.u.level, data);
    e.hp -= dmg;
    const tbl = e.threat;
    tbl[h.idx] = (tbl[h.idx] ?? 0) + dmg * h.u.threat;
    if (label || crit) say(`${h.u.name}${label ? ` uses ${label} on` : ' crits'} ${e.name} for ${Math.round(dmg)}.`);
    if (e.hp <= 0) { e.hp = 0; e.alive = false; say(`${e.name} falls.`, e.boss); }
    return dmg;
  }

  function addThreatFromHeal(h, amount) {
    for (const e of enemies) if (e.alive) e.threat[h.idx] = (e.threat[h.idx] ?? 0) + amount * C.threat.healFactor * h.u.threat;
  }

  function lowestAlly() {
    let best = null;
    for (const a of party) if (a.alive && (!best || a.hp / a.u.hp < best.hp / best.u.hp)) best = a;
    return best;
  }
  function lowestEnemy() {
    let best = null;
    for (const e of enemies) if (e.alive && (!best || e.hp < best.hp)) best = e;
    return best;
  }
  const targetedBy = (h) => enemies.some((e) => e.alive && e.tgt === h.idx);

  // Try the three abilities in order. Returns true if one was used.
  function useAbility(h) {
    const abs = h.spec.abilities;
    for (let i = 0; i < abs.length; i += 1) {
      const a = abs[i];
      if (h.cds[i] > 0) continue;
      if (i === 0 && h.u.save && !enc.boss) continue;
      let ok = false;
      switch (a.kind) {
        case 'opener':
          if (h.opener) { const e = lowestEnemy(); if (e) { hitEnemy(h, e, a.mult, a.name); ok = true; } }
          h.opener = false;
          break;
        case 'burst': { const e = lowestEnemy(); if (e) { hitEnemy(h, e, a.mult, a.name); ok = true; } break; }
        case 'multi': {
          const live = aliveEnemies().sort((x, y) => x.hp - y.hp);
          if (live.length >= 2) {
            say(`${h.u.name} uses ${a.name}.`);
            for (const e of live.slice(0, a.targets)) hitEnemy(h, e, a.mult, null);
            ok = true;
          }
          break;
        }
        case 'taunt': {
          const live = aliveEnemies();
          if (aliveHeroes().length > 1 && live.some((e) => e.tgt !== h.idx && e.forced !== h.idx)) {
            for (const e of live) {
              const top = Math.max(0, ...Object.values(e.threat));
              e.threat[h.idx] = top + 1;
              e.forced = h.idx; e.forcedLeft = a.seconds;
            }
            say(`${h.u.name} uses ${a.name}. The enemies turn on them.`);
            ok = true;
          }
          break;
        }
        case 'heal': {
          const t = lowestAlly();
          if (t && t.hp / t.u.hp < a.allyBelow) {
            const amt = Math.min(t.u.hp - t.hp, a.pct * t.u.hp * healMult(h));
            t.hp += amt; addThreatFromHeal(h, amt);
            say(`${h.u.name} uses ${a.name} on ${t.u.name} for ${Math.round(amt)}.`);
            ok = true;
          }
          break;
        }
        case 'shield_heal': {
          const t = lowestAlly();
          if (t && t.hp / t.u.hp < a.allyBelow) {
            const amt = Math.min(t.u.hp - t.hp, a.pct * t.u.hp * healMult(h));
            t.hp += amt; t.shield = a.shield * t.u.hp; t.shieldLeft = a.seconds; addThreatFromHeal(h, amt + t.shield);
            say(`${h.u.name} uses ${a.name} on ${t.u.name}.`);
            ok = true;
          }
          break;
        }
        case 'absorb': {
          let t = null;
          for (const x of party) if (x.alive && targetedBy(x)) { t = x; break; }
          t = t ?? lowestAlly();
          if (t && t.shieldLeft <= 0 && t.hp / t.u.hp < a.allyBelow) {
            t.shield = a.pct * t.u.hp * healMult(h); t.shieldLeft = a.seconds; addThreatFromHeal(h, t.shield);
            say(`${h.u.name} shields ${t.u.name}.`);
            ok = true;
          }
          break;
        }
        case 'mitigate':
          if (h.hp / h.u.hp < a.hpBelow && h.mitLeft <= 0) {
            h.mit = a.reduce; h.mitLeft = a.seconds;
            say(`${h.u.name} uses ${a.name}.`);
            ok = true;
          }
          break;
        case 'stun': {
          let t = null;
          for (const e of enemies) if (e.alive && !e.boss && e.stun <= 0 && (!t || e.hp > t.hp)) t = e;
          if (t) { t.stun = a.seconds; say(`${h.u.name} uses ${a.name} on ${t.name}.`); ok = true; }
          break;
        }
        case 'slow':
          if (aliveEnemies().length && !enemies.some((e) => e.alive && e.slow > 0)) {
            for (const e of enemies) if (e.alive) { e.slow = a.seconds; e.slowBy = a.factor; }
            say(`${h.u.name} uses ${a.name}.`);
            ok = true;
          }
          break;
        default:
      }
      if (ok) { h.cds[i] = a.cd; return true; }
    }
    return false;
  }

  function heroAct(h) {
    if (useAbility(h)) return;
    const basic = h.spec.basic;
    if (basic.type === 'heal') {
      const t = lowestAlly();
      if (t && t.hp / t.u.hp < 0.9) {
        const amt = Math.min(t.u.hp - t.hp, h.u.healing * C.basicHealMult);
        t.hp += amt; addThreatFromHeal(h, amt);
        return;
      }
    }
    const e = lowestEnemy();
    if (e) hitEnemy(h, e, basic.mult, null);
  }

  function pickTarget(e) {
    if (e.forced >= 0 && party[e.forced]?.alive) return party[e.forced];
    let best = null;
    let top = -1;
    for (const h of party) {
      if (!h.alive) continue;
      const th = e.threat[h.idx] ?? 0;
      if (th > top) { top = th; best = h; }
    }
    if (best && top > 0) return best;
    const live = aliveHeroes();
    return live[Math.floor(rng() * live.length)] ?? null;
  }

  let enrage = 1;
  let stackPer = 0;

  function enemyAct(e) {
    const h = pickTarget(e);
    if (!h) return;
    e.tgt = h.idx;
    const raw = e.power * (1 + (rng() * 2 - 1) * C.variance);
    hurtHero(h, raw, e);
    if (e.family === 'brigands' && result.stolen < data.enemies.steal.max) {
      if (result.stolen === 0) say(`${e.name} snatches a purse.`);
      result.stolen = Math.min(data.enemies.steal.max, result.stolen + data.enemies.steal.perHit);
    }
  }

  function spawn(units) {
    const made = units.map((u) => ({ ...u, maxHp: u.hp, alive: true, timer: u.interval * (0.4 + rng() * 0.4), threat: {}, tgt: -1, forced: -1, forcedLeft: 0, stun: 0, slow: 0, slowBy: 1 }));
    enemies.push(...made);
    return made;
  }

  function sample() {
    if (!frames || T < nextFrame) return;
    nextFrame = T + C.frameSeconds;
    frames.push({ t: T, e: result.encounters.length - 1, h: party.map((x) => r2(x.hp / x.u.hp)), n: enemies.map((x) => r2(x.hp / x.maxHp)) });
  }

  for (let ei = 0; ei < encounters.length; ei += 1) {
    enc = encounters[ei];
    enemies = [];
    enrage = 1;
    stackPer = 0;
    // Each fight is a little easier or harder than the average, so odds are a gradient, not a cliff.
    const jh = 1 + (rng() * 2 - 1) * C.jitter;
    const jd = 1 + (rng() * 2 - 1) * C.jitter;
    const scale = { hp: enc.scale.hp * jh, dps: enc.scale.dps * jd };
    const units = buildGroup(enc.enemies, enc.budget, level, data, enc.boss, scale);
    enc = { ...enc, scale };
    spawn(units);
    // Every encounter starts fresh: abilities ready, shields gone, a short breather before the next one.
    for (const h of party) {
      if (ei > 0) {
        if (!h.alive) { h.alive = true; h.hp = h.u.hp * C.between.reviveHp; }
        else h.hp = Math.min(h.u.hp, h.hp + h.u.hp * C.between.recoverHp);
      }
      h.cds = [0, 0, 0]; h.shield = 0; h.shieldLeft = 0; h.mitLeft = 0; h.opener = true; h.stacks = 0;
      h.timer = 0.3 + h.idx * 0.2;
    }
    say(`${enc.boss ? 'Boss' : 'Fight'} ${ei + 1} of ${encounters.length}: ${enc.name}.`, true);
    const rec = { name: enc.name, boss: enc.boss, won: false, seconds: 0, enemies: units.map((u) => u.name) };
    result.encounters.push(rec);
    const mech = (enc.mechanics ?? []).map((m) => ({ ...m, next: m.kind === 'add_wave' ? m.first : m.kind === 'stack' ? m.every : Infinity, last: -1 }));
    let t = 0;
    let over = false;
    while (!over) {
      t += dt; T += dt; rec.seconds = t;
      for (const m of mech) {
        if (m.kind === 'enrage' && t >= m.at && enrage === 1) { enrage = m.mult; say(m.name, true); }
        if (m.kind === 'add_wave' && t >= m.next) {
          m.next += m.every;
          const adds = buildGroup([{ id: m.enemy, n: m.n }], enc.budget * m.budget * m.n, level, data, false, enc.scale);
          spawn(adds);
          say(m.name + '.', true);
        }
        if (m.kind === 'stack' && t >= m.next) {
          m.next += m.every;
          const boss = enemies.find((e) => e.alive && e.boss);
          const tgt = boss && party[boss.tgt]?.alive ? party[boss.tgt] : null;
          if (tgt) {
            if (m.last !== tgt.idx) { for (const h of party) h.stacks = 0; m.last = tgt.idx; }
            tgt.stacks = Math.min(m.max, tgt.stacks + 1);
            stackPer = m.perStack;
            if (tgt.stacks === m.max) say(`${m.name} on ${tgt.u.name} is at its worst.`);
          }
        }
      }
      for (const h of party) {
        if (!h.alive) continue;
        for (let i = 0; i < 3; i += 1) if (h.cds[i] > 0) h.cds[i] -= dt;
        if (h.shieldLeft > 0) { h.shieldLeft -= dt; if (h.shieldLeft <= 0) h.shield = 0; }
        if (h.mitLeft > 0) h.mitLeft -= dt;
        h.timer -= dt;
        if (h.timer <= 0) { h.timer += h.u.interval; heroAct(h); }
      }
      for (const e of enemies) {
        if (!e.alive) continue;
        if (e.forcedLeft > 0) { e.forcedLeft -= dt; if (e.forcedLeft <= 0) e.forced = -1; }
        if (e.slow > 0) e.slow -= dt;
        e.timer -= dt;
        if (e.stun > 0) { e.stun -= dt; if (e.timer < 0) e.timer = 0; continue; }
        if (e.timer <= 0) { e.timer += e.interval * (e.slow > 0 ? e.slowBy : 1); enemyAct(e); }
      }
      for (const h of party) if (h.alive && h.u.regen > 0) h.hp = Math.min(h.u.hp, h.hp + h.u.regen * dt);
      sample();
      const bossAlive = enc.boss && enemies.some((e) => e.alive && e.boss);
      if (!(enc.boss ? bossAlive : aliveEnemies().length)) { rec.won = true; over = true; }
      else if (!aliveHeroes().length) over = true;
      else if (t >= C.maxFightSeconds) { say('The fight drags on and the party withdraws.', true); over = true; }
    }
    if (!rec.won) { result.wipedAt = ei; break; }
    if (enc.boss) for (const e of enemies) e.alive = false;
  }
  result.won = result.wipedAt === null && result.encounters.length === encounters.length && result.encounters.every((r) => r.won);
  result.seconds = T;
  result.hpEnd = party.map((h) => r2(h.hp / h.u.hp));
  if (record) {
    say(result.won ? 'The party is victorious.' : `The party is beaten${result.wipedAt != null ? ` at ${result.encounters[result.wipedAt].name}` : ''}.`, true);
    result.log = log.map((l) => `${mmss(l.t)} ${l.text}`);
    result.keyLog = log.filter((l) => l.k).map((l) => `${mmss(l.t)} ${l.text}`);
  }
  return result;
}

// ---- Odds by simulation ----

const cache = new Map();
const sig = (units) => units.map((u) => `${u.cls}${u.level}:${u.hp},${u.power},${u.interval},${u.crit},${u.armour},${u.regen},${u.healing},${u.threat},${u.save ? 1 : 0}`).join('|');

export function winOdds(state, offer, heroes, data = DATA, potion = null) {
  const units = heroes.map((h) => heroUnit(state, h, data, potion));
  const key = `${state.seed}|${offer.id}|${offer.rec}|${sig(units)}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const encs = encountersFor(offer, data);
  const dungeon = isDelve(data.templateById[offer.template]?.type);
  const n = dungeon ? data.combat.odds.dungeonSamples : data.combat.odds.samples;
  let wins = 0;
  for (let i = 0; i < n; i += 1) {
    if (runFight(units, encs, offer.level, seedFrom(state.seed, offer.n, 700 + i), data).won) wins += 1;
  }
  const p = wins / n;
  if (cache.size >= data.combat.odds.cache) cache.delete(cache.keys().next().value);
  cache.set(key, p);
  return p;
}

// The real fight for a run. Same seed, same party stats: always the same result.
export const fightSeed = (state, offer) => seedFrom(state.seed, offer.n, 404);
