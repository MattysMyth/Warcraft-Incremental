import { bonusOf } from '../engine/renown.js';
import { fmtDuration, fmt as fmtBig, fmtInt } from '../engine/numbers.js';
import { h, setText } from './dom.js';

const fmt = (v, mode) => (v < 1000 ? fmtInt(v) : fmtBig(v, mode));

// The Warden's Journal: one line for each long absence, kept across Eras once the Sands upgrade is bought.
export function createJournal() {
  const intro = h('p', { class: 'muted' });
  const list = h('ul', { class: 'ach-list', 'aria-label': 'Journal entries' });
  const el = h('div', { class: 'card', id: 'journal', hidden: true }, h('h2', { class: 'h-sec' }, "Warden's Journal"), intro, list);
  let sig = '';

  function update(state) {
    const on = bonusOf(state, 'journal') > 0;
    const entries = state.journal ?? [];
    el.hidden = !on && !entries.length;
    if (el.hidden) return;
    const mode = state.settings.numberFormat;
    setText(intro, entries.length ? 'What happened while you were away, newest first.' : 'Nothing yet. Long absences will be written down here.');
    const next = entries.map((e) => e.t).join(',');
    if (next === sig) return;
    sig = next;
    list.replaceChildren(...entries.map((e) => h('li', { class: 'ach is-done' },
      h('div', {}, h('strong', {}, new Date(e.t).toLocaleString()), h('span', { class: 'muted' }, ` Away ${fmtDuration(e.away)}: ${e.done} quests won, ${e.failed} lost, ${fmt(e.gold, mode)} gold, ${fmt(e.xp, mode)} experience${e.levels ? `, ${e.levels} ${e.levels === 1 ? 'hero' : 'heroes'} levelled` : ''}.`)))));
  }
  return { el, update };
}
