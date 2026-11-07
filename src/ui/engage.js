// The hands-on screens: the Rally meter, building perks, edicts, timed events and their buffs.
// Like the rest of the UI, each piece is built once and patched afterwards.
import { DATA } from '../engine/data.js';
import { h, setText, setClass, setAttr } from './dom.js';
import { fmt, fmtDuration } from '../engine/numbers.js';
import { choosePerk, setEdict, answerEvent } from '../engine/actions.js';
import { perkRows, perkChoice, describePerk as describe, edictOf } from '../engine/engage.js';

const describePerk = (p) => { const t = describe(p); return t.charAt(0).toUpperCase() + t.slice(1); };
import { respecFee, edictSwapFee, eventOf, choiceTerms } from '../engine/events.js';

const R = () => DATA.engage.rally;
const resName = (id) => DATA.resourceById[id].name.toLowerCase();

// ---- Rally meter: fills as the tribute button is tapped, then pays off in a short burst ----

export function createRally() {
  const label = h('span', { class: 'rally-label' });
  const fill = h('span', { class: 'rally-fill' });
  const bar = h('div', { class: 'rally-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': 'Rally meter' }, fill);
  const el = h('div', { class: 'rally' }, label, bar);
  return {
    el,
    update(state) {
      const r = state.rally ?? { charge: 0, burst: 0 };
      const burst = r.burst > 0;
      const frac = burst ? r.burst / R().burstSeconds : r.charge / R().full;
      fill.style.width = `${Math.round(Math.min(1, frac) * 100)}%`;
      setClass(el, 'is-burst', burst);
      setAttr(bar, 'aria-valuenow', Math.round(Math.min(1, frac) * 100));
      setText(label, burst
        ? `Rally! +${Math.round(R().boost * 100)}% output for ${Math.ceil(r.burst)}s`
        : r.charge > 0 ? 'Rally: keep tapping' : `Rally: tap tribute to fill the meter for +${Math.round(R().boost * 100)}% output`);
    },
  };
}

// ---- Perks on a building ----

export function createPerks(ctx, def) {
  const rows = perkRows(def.id);
  if (!rows.length) return null;
  const summary = h('summary', {});
  const note = h('p', { class: 'muted perk-note' });
  const tiers = rows.map((row) => {
    const t = { row, opts: {} };
    t.head = h('p', { class: 'perk-at' });
    t.box = h('div', { class: 'perk-opts', role: 'group', 'aria-label': `Level ${row.at} perk` });
    for (const k of ['a', 'b']) {
      const name = h('strong', {});
      const text = h('span', { class: 'perk-text' });
      const b = h('button', {
        class: 'btn perk-opt', type: 'button', 'aria-pressed': 'false',
        onClick: () => {
          const r = ctx.run((s) => choosePerk(s, def.id, row.at, k));
          if (r.ok) { ctx.announce(`${row[k].name} chosen.`); ctx.saveSoon(); } else ctx.announce(r.error);
        },
      }, name, text);
      t.opts[k] = { b, name, text };
      t.box.append(b);
    }
    t.el = h('div', { class: 'perk-tier' }, t.head, t.box);
    return t;
  });
  const el = h('details', { class: 'perks' }, summary, note, ...tiers.map((t) => t.el));
  return {
    el,
    update(state, level) {
      const first = rows[0].at;
      el.hidden = level <= 0;
      if (level <= 0) return;
      const chosen = rows.filter((r) => perkChoice(state, def.id, r.at) && level >= r.at).length;
      const open = rows.filter((r) => level >= r.at).length;
      setText(summary, level < first ? `Perks open at level ${first}` : `Perks: ${chosen} of ${open} chosen${chosen < open ? ' (choices waiting)' : ''}`);
      setClass(el, 'has-choice', level >= first && chosen < open);
      const fee = respecFee(state);
      setText(note, 'The first choice at each level is free. Changing one costs gold.');
      for (const t of tiers) {
        const locked = level < t.row.at;
        const had = perkChoice(state, def.id, t.row.at);
        setText(t.head, locked ? `Level ${t.row.at} (locked)` : `Level ${t.row.at}`);
        for (const k of ['a', 'b']) {
          const o = t.opts[k];
          const p = t.row[k];
          const mine = had === k;
          setText(o.name, p.name);
          const price = had && !mine ? ` Change for ${fmt(fee, state.settings.numberFormat)} gold.` : '';
          setText(o.text, `${describePerk(p)}.${price}`);
          setAttr(o.b, 'aria-pressed', mine ? 'true' : 'false');
          setAttr(o.b, 'disabled', locked || mine || (had && state.res.gold < fee));
          setClass(o.b, 'is-chosen', mine);
        }
      }
    },
  };
}

// ---- Edicts ----

export function createEdicts(ctx) {
  const list = DATA.engage.edicts.list;
  const note = h('p', { class: 'muted' });
  const current = h('p', { class: 'edict-now' });
  const opts = {};
  const box = h('div', { class: 'edict-list', role: 'group', 'aria-label': 'Edicts' }, list.map((e) => {
    const name = h('strong', {});
    const text = h('span', { class: 'perk-text' });
    const b = h('button', {
      class: 'btn perk-opt', type: 'button', 'aria-pressed': 'false',
      onClick: () => {
        const r = ctx.run((s) => setEdict(s, e.id));
        if (r.ok) { ctx.announce(`${e.name} proclaimed.`); ctx.saveSoon(); } else ctx.announce(r.error);
      },
    }, name, text);
    opts[e.id] = { b, name, text };
    return b;
  }));
  const lift = h('button', {
    class: 'btn btn-small', type: 'button',
    onClick: () => { const r = ctx.run((s) => setEdict(s, null)); if (r.ok) ctx.saveSoon(); else ctx.announce(r.error); },
  }, 'Lift the edict');
  const el = h('section', { class: 'card edicts', 'aria-label': 'Edicts' }, h('h2', { class: 'h-sec' }, 'Edict'), current, note, box, lift);
  const effectText = (e) => {
    const bits = Object.entries(e.res ?? {}).map(([id, m]) => `${m > 1 ? '+' : '−'}${Math.round(Math.abs(m - 1) * 100)}% ${resName(id)}`);
    if (e.costMult) bits.push(`${e.costMult > 1 ? '+' : '−'}${Math.round(Math.abs(e.costMult - 1) * 100)}% building prices`);
    if (e.questSpeed) bits.push(`+${Math.round(e.questSpeed * 100)}% quest speed`);
    return bits.join(', ');
  };
  return {
    el,
    update(state) {
      const open = state.town.townHall >= DATA.engage.edicts.townHall;
      el.hidden = !open;
      if (!open) return;
      const cur = edictOf(state);
      const fee = edictSwapFee(state);
      setText(current, cur ? `In force: ${cur.name}.` : 'No edict in force.');
      setText(note, 'One edict at a time. The first is free; changing it costs gold. It resets with a Rebuild.');
      lift.hidden = !cur;
      for (const e of list) {
        const o = opts[e.id];
        const mine = cur?.id === e.id;
        setText(o.name, e.name);
        setText(o.text, `${effectText(e)}. ${e.text}${cur && !mine ? ` Costs ${fmt(fee, state.settings.numberFormat)} gold.` : ''}`);
        setAttr(o.b, 'aria-pressed', mine ? 'true' : 'false');
        setAttr(o.b, 'disabled', mine || (cur && state.res.gold < fee));
        setClass(o.b, 'is-chosen', mine);
      }
    },
  };
}

// ---- Timed events and buffs, shown above every tab ----

export function createEventCard(ctx) {
  const buffs = h('ul', { class: 'buffs', 'aria-label': 'Active boosts' });
  const title = h('h2', { class: 'h-sec' });
  const text = h('p', {});
  const timer = h('span', { class: 'chip' });
  const fill = h('span', { class: 'xpfill' });
  const bar = h('div', { class: 'xpbar event-bar', 'aria-hidden': 'true' }, fill);
  const choices = h('div', { class: 'event-choices' });
  const card = h('section', { class: 'card event-card', role: 'region', 'aria-label': 'A decision for the outpost', hidden: true },
    h('div', { class: 'run-head' }, title, timer), text, bar, choices);
  const el = h('div', { class: 'event-wrap' }, card, buffs);
  let shown = '';
  let btns = [];
  return {
    el,
    update(state) {
      const def = eventOf(state);
      card.hidden = !def;
      const sig = def ? `${def.id}:${state.events?.seq}` : '';
      if (def && sig !== shown) {
        shown = sig;
        setText(title, def.name);
        setText(text, def.text);
        btns = def.choices.map((c, i) => {
          const label = h('strong', {});
          const terms = h('span', { class: 'perk-text' });
          const b = h('button', {
            class: 'btn perk-opt', type: 'button',
            onClick: () => {
              const r = ctx.run((s) => answerEvent(s, i));
              if (r.ok) { ctx.announce(`${def.name}: ${c.label}.`); ctx.saveSoon(); } else ctx.announce(r.error);
            },
          }, label, terms);
          return { b, label, terms, c };
        });
        choices.replaceChildren(...btns.map((x) => x.b));
        ctx.announce(`${def.name}: a decision is waiting.`);
      }
      if (!def) shown = '';
      if (def) {
        const frac = state.event.left / (state.event.total || DATA.engage.events.window);
        fill.style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
        setText(timer, `${Math.ceil(state.event.left)}s`);
        for (const x of btns) {
          const t = choiceTerms(state, x.c);
          setText(x.label, x.c.label);
          const bits = [];
          if (t.cost) bits.push(`Costs ${fmt(t.cost.amount, state.settings.numberFormat)} ${resName(t.cost.res)}`);
          if (t.gain) bits.push(`gives ${fmt(t.gain.amount, state.settings.numberFormat)} ${resName(t.gain.res)}`);
          if (x.c.buff) bits.push(`${x.c.buff.output ? `+${Math.round(x.c.buff.output * 100)}% output` : `+${Math.round(x.c.buff.questSpeed * 100)}% quest speed`} for ${Math.round(x.c.buff.seconds / 60)} min`);
          if (x.c.residents) bits.push(`${x.c.residents} residents settle`);
          setText(x.terms, bits.length ? `${bits.join(', ')}.` : 'No cost, nothing changes.');
          setAttr(x.b, 'disabled', t.cost && (state.res[t.cost.res] ?? 0) < t.cost.amount);
        }
      }
      const list = state.buffs ?? [];
      buffs.hidden = list.length === 0;
      if (buffs.children.length !== list.length) buffs.replaceChildren(...list.map(() => h('li', { class: 'chip buff' })));
      list.forEach((b, i) => setText(buffs.children[i], `${b.name}: ${b.output ? `+${Math.round(b.output * 100)}% output` : `+${Math.round(b.questSpeed * 100)}% quest speed`}, ${fmtDuration(b.left)}`));
    },
  };
}
