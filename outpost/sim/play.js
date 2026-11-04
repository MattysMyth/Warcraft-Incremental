// Run the full-game bot and print what happened. `npm run play -- --hours=24 --trace`
import { playGame, fmtT } from './bot.js';

const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const hours = Number(arg('hours', 24));
const seed = Number(arg('seed', 1));
const started = Date.now();
const r = playGame({ maxHours: hours, seed, trace: process.argv.includes('--trace'), policy: { ...(await import('./bot.js')).POLICY, rebuild: !process.argv.includes('--no-rebuild') } });
console.log(`Simulated ${r.hours.toFixed(1)} h in ${((Date.now() - started) / 1000).toFixed(1)} s of real time.`);
console.log(`Town Hall ${r.state.town.townHall}; heroes ${r.state.heroes.map((h) => `${h.class[0]}${h.level}`).join(' ')}; rebuilds ${r.stats.rebuilds}; renown ${r.state.prestige.renownTotal}.`);
console.log(`Decisions: ${JSON.stringify(r.stats)}`);
for (const [name, sec] of Object.entries(r.marks)) console.log(`  ${name.padEnd(24)} ${fmtT(sec)}`);
if (process.argv.includes('--trace')) for (const row of r.timeline) console.log(JSON.stringify(row));
console.log('Per run marks (seconds since each Rebuild):');
r.runMarks.forEach((m, i) => console.log(`  run ${i + 1}: ${['tavern_open', 'first_hero', 'cleared_fargodeep_mine', 'cleared_the_deadmines', 'cleared_stitches', 'rebuild_gain_15'].map((k) => `${k}=${fmtT(m[k])}`).join(' ')}`));
