import { DATA } from '../engine/data.js';
import { buyTownHall } from '../engine/actions.js';
import { levelCap, canAfford, secondsToAfford, costExceedsStorage, townHallCostFor } from '../engine/derive.js';
import { fmt, fmtDuration } from '../engine/numbers.js';
import { h, setText, setClass, setAttr } from './dom.js';
import { icon } from './icons.js';

// Town Hall card: current level, the building limit it sets, and the next upgrade.
export function createTownHall(ctx) {
  const level = h('span', { class: 'b-level' });
  const limit = h('p', { class: 'b-prod' });
  const unlocks = h('p', { class: 'b-blurb' });
  const costs = h('div', { class: 'costs' });
  const eta = h('p', { class: 'b-eta' });
  const btn = h('button', {
    class: 'btn btn-accent buy',
    type: 'button',
    onClick: () => {
      const r = ctx.run((s) => buyTownHall(s));
      if (r.ok) {
        ctx.pulse(el);
        ctx.announce(`Town Hall is now level ${r.level}.${r.opened.length ? ` Unlocked: ${r.opened.join(', ')}.` : ''}`);
        ctx.saveSoon();
      } else ctx.announce(r.error);
    },
  });
  const el = h(
    'section',
    { class: 'card townhall', 'aria-label': 'Town Hall' },
    h('div', { class: 'th-head' }, h('div', { class: 'b-icon' }, icon('town_hall')), h('div', {}, h('div', { class: 'b-head' }, h('h2', { class: 'b-name' }, 'Town Hall'), level), limit)),
    unlocks,
    h('div', { class: 'b-buy' }, costs, eta, btn),
  );
  let costSig = '';

  function update(state, info) {
    const mode = state.settings.numberFormat;
    const th = state.town.townHall;
    const max = DATA.townHall.maxLevel;
    setText(level, `Level ${th} of ${max}`);
    setText(limit, `Buildings can reach level ${levelCap(state)}.`);

    if (th >= max) {
      unlocks.hidden = true;
      costs.replaceChildren();
      costSig = '';
      setText(eta, 'The Town Hall is at its highest level.');
      setText(btn, 'Fully upgraded');
      setAttr(btn, 'disabled', true);
      return;
    }
    const next = th + 1;
    const cost = townHallCostFor(state, next);
    const opened = DATA.buildings.filter((b) => b.unlockTownHall === next);
    unlocks.hidden = false;
    setText(unlocks, `Level ${next} raises the limit to ${levelCap({ town: { townHall: next } })}${opened.length ? ` and unlocks ${opened.map((b) => (b.kind === 'planned' ? `${b.name} (not in this build yet)` : b.name)).join(', ')}` : ''}.`);

    const sig = Object.keys(cost).join(',');
    if (sig !== costSig) {
      costSig = sig;
      costs.replaceChildren(...Object.keys(cost).map((id) => h('span', { class: `cost cost-${id}`, 'data-res': id }, icon(id), h('span', { class: 'cost-v' }), h('span', { class: 'sr-only' }, DATA.resourceById[id].name))));
    }
    for (const c of costs.children) {
      const id = c.dataset.res;
      setText(c.querySelector('.cost-v'), fmt(cost[id], mode));
      setClass(c, 'lack', (state.res[id] ?? 0) < cost[id]);
    }

    const ok = canAfford(state.res, cost);
    const tooBig = costExceedsStorage(state, cost);
    if (ok) setText(eta, 'Ready to upgrade');
    else if (tooBig) setText(eta, `Needs more ${DATA.resourceById[tooBig].name.toLowerCase()} storage than you have. Build or upgrade the Warehouse.`);
    else {
      const income = Object.fromEntries(DATA.resources.map((r) => [r.id, info[r.id].total]));
      const wait = secondsToAfford(state.res, cost, income);
      if (Number.isFinite(wait)) setText(eta, `Affordable in ${fmtDuration(wait)}`);
      else {
        const missing = Object.keys(cost).find((id) => (state.res[id] ?? 0) < cost[id] && !(income[id] > 0));
        const maker = DATA.buildings.find((b) => b.produces === missing);
        setText(eta, `Needs ${maker ? `a ${maker.name}` : DATA.resourceById[missing].name}`);
      }
    }
    setClass(eta, 'is-ready', ok);
    setText(btn, `Upgrade to level ${next}`);
    setAttr(btn, 'disabled', !ok);
  }
  return { el, update };
}
