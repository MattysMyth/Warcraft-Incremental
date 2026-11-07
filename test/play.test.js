// The headless bot plays the real engine. These check the early pacing targets from the design:
// tavern and first hero near 10 minutes, Elwynn cleared near an hour, the Deadmines near three hours.
import { runProfiles, PROFILES } from '../sim/engage.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { playGame, POLICY } from '../sim/bot.js';
import { DATA } from './helpers.js';

const within = (value, target, tol = 0.15) => value >= target * (1 - tol) && value <= target * (1 + tol);
const mins = (s) => (s / 60).toFixed(1);

const median = (xs) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)];

test('the bot reaches the early milestones on the design targets (median of five seeds)', () => {
  const runs = [1, 2, 3, 4, 5].map((seed) => playGame({ maxHours: 3.8, seed, data: DATA, policy: { ...POLICY, rebuild: false } }).marks);
  const first = median(runs.map((m) => m.first_hero ?? Infinity));
  const elwynn = median(runs.map((m) => m.cleared_fargodeep_mine ?? Infinity));
  const westfall = median(runs.map((m) => m.cleared_the_deadmines ?? Infinity));
  assert.ok(within(first, 600), `first hero at ${mins(first)} min`);
  assert.ok(within(elwynn, 3600), `Elwynn cleared at ${mins(elwynn)} min`);
  assert.ok(within(westfall, 3 * 3600), `Westfall cleared at ${mins(westfall)} min`);
});

test('the first Rebuild becomes advisable between two and three hours', () => {
  const r = playGame({ maxHours: 3.2, seed: 1, data: DATA, policy: { ...POLICY, rebuild: true } });
  assert.ok(r.marks.rebuild_1 >= 2 * 3600 * 0.85 && r.marks.rebuild_1 <= 3 * 3600 * 1.15, `first Rebuild at ${mins(r.marks.rebuild_1 ?? NaN)} min`);
});

test('being there matters: hands-on play beats plain play, and long absences fall well behind', () => {
  const rows = runProfiles({ hours: 8, profiles: PROFILES.slice(0, 4) });
  const [hands, plain, hourly, fourHourly] = rows;
  assert.ok(hands.marks >= plain.marks, `hands-on ${hands.marks} vs plain ${plain.marks}`);
  assert.ok(hourly.share <= 1.02, 'a 15-minute visit each hour does not beat constant play');
  assert.ok(fourHourly.share < 0.9, `visiting every 4 hours reached ${(fourHourly.share * 100).toFixed(0)}% of the hands-on player`);
});
