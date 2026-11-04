import { DATA } from '../engine/data.js';
import { achievementCount } from '../engine/achievements.js';
import { h, setText, setClass } from './dom.js';

// Every achievement, earned or not. Each earned one adds a little to the global multiplier.
export function createAchievements() {
  const summary = h('p', { class: 'muted' });
  const rows = {};
  const list = h('ul', { class: 'ach-list', 'aria-label': 'Achievements' }, DATA.achievements.list.map((a) => {
    const state = h('span', { class: 'ach-state' });
    const li = h('li', { class: 'ach' }, h('div', {}, h('strong', {}, a.name), h('span', { class: 'muted' }, ` ${a.text}`)), state);
    rows[a.id] = { li, state };
    return li;
  }));
  const el = h('div', { class: 'card', id: 'achievements' }, h('h2', { class: 'h-sec' }, 'Achievements'), summary, list);

  function update(state) {
    const n = achievementCount(state);
    setText(summary, `${n} of ${DATA.achievements.list.length} earned. Each adds ${Math.round(DATA.achievements.bonusEach * 100)}% to everything the town makes, and they are kept through every Rebuild.`);
    for (const a of DATA.achievements.list) {
      const done = state.achievements?.[a.id] !== undefined;
      setClass(rows[a.id].li, 'is-done', done);
      setText(rows[a.id].state, done ? 'Earned' : 'Not yet');
    }
  }
  return { el, update };
}
