import { DATA } from '../engine/data.js';
import { storageCap, levelOf } from '../engine/derive.js';
import { fmt, fmtRate } from '../engine/numbers.js';
import { h, setText, setClass, setAttr } from './dom.js';
import { icon } from './icons.js';

// The resource bar. Tier 1 resources always show; the rest appear once they matter.
export function createResourceStrip(ctx) {
  const refs = {};
  let openId = null;
  const breakdown = h('div', { class: 'breakdown', id: 'breakdown', hidden: true, role: 'region', 'aria-label': 'Income breakdown' });
  const strip = h(
    'div',
    { class: 'res-strip', role: 'group', 'aria-label': 'Resources' },
    DATA.resources.map((r) => {
      const value = h('span', { class: 'res-value' });
      const cap = h('span', { class: 'res-cap' });
      const rate = h('span', { class: 'res-rate' });
      const btn = h(
        'button',
        {
          class: `res res-${r.id}`,
          type: 'button',
          'aria-expanded': 'false',
          'aria-controls': 'breakdown',
          onClick: () => {
            openId = openId === r.id ? null : r.id;
            ctx.refresh();
          },
        },
        icon(r.id),
        h('span', { class: 'res-text' }, h('span', { class: 'res-name' }, r.name), h('span', { class: 'res-line' }, value, cap), rate),
      );
      refs[r.id] = { btn, value, cap, rate };
      return btn;
    }),
  );
  const el = h('div', { class: 'res-wrap' }, strip, breakdown);

  function update(state, info) {
    const mode = state.settings.numberFormat;
    for (const r of DATA.resources) {
      const i = info[r.id];
      const ref = refs[r.id];
      const shown = r.tier === 1 || state.res[r.id] > 0 || i.gross > 0 || i.uses.length > 0;
      ref.btn.hidden = !shown;
      if (!shown) continue;

      const limit = storageCap(state, r.id);
      const full = Number.isFinite(limit) && state.res[r.id] >= limit - 1e-6;
      setText(ref.value, fmt(state.res[r.id], mode));
      setText(ref.cap, Number.isFinite(limit) ? `/ ${fmt(limit, mode)}` : '');
      if (full && i.total > 0) setText(ref.rate, 'Full: surplus is lost');
      else if (i.total > 0) setText(ref.rate, `+${fmtRate(i.total, mode)}`);
      else if (i.total < 0) setText(ref.rate, `-${fmtRate(-i.total, mode)}`);
      else setText(ref.rate, i.gross > 0 ? 'balanced' : 'no income');
      setClass(ref.btn, 'is-full', full);
      setClass(ref.btn, 'is-low', r.id === 'food' && state.town.residents > 0 && state.res.food <= 1e-9 && i.total < 0);
      setClass(ref.btn, 'is-open', openId === r.id);
      setAttr(ref.btn, 'aria-expanded', openId === r.id ? 'true' : 'false');
    }

    breakdown.hidden = openId === null;
    if (openId === null) return;
    const res = DATA.resourceById[openId];
    const i = info[openId];
    const limit = storageCap(state, openId);
    const lines = (list, sign) => list.map((s) => h('li', {}, h('span', {}, s.label, s.doubled ? ' (doubled)' : '', s.workers ? `, ${s.workers} worker${s.workers > 1 ? 's' : ''}` : ''), h('span', { class: 'lead' }), h('span', {}, `${sign}${fmtRate(s.amount, mode)}`)));
    const rows = [...lines(i.sources, '+'), ...lines(i.uses, '-')];
    const maker = DATA.buildings.find((b) => b.produces === openId);
    const sig = `${openId}|${mode}|${rows.length}|${i.total}|${limit}|${i.sources.map((s) => `${s.label}${s.amount}`).join(',')}|${i.uses.map((s) => `${s.label}${s.amount}`).join(',')}`;
    if (breakdown.dataset.sig === sig) return;
    breakdown.dataset.sig = sig;
    breakdown.replaceChildren(
      h('p', { class: 'breakdown-title' }, `${res.name} per second`),
      h('ul', {}, rows.length ? rows : [h('li', { class: 'muted' }, openId === 'gold' ? 'No source yet.' : `No source of ${res.name.toLowerCase()} yet${maker ? `. Build a ${maker.name}` : ''}.`)]),
      h('p', { class: 'breakdown-total' }, h('span', {}, 'Net'), h('span', { class: 'lead' }), h('span', {}, `${i.total < 0 ? '-' : ''}${fmtRate(Math.abs(i.total), mode)}`)),
      Number.isFinite(limit) ? h('p', { class: 'muted' }, `Storage limit ${fmt(limit, mode)} (Warehouse level ${levelOf(state, 'warehouse')}). Anything over the limit is lost.`) : null,
      i.multiplier !== 1 ? h('p', { class: 'muted' }, `Includes a ${fmt(i.multiplier, mode)}x global multiplier.`) : null,
      openId === 'gold' ? h('p', { class: 'muted' }, 'Gathering tribute adds gold on top of this.') : null,
    );
  }
  return { el, update };
}
