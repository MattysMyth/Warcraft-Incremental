import { DATA } from '../engine/data.js';
import { raidPreview } from '../engine/raids.js';
import { fmt, fmtDuration } from '../engine/numbers.js';
import { h, setText, setClass } from './dom.js';
import { icon } from './icons.js';

// The town's Defence against raids: the wall, the guard at home, the threat and recent raids.
export function createDefence() {
  const status = h('p', { class: 'b-blurb' });
  const numbers = h('p', { class: 'b-prod' });
  const timer = h('p', { class: 'muted' });
  const record = h('p', { class: 'muted' });
  const list = h('ul', { class: 'plain-list', 'aria-label': 'Recent raids' });
  const el = h(
    'section',
    { class: 'card defence', 'aria-label': 'Town defence', hidden: true },
    h('div', { class: 'th-head' }, h('div', { class: 'b-icon' }, icon('wall_watchtower')), h('div', {}, h('h2', { class: 'b-name' }, 'Defence'), numbers)),
    status, timer, record, list,
  );
  let sig = '';

  function update(state) {
    const p = raidPreview(state);
    const raids = state.raids;
    const wallLevel = state.town.buildings.wall_watchtower ?? 0;
    el.hidden = !p.active && !(raids?.won || raids?.lost);
    if (el.hidden) return;
    const mode = state.settings.numberFormat;
    setText(numbers, `Defence ${fmt(p.defence, mode)} (wall ${fmt(p.wall, mode)}, guard ${fmt(p.guard, mode)}) against a threat of about ${fmt(p.threat, mode)}.`);
    setClass(el, 'is-safe', p.safe);
    setText(status, p.safe
      ? 'The town can hold against what is coming.'
      : wallLevel > 0
        ? 'A strong raid could break through. Raise the Wall and Watchtower, or keep heroes at home to stand guard.'
        : 'Nothing guards the town yet. Raids can carry off a share of the stockpile. The Wall and Watchtower arrives with Town Hall 11, and heroes at home stand guard.');
    setText(timer, p.active ? `The next raid arrives in about ${fmtDuration(Math.max(0, p.next))}. A failed raid takes ${Math.round(DATA.raids.steal.share * 100)}% of the raw stockpile, never gold or buildings.` : 'No raids yet. They begin once a Duskwood or later headline is cleared.');
    setText(record, `Beaten back ${raids.won}, broken through ${raids.lost}.`);
    const s = JSON.stringify(raids.log.map((e) => e.n));
    if (s !== sig) {
      sig = s;
      list.replaceChildren(...raids.log.slice(0, 5).map((e) => h('li', {}, `${e.won ? 'Held' : 'Lost'}: defence ${fmt(e.defence, mode)} against ${fmt(e.threat, mode)}${e.won ? '' : `, lost ${Object.entries(e.lost).map(([id, n]) => `${fmt(n, mode)} ${DATA.resourceById[id].name.toLowerCase()}`).join(', ') || 'little'}`}.`)));
    }
  }
  return { el, update };
}
