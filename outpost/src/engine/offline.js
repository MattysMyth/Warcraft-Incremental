import { DATA } from './data.js';
import { step } from './tick.js';
import { bonusOf } from './renown.js';

// Offline policy: each tier credits time at its own rate up to its limit.
// With the shipped data: 100% for 2 h, 50% to 12 h, 10% to 7 days, then nothing.
export function effectiveSeconds(elapsed, tiers = DATA.economy.offlineTiers, boost = 0) {
  let credited = 0;
  let prev = 0;
  for (const tier of tiers) {
    const span = Math.min(elapsed, tier.upToSeconds) - prev;
    // The Hourglass lifts the tiers that are not already at full rate, never past full.
    if (span > 0) credited += span * (tier.rate >= 1 ? tier.rate : Math.min(1, tier.rate + boost));
    prev = tier.upToSeconds;
  }
  return credited;
}

// Bring the state up to the wall-clock time `now`. Used by the live loop (small
// elapsed values) and by load (large ones), so both follow the same rule.
export function advance(state, now, data = DATA) {
  const eco = data.economy;
  const elapsed = Math.max(0, (now - state.savedAt) / 1000);
  const credited = effectiveSeconds(elapsed, eco.offlineTiers, bonusOf(state, 'offlineRate', data));
  const chunk = elapsed <= 5 ? eco.tickSeconds : eco.offlineChunkSeconds;

  // While catching up, at most one raid lands: it is resolved on return, not once per missed half hour.
  let s = elapsed > 5 && state.raids ? { ...state, raids: { ...state.raids, budget: 1 } } : state;
  let remaining = credited;
  while (remaining > 1e-9) {
    const dt = Math.min(chunk, remaining);
    s = step(s, dt, data);
    remaining -= dt;
  }

  if (s.raids && s.raids.budget !== undefined) { const { budget, ...rest } = s.raids; s = { ...s, raids: rest }; }
  const gains = {};
  for (const r of data.resources) gains[r.id] = (s.res[r.id] ?? 0) - (state.res[r.id] ?? 0);
  const maxTier = eco.offlineTiers.at(-1).upToSeconds;
  const heroLevels = s.heroes
    .map((h) => ({ name: h.name, from: state.heroes.find((x) => x.id === h.id)?.level ?? h.level, to: h.level }))
    .filter((x) => x.to > x.from);
  const quests = questSummary(state, s);
  let journal = s.journal;
  // The Warden's Journal keeps a line for every absence long enough to earn a welcome card.
  if (bonusOf(state, 'journal', data) > 0 && elapsed >= eco.welcomeBackMinSeconds) {
    const entry = { t: now, away: Math.round(elapsed), done: quests.done, failed: quests.failed, gold: Math.round(gains.gold ?? 0), xp: Math.round(quests.xp), levels: heroLevels.length };
    journal = [entry, ...(s.journal ?? [])].slice(0, data.sands.journalKeep);
  }
  return {
    state: { ...s, ...(journal ? { journal } : {}), savedAt: now },
    report: { elapsed, credited, gains, beyondLimit: elapsed > maxTier, heroLevels, quests },
  };
}

// What the quest board did between two snapshots, read from the results record.
export function questSummary(before, after) {
  const fresh = after.quests.history.filter((e) => e.n > before.quests.seq);
  const sum = { done: 0, failed: 0, gold: 0, xp: 0, res: {}, items: 0, sold: 0, firstClears: 0, running: after.quests.active.length };
  for (const e of fresh) {
    if (e.ok) {
      sum.done += 1; sum.gold += e.gold; sum.xp += e.xp;
      sum.items += e.loot?.length ?? 0; sum.sold += e.sold ?? 0; if (e.firstClear) sum.firstClears += 1;
      for (const [id, amt] of Object.entries(e.res)) sum.res[id] = (sum.res[id] ?? 0) + amt;
    } else sum.failed += 1;
  }
  return sum;
}
