import test from 'node:test';
import assert from 'node:assert/strict';
import { setSetting } from '../src/engine/actions.js';
import { fmt, NUMBER_FORMATS } from '../src/engine/numbers.js';
import { normalize, migrate, MIGRATIONS, deserialize, serialize } from '../src/engine/save.js';
import { newState, SAVE_VERSION, DEFAULT_SETTINGS } from '../src/engine/state.js';
import { sceneParts, sceneSvg, sceneCaption } from '../src/ui/scene-parts.js';
import { fresh, withBuildings } from './helpers.js';

test('the new display settings accept only their listed values', () => {
  const s = fresh();
  for (const [k, ok, bad] of [['theme', 'light', 'purple'], ['textSize', 'large', 'huge'], ['effects', 'off', 'maybe'], ['scene', 'off', 1], ['tutorial', 'done', 'later']]) {
    assert.equal(setSetting(s, k, ok).state.settings[k], ok, k);
    assert.equal(setSetting(s, k, bad).ok, false, k);
  }
  assert.equal(setSetting(s, 'numberFormat', 'grouped').ok, true);
});

test('grouped numbers show digit groups up to a million, then suffixes', () => {
  assert.ok(NUMBER_FORMATS.includes('grouped'));
  assert.equal(fmt(1234, 'grouped'), '1,234');
  assert.equal(fmt(999999, 'grouped'), '999,999');
  assert.equal(fmt(1234567, 'grouped'), '1.23M');
  assert.equal(fmt(7.5, 'grouped'), '7.50');
  assert.equal(fmt(1234, 'suffix'), '1.23K');
});

test('a fresh game starts the tutorial, and a v9 save in progress skips it', () => {
  assert.equal(fresh().settings.tutorial, 'on');
  const base = newState({ seed: 4, now: 1000 });
  const empty = JSON.parse(JSON.stringify({ ...base, v: 9 }));
  delete empty.settings.tutorial; delete empty.settings.theme;
  assert.equal(normalize(migrate(empty, MIGRATIONS, SAVE_VERSION)).settings.tutorial, 'on', 'nothing built yet');
  const played = JSON.parse(JSON.stringify(withBuildings({ ...base, v: 9 }, { market: 3 })));
  delete played.settings.tutorial;
  const m = normalize(migrate(played, MIGRATIONS, SAVE_VERSION));
  assert.equal(m.settings.tutorial, 'done');
  assert.equal(m.settings.theme, 'auto');
  assert.equal(m.v, SAVE_VERSION);
});

test('bad display settings in a save fall back to the defaults', () => {
  const dirty = JSON.parse(JSON.stringify(newState({ seed: 1, now: 5 })));
  dirty.settings = { numberFormat: 'nope', theme: 'neon', textSize: 7, effects: null, scene: 'x', tutorial: 'maybe', reducedMotion: 'on' };
  const n = normalize(dirty);
  assert.deepEqual(n.settings, { ...DEFAULT_SETTINGS, reducedMotion: 'on' });
  assert.deepEqual(deserialize(serialize(n)).settings, n.settings);
});

test('the town picture grows with the town and describes itself in words', () => {
  const none = sceneParts(fresh());
  assert.equal(none.houses, 0);
  assert.equal(none.tavern, false);
  let s = withBuildings(fresh(), { house: 14, lumber_camp: 20, market: 25, tavern: 3, wall_watchtower: 12 });
  s = { ...s, town: { ...s.town, townHall: 6 } };
  const p = sceneParts(s);
  assert.equal(p.houses, 3);
  assert.equal(p.stalls, 2);
  assert.equal(p.tavern, true);
  assert.equal(p.tier, 2);
  assert.ok(p.wall > 0);
  assert.ok(sceneSvg(p).length > sceneSvg(none).length);
  assert.match(sceneCaption(p, s), /Town Hall 6/);
  assert.match(sceneCaption(p, s), /a tavern/);
  assert.equal(sceneParts({ ...s, era: 2 }).era, 2);
});
