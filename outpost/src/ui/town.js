import { DATA, isWorkplace, liveBuildings } from '../engine/data.js';
import {
  costOf, canAfford, maxAffordable, outputOf, ecoFor, globalMultiplier, nextMilestone, incomeBreakdown,
  secondsToAfford, isUnlocked, levelOf, levelCap, costExceedsStorage, housingCapacity, storageCap,
  workersAt, freeResidents,
} from '../engine/derive.js';
import { buyBuilding, assignWorker, collectTribute, setSetting } from '../engine/actions.js';
import { fmt, fmtRate, fmtDuration } from '../engine/numbers.js';
import { h, setText, setClass, setAttr } from './dom.js';
import { icon } from './icons.js';
import { createResourceStrip } from './resources.js';
import { createTownHall } from './townhall.js';
import { createResidents } from './residents.js';
import { createDefence } from './defence.js';

export { createResourceStrip };

const BUY_CHOICES = [
  { value: 1, label: '1' },
  { value: 10, label: '10' },
  { value: 'max', label: 'Max' },
];

const maxWorkers = DATA.economy.workers.maxPerBuilding;
const bonusPct = Math.round(DATA.economy.workers.bonusEach * 100);

// One line saying what the building does at its current level.
function effectText(state, def, level, mult, mode) {
  const eco = DATA.economy;
  if (def.kind === 'house') {
    const next = eco.housing.perHouseLevel;
    return level > 0
      ? `Houses ${level * next} residents. Each level adds ${next}.`
      : `Each level houses ${next} more residents.`;
  }
  if (def.kind === 'warehouse') {
    const g = eco.caps.perWarehouseLevel;
    return `Raises the limit on lumber, stone and food by ${Math.round((g - 1) * 100)}% per level. Limit now ${fmt(storageCap(state, 'lumber'), mode)}.`;
  }
  if (def.kind === 'tavern') {
    const r = DATA.heroes.roster;
    const p = DATA.heroes.pool;
    return `Roster of ${r.base + Math.floor(level / r.levelsPerSlot)} heroes, one more every ${r.levelsPerSlot} levels. Pool of ${Math.min(p.max, p.base + Math.floor(level / p.levelsPerExtra))}. Raises morale; Rogues join at level 3.`;
  }
  if (def.kind === 'barracks') {
    return `Heroes train ${Math.round(level * DATA.heroes.drill.barracksBonus * 100)}% faster. Each level adds ${Math.round(DATA.heroes.drill.barracksBonus * 100)}%. Hunters join at level 3.`;
  }
  if (def.kind === 'chapel') {
    const inj = DATA.heroes.injury;
    const rate = Math.min(inj.restRateMax, inj.restRateBase + inj.restRatePerChapel * level);
    return `Injured heroes recover at ${rate.toFixed(2)}x speed. Priests join at level 1, Paladins at level 5.`;
  }
  if (def.kind === 'stables') {
    const st = DATA.quests.stables;
    return `Quest travel takes ${Math.round(Math.min(st.max, st.perLevel * level) * 100)}% less time. Each level takes off ${Math.round(st.perLevel * 100)}%, up to ${Math.round(st.max * 100)}%.`;
  }
  if (def.kind === 'wall') {
    const w = DATA.raids.wall;
    return `Adds ${fmt(w.perLevel * level ** w.exp, mode)} Defence against raids. Raids test Defence against a threat that grows with the highest zone cleared.`;
  }
  if (def.kind === 'archives') {
    const per = Math.round(DATA.renown.gain.archivesPerLevel * 100);
    return level > 0
      ? `Adds ${level * per}% to the Renown a Rebuild earns. Each level adds ${per}%.`
      : `Each level adds ${per}% to the Renown a Rebuild earns. Legacy will be kept here in a later build.`;
  }
  const out = DATA.resourceById[def.produces].name.toLowerCase();
  const now = outputOf(state, def, DATA, level);
  const gain = outputOf(state, def, DATA, level + 1) - now;
  if (def.kind === 'converter') {
    const from = DATA.resourceById[def.from].name.toLowerCase();
    const base = `Smelts ${def.ratio} ${from} into 1 ${out}`;
    return level > 0 ? `${base}, up to ${fmtRate(now, mode)} ${out}. Next level adds ${fmt(gain, mode)}.` : `${base}. Level 1 makes up to ${fmtRate(gain, mode)}.`;
  }
  return level > 0
    ? `Makes ${fmtRate(now, mode)} ${out}. Next level adds ${fmt(gain, mode)}.`
    : `Would make ${fmtRate(gain, mode)} ${out} at level 1.`;
}

export function createTown(ctx) {
  const rows = {};
  const buyButtons = {};
  const th = createTownHall(ctx);
  const residents = createResidents();
  const defence = createDefence();

  const tributeLabel = h('span', {});
  const tributeBtn = h(
    'button',
    {
      class: 'btn btn-accent tribute',
      type: 'button',
      onClick: () => {
        const r = ctx.run((s) => collectTribute(s));
        if (r.ok) ctx.pulse(tributeBtn);
      },
    },
    icon('tribute'),
    tributeLabel,
  );

  const seg = h(
    'div',
    { class: 'seg', role: 'radiogroup', 'aria-label': 'Buy amount' },
    BUY_CHOICES.map((c) => {
      const b = h(
        'button',
        {
          class: 'seg-btn',
          type: 'button',
          role: 'radio',
          'aria-checked': 'false',
          onClick: () => ctx.run((s) => setSetting(s, 'buyAmount', c.value)),
        },
        c.label,
      );
      buyButtons[c.value] = b;
      return b;
    }),
  );

  function workerStepper(def) {
    const count = h('span', { class: 'ws-count' });
    const bonus = h('span', { class: 'ws-bonus' });
    const step = (delta, label) =>
      h('button', {
        class: 'btn ws-btn',
        type: 'button',
        'aria-label': `${label} ${def.name}`,
        onClick: () => {
          const r = ctx.run((s) => assignWorker(s, def.id, delta));
          if (r.ok) ctx.saveSoon();
          else ctx.announce(r.error);
        },
      }, delta > 0 ? '+' : '−');
    const minus = step(-1, 'Remove a worker from the');
    const plus = step(1, 'Add a worker to the');
    const el = h('div', { class: 'workers' }, icon('worker'), h('span', { class: 'ws-label' }, 'Workers'), minus, count, plus, bonus);
    return { el, count, bonus, minus, plus };
  }

  const ledger = h(
    'ol',
    { class: 'ledger', 'aria-label': 'Buildings' },
    liveBuildings().map((def) => {
      const r = {};
      r.level = h('span', { class: 'b-level' });
      r.prod = h('p', { class: 'b-prod' });
      r.pips = DATA.economy.milestones.map((m) => h('span', { class: 'pip', title: `Level ${m}` }));
      r.pipText = h('span', { class: 'pip-text' });
      r.pipsRow = isWorkplace(def) ? h('p', { class: 'b-pips' }, h('span', { class: 'pips', 'aria-hidden': 'true' }, r.pips), r.pipText) : null;
      r.workers = isWorkplace(def) ? workerStepper(def) : null;
      r.costs = Object.keys(def.cost).map((id) => {
        const v = h('span', { class: 'cost-v' });
        return { id, v, el: h('span', { class: `cost cost-${id}` }, icon(id), v, h('span', { class: 'sr-only' }, DATA.resourceById[id].name)) };
      });
      r.eta = h('p', { class: 'b-eta' });
      r.btn = h('button', {
        class: 'btn buy',
        type: 'button',
        onClick: () => {
          const amount = ctx.state().settings.buyAmount;
          const res = ctx.run((s) => buyBuilding(s, def.id, amount));
          if (res.ok) {
            ctx.pulse(r.row);
            ctx.announce(`Bought ${res.bought} ${def.name} level${res.bought > 1 ? 's' : ''}. Now level ${res.newLevel}.`);
            ctx.saveSoon();
          } else {
            ctx.announce(res.error);
          }
        },
      });
      r.row = h(
        'li',
        { class: 'building', hidden: true },
        h('div', { class: `b-icon icon-${def.id}` }, icon(def.id)),
        h(
          'div',
          { class: 'b-info' },
          h('div', { class: 'b-head' }, h('h3', { class: 'b-name' }, def.name), r.level),
          h('p', { class: 'b-blurb' }, def.blurb),
          r.prod,
          r.pipsRow,
          r.workers?.el,
        ),
        h('div', { class: 'b-buy' }, h('div', { class: 'costs' }, r.costs.map((c) => c.el)), r.eta, r.btn),
      );
      rows[def.id] = r;
      return r.row;
    }),
  );

  // Buildings that are not available yet, so the player can see what the Town Hall opens up.
  const furtherList = h('ul', { class: 'further-list' });
  const further = h('section', { class: 'card', 'aria-label': 'Further buildings' }, h('h2', { class: 'h-sec' }, 'Further buildings'), furtherList);
  let furtherSig = '';

  const events = h('ul', { class: 'events' });
  const goals = h('ul', { class: 'goals' });
  const aside = h(
    'aside',
    { class: 'aside' },
    residents.el,
    h('section', { class: 'card' }, h('h2', { class: 'h-sec' }, 'Next doublings'), goals),
    h('section', { class: 'card' }, h('h2', { class: 'h-sec' }, 'Recent events'), events),
  );

  const welcomeSlot = h('div', { class: 'welcome-slot' });
  const main = h(
    'div',
    { class: 'town-main' },
    th.el,
    defence.el,
    h('div', { class: 'toolbar' }, tributeBtn, h('div', { class: 'buy-amount' }, h('span', { class: 'toolbar-label', id: 'buy-label' }, 'Buy'), seg)),
    ledger,
    further,
  );
  const el = h('section', { class: 'panel', id: 'panel-town', 'aria-label': 'Town' }, welcomeSlot, h('div', { class: 'town-grid' }, main, aside));

  let lastLogSig = '';

  function update(state, info = incomeBreakdown(state)) {
    const mode = state.settings.numberFormat;
    const incomeTotals = Object.fromEntries(DATA.resources.map((r) => [r.id, info[r.id].total]));
    const mult = globalMultiplier(state);
    const eco = ecoFor(state);
    const cap = levelCap(state);
    const choice = state.settings.buyAmount;

    setText(tributeLabel, `Gather tribute +${fmt(eco.tributeGold * mult, mode)} gold`);
    for (const c of BUY_CHOICES) {
      const on = choice === c.value;
      setAttr(buyButtons[c.value], 'aria-checked', on ? 'true' : 'false');
      setClass(buyButtons[c.value], 'is-on', on);
    }

    th.update(state, info);
    residents.update(state, info);
    defence.update(state);

    const goalList = [];
    for (const def of liveBuildings()) {
      const r = rows[def.id];
      const open = isUnlocked(def, state);
      r.row.hidden = !open;
      if (!open) continue;

      const level = levelOf(state, def.id);
      const room = Math.max(0, cap - level);
      const atLimit = room === 0;
      const n = atLimit ? 1 : choice === 'max' ? Math.max(1, maxAffordable(state.res, def, level, eco, room)) : Math.min(choice, room);
      const cost = costOf(def, level, n, eco);
      const ok = !atLimit && canAfford(state.res, cost);

      setText(r.level, level > 0 ? `Level ${level} of ${cap}` : 'Not built');
      setClass(r.level, 'is-zero', level === 0);
      setText(r.prod, effectText(state, def, level, mult, mode));

      if (r.pipsRow) {
        const ms = nextMilestone(level, eco);
        eco.milestones.forEach((m, i) => setClass(r.pips[i], 'on', level >= m));
        setText(r.pipText, ms ? `Doubles at level ${ms.at}, ${ms.remaining} to go` : 'Every doubling reached');
        if (ms && ms.at <= cap + eco.levelsPerTownHall) goalList.push({ name: def.name, ...ms });
      }

      if (r.workers) {
        const w = workersAt(state, def.id);
        const built = level > 0;
        r.workers.el.hidden = !built;
        setText(r.workers.count, `${w} of ${maxWorkers}`);
        setText(r.workers.bonus, w > 0 ? `+${w * bonusPct}% output` : `+${bonusPct}% each`);
        setAttr(r.workers.minus, 'disabled', w <= 0);
        setAttr(r.workers.plus, 'disabled', w >= maxWorkers || freeResidents(state) <= 0);
      }

      r.costs.forEach((c) => {
        setText(c.v, fmt(cost[c.id], mode));
        setClass(c.el, 'lack', (state.res[c.id] ?? 0) < cost[c.id]);
      });

      const tooBig = atLimit ? null : costExceedsStorage(state, cost);
      if (atLimit) setText(r.eta, `At the Town Hall limit. Upgrade the Town Hall to go beyond level ${cap}.`);
      else if (ok) setText(r.eta, 'Ready to build');
      else if (tooBig) setText(r.eta, `Costs more ${DATA.resourceById[tooBig].name.toLowerCase()} than you can store. Build or upgrade the Warehouse.`);
      else {
        const wait = secondsToAfford(state.res, cost, incomeTotals);
        if (Number.isFinite(wait)) setText(r.eta, `Affordable in ${fmtDuration(wait)}`);
        else {
          const missing = Object.keys(cost).find((id) => (state.res[id] ?? 0) < cost[id] && !(incomeTotals[id] > 0));
          const maker = DATA.buildings.find((b) => b.produces === missing);
          setText(r.eta, `Needs ${maker ? `a ${maker.name}` : DATA.resourceById[missing].name}`);
        }
      }
      setClass(r.eta, 'is-ready', ok);
      setClass(r.eta, 'is-limit', atLimit);

      let label;
      if (atLimit) label = 'At limit';
      else if (choice === 'max') label = ok ? `Buy max (${n})` : 'Buy max';
      else label = `Buy ${n}`;
      setText(r.btn, label);
      setAttr(r.btn, 'disabled', !ok);
      setAttr(r.btn, 'aria-label', `${label} ${def.name}`);
    }

    const locked = DATA.buildings.filter((b) => !isUnlocked(b, state)).sort((a, b) => a.unlockTownHall - b.unlockTownHall);
    const sig = locked.map((b) => b.id).join(',');
    further.hidden = locked.length === 0;
    if (sig !== furtherSig) {
      furtherSig = sig;
      furtherList.replaceChildren(
        ...locked.map((b) =>
          h('li', {},
            h('span', { class: 'fl-icon' }, icon(b.id)),
            h('span', { class: 'fl-name' }, b.name),
            h('span', { class: 'lead' }),
            h('span', { class: 'fl-when' }, b.kind === 'planned' ? `Town Hall ${b.unlockTownHall}, not in this build yet` : `Town Hall ${b.unlockTownHall}`)),
        ),
      );
    }

    goalList.sort((a, b) => a.remaining - b.remaining);
    const goalSig = goalList.slice(0, 3).map((g) => `${g.name}${g.at}${g.remaining}`).join('|');
    if (goals.dataset.sig !== goalSig) {
      goals.dataset.sig = goalSig;
      goals.replaceChildren(
        ...(goalList.length
          ? goalList.slice(0, 3).map((g) => h('li', {}, h('span', {}, g.name), h('span', { class: 'lead' }), h('span', {}, `${g.remaining} to level ${g.at}`)))
          : [h('li', { class: 'muted' }, 'No doubling is near. Raise the Town Hall to reach the next ones.')]),
      );
    }

    const logSig = `${state.log.length}|${state.log[0]?.t}|${state.log[0]?.text}`;
    if (logSig !== lastLogSig) {
      lastLogSig = logSig;
      events.replaceChildren(
        ...(state.log.length
          ? state.log.slice(0, 8).map((e) => h('li', {}, h('time', {}, new Date(e.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })), h('span', {}, e.text)))
          : [h('li', { class: 'muted' }, 'Nothing yet. Build a Lumber Camp to begin.')]),
      );
    }
  }

  return { el, update, welcomeSlot };
}
