// How much does being there matter? Plays the same game under several habits and prints how far each got.
// `npm run engage -- --hours=24`. A good incremental game keeps the away profiles well behind the active one.
import { playGame, POLICY } from './bot.js';

const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const hours = Number(arg('hours', 24));
const seed = Number(arg('seed', 1));
const H = 3600;
const base = { ...POLICY, rebuild: false };

export const PROFILES = [
  { name: 'Always playing, hands-on', policy: { ...base, engage: true, tapsPerSec: 2 } },
  { name: 'Always playing, no extras', policy: { ...base } },
  { name: '15 min every hour', policy: { ...base, engage: true, tapsPerSec: 2, presence: { everySeconds: H, sessionSeconds: 15 * 60 } } },
  { name: '15 min every 4 hours', policy: { ...base, engage: true, tapsPerSec: 2, presence: { everySeconds: 4 * H, sessionSeconds: 15 * 60 } } },
  { name: '15 min once a day', policy: { ...base, engage: true, tapsPerSec: 2, presence: { everySeconds: 24 * H, sessionSeconds: 15 * 60 } } },
];

// A single number for "how far along": milestones reached, which count dungeons, hero levels and Town Hall levels.
export const progress = (r) => Object.keys(r.marks).length;

export function runProfiles({ hours: hrs = hours, seed: sd = seed, profiles = PROFILES } = {}) {
  const rows = profiles.map((p) => {
    const r = playGame({ maxHours: hrs, seed: sd, policy: p.policy });
    return { name: p.name, th: r.state.town.townHall, heroLevel: Math.max(0, ...r.state.heroes.map((h) => h.level)), marks: progress(r), gold: r.state.stats.lifetimeGold };
  });
  const top = rows[0];
  for (const x of rows) x.share = x.marks / top.marks;
  return rows;
}

if (process.argv[1]?.endsWith('sim/engage.js')) {
  const rows = runProfiles();
  console.log(`After ${hours} simulated hours (seed ${seed}); share is milestones reached against the hands-on player.`);
  for (const x of rows) console.log(`  ${x.name.padEnd(28)} Town Hall ${String(x.th).padStart(2)}  top hero ${String(x.heroLevel).padStart(2)}  milestones ${String(x.marks).padStart(3)}  share ${(x.share * 100).toFixed(0)}%`);
}
