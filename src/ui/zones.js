import { DATA } from '../engine/data.js';
import { zoneOpen, zoneState, repInfo, storySteps, storyDone, recruitStatus, swornCost, perks } from '../engine/zones.js';
import { recruitSworn, setQuestFocus } from '../engine/actions.js';
import { fmt as fmtBig, fmtInt } from '../engine/numbers.js';
const fmt = (v, mode) => (v < 1000 ? fmtInt(v) : fmtBig(v, mode));
import { h, setText, setClass, setAttr } from './dom.js';
import { icon } from './icons.js';

const pct = (x) => `${Math.round(x * 100)}%`;
const gateText = (z) => {
  if (!z.gate) return 'Open from the start.';
  const t = DATA.templateById[z.gate.dungeon];
  const hall = z.gate.townHall ? ` and raise the Town Hall to level ${z.gate.townHall}` : '';
  return `Clear ${t.title} in ${DATA.zoneById[z.gate.zone].name}${hall} to open this zone.`;
};

export function createZones(ctx) {
  const act = (fn, say) => {
    const r = ctx.run(fn);
    if (r.ok) { if (say) ctx.announce(say(r)); ctx.saveSoon(); } else ctx.announce(r.error);
    return r;
  };
  const refs = new Map();

  function makeLive(z) {
    const r = { z };
    r.state = h('span', { class: 'chip' });
    r.focus = h('span', { class: 'chip is-good' }, 'Quests posted from here');
    r.focusBtn = h('button', { class: 'btn btn-small', type: 'button', onClick: () => act((s) => setQuestFocus(s, s.quests.focus === z.id ? null : z.id), () => 'Quest posting changed.') });
    r.gate = h('p', { class: 'muted' });
    r.headline = h('p', {});
    r.repTitle = h('strong', {});
    r.repTier = h('span', { class: 'chip' });
    r.repBar = h('div', { class: 'xpbar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': `Standing in ${z.name}` }, h('span', { class: 'xpfill' }));
    r.repFill = r.repBar.firstChild;
    r.repText = h('p', { class: 'muted' });
    r.perk = h('p', { class: 'muted' });
    r.steps = storySteps(z.id).map((t) => {
      const li = h('li', { class: 'step' }, h('span', { class: 'chip' }), h('span', { class: 'step-text' }, h('strong', {}, t.title), h('span', { class: 'muted' }, t.text)));
      return { t, li, chip: li.firstChild };
    });
    r.recruits = DATA.zonesData.recruits.filter((x) => x.zone === z.id).map((x) => {
      const btn = h('button', { class: 'btn btn-small', type: 'button', onClick: () => act((s) => recruitSworn(s, x.id), (res) => `${res.hero.name} swore to serve the outpost.`) }, 'Recruit');
      const status = h('span', { class: 'muted' });
      const li = h('li', { class: 'recruit' }, h('span', { class: 'rc-text' }, h('strong', {}, x.name), h('span', { class: 'muted' }, `${DATA.raceById[x.race].name} ${DATA.classById[x.class].name}, level ${x.level}. ${x.blurb}`), status), btn);
      return { x, li, btn, status };
    });
    r.open = h('div', { class: 'zone-body' },
      h('div', { class: 'zone-block' }, h('h4', { class: 'h-sub' }, 'Standing'),
        h('div', { class: 'rep-line' }, r.repTitle, r.repTier), r.repBar, r.repText, r.perk),
      h('div', { class: 'zone-block' }, h('h4', { class: 'h-sub' }, 'Story'), h('ol', { class: 'steps' }, r.steps.map((x) => x.li))),
      h('div', { class: 'zone-block' }, h('h4', { class: 'h-sub' }, 'Sworn recruits'), h('ul', { class: 'recruits' }, r.recruits.map((x) => x.li))));
    r.el = h('li', { class: 'zone' },
      h('div', { class: 'zone-head' }, h('div', { class: 'b-icon' }, icon('zone')), h('h3', {}, z.name), h('span', { class: 'chip' }, `Levels ${z.levels[0]} to ${z.levels[1]}`), r.state, r.focus, r.focusBtn),
      h('p', { class: 'b-blurb' }, z.blurb), r.headline, r.gate, r.open);
    return r;
  }

  function makePlanned(z) {
    return { el: h('li', { class: 'zone is-locked' },
      h('div', { class: 'zone-head' }, h('div', { class: 'b-icon' }, icon('zone')), h('h3', {}, z.name), h('span', { class: 'chip' }, `Levels ${z.levels[0]} to ${z.levels[1]}`), h('span', { class: 'chip' }, 'Later build')),
      h('p', { class: 'muted' }, `Headline challenge: ${z.headline}. Opens with: ${z.gateText}. This zone arrives in a later checkpoint.`)) };
  }

  const list = h('ul', { class: 'zones', 'aria-label': 'Zones' });
  for (const z of DATA.zoneList) { const r = makeLive(z); refs.set(z.id, r); list.append(r.el); }
  for (const z of DATA.plannedZones) list.append(makePlanned(z).el);

  const summary = h('p', { class: 'muted' });
  const el = h('section', { class: 'panel', id: 'panel-zones', 'aria-label': 'Zones', hidden: true },
    h('div', { class: 'card' }, h('h2', { class: 'h-sec' }, 'Zones'), summary, list));

  function update(state) {
    const mode = state.settings.numberFormat;
    const bonus = perks(state);
    const bits = [];
    if (bonus.gold) bits.push(`+${pct(bonus.gold)} quest gold`);
    if (bonus.res) bits.push(`+${pct(bonus.res)} gathered resources`);
    if (bonus.xp) bits.push(`+${pct(bonus.xp)} experience`);
    setText(summary, `Clear each zone's headline dungeon to open the next. Quests raise your standing; higher standing pays more and unlocks a title, recruits and, at the top, a permanent bonus that a Rebuild keeps.${bits.length ? ` Permanent bonuses so far: ${bits.join(', ')}.` : ''}`);
    for (const [id, r] of refs) {
      const z = r.z;
      // A zone of a later Era stays out of sight until that Era begins.
      r.el.hidden = (z.era ?? 1) > (state.era ?? 1);
      if (r.el.hidden) continue;
      const open = zoneOpen(state, id);
      const zs = zoneState(state, id);
      setClass(r.el, 'is-locked', !open);
      setText(r.state, open ? 'Open' : 'Locked');
      setClass(r.state, 'is-good', open);
      r.focus.hidden = !(open && state.quests.focus === id);
      r.focusBtn.hidden = !open;
      setText(r.focusBtn, state.quests.focus === id ? 'Post from every zone' : 'Post quests from here');
      r.gate.hidden = open;
      setText(r.gate, gateText(z));
      const head = DATA.templateById[z.headline];
      const done = zs.cleared.includes(head.id);
      setText(r.headline, `Headline: ${head.title}${head.label ? ` (${head.label.toLowerCase()})` : ''}. ${done ? 'Cleared.' : 'Not cleared yet.'}${zs.trophies ? ` Boss trophies here: ${zs.trophies}.` : ''}`);
      r.open.hidden = !open;
      if (!open) continue;
      const info = repInfo(state, id);
      setText(r.repTitle, info.title);
      setText(r.repTier, `${info.tier.name} (reward x${info.tier.reward.toFixed(2)})`);
      r.repFill.style.width = `${Math.round(info.fraction * 100)}%`;
      setAttr(r.repBar, 'aria-valuenow', Math.round(info.fraction * 100));
      setText(r.repText, info.next ? `${fmt(info.rep, mode)} of ${fmt(info.next.at, mode)} standing to reach ${info.next.name}. Bounties give ${DATA.zonesData.reputation.gain.bounty}, slay quests ${DATA.zonesData.reputation.gain.slay}, escorts ${DATA.zonesData.reputation.gain.escort}, dungeons ${DATA.zonesData.reputation.gain.dungeon}, story steps more.` : 'Top standing reached.');
      setText(r.perk, `Top standing perk: ${z.perk.text}.${info.top ? ' Earned and kept.' : ''}`);
      const sd = storyDone(state, id);
      for (const x of r.steps) {
        const step = x.t.story.step;
        const posted = state.quests.board.some((o) => o.template === x.t.id);
        const out = state.quests.active.some((run) => run.offer.template === x.t.id);
        const label = step <= sd ? 'Told' : out ? 'On the road' : step === sd + 1 ? (posted ? 'On the Quest Board' : 'Next') : 'Later';
        setText(x.chip, label);
        setClass(x.chip, 'is-good', step <= sd);
        setClass(x.chip, 'is-story', step === sd + 1);
        setClass(x.li, 'is-done', step <= sd);
      }
      for (const x of r.recruits) {
        const st = recruitStatus(state, x.x);
        const cost = swornCost(state, x.x);
        setText(x.status, st.hired ? 'Serving the outpost.' : st.met ? `Ready to swear: ${fmt(cost, mode)} gold.` : st.why);
        x.btn.hidden = st.hired || !st.met;
        setText(x.btn, `Recruit for ${fmt(cost, mode)}`);
        setAttr(x.btn, 'disabled', state.res.gold < cost);
      }
    }
  }
  return { el, update };
}
