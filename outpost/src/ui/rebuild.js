import { DATA } from '../engine/data.js';
import { rebuild, buyUpgrade } from '../engine/rebuild.js';
import { rebuildPreview, renownTotal, upgradeLevel, upgradeCost, valueAt, archivesLevel, totalGold, goldForGain } from '../engine/renown.js';
import { fmt as fmtBig, fmtInt, fmtDuration } from '../engine/numbers.js';
import { h, setText, setClass, setAttr } from './dom.js';
import { icon } from './icons.js';
import { createLegacy } from './legacy.js';

const fmt = (v, mode) => (v < 1000 ? fmtInt(v) : fmtBig(v, mode));
const x2 = (v) => `x${v.toFixed(2)}`;

// What a shop value means, written for its format.
function show(up, v, mode) {
  if (up.format === 'percent') return `${Math.round(v * 100)}%`;
  if (up.format === 'gold') return `${fmt(v, mode)} gold`;
  if (up.format === 'level') return `level ${v}`;
  return `${v}`;
}

const RESETS = [
  'Gold, lumber, stone, food and every other resource',
  'Every building, its workers and your residents',
  'The Town Hall (back to level 1, or your Head Start)',
  'The Tavern and its pool of recruits',
  'The Quest Board, parties on the road and standing orders',
  'Dungeon clears and boss trophies',
  'Potions and the Alchemy Lab queue',
];
const KEEPS = [
  'Every hero: level, gear, talents and the bag',
  'Legacy, Sands of Time, the Hall of Heroes and the Era',
  'Zone standing, story progress and sworn recruits',
  'Renown, the Renown shop and its upgrades',
  'Settings and the event log',
];

export function createRebuild(ctx, { onDone } = {}) {
  let confirming = false;

  const act = (fn, say) => {
    const r = ctx.run(fn);
    if (r.ok) { if (say) ctx.announce(say(r)); ctx.saveSoon(); } else ctx.announce(r.error);
    return r;
  };

  // ---- The Rebuild card ----
  const balance = h('span', { class: 'chip is-story' });
  const multNow = h('span', { class: 'chip' });
  const gainLine = h('p', { class: 'rb-gain' });
  const afterLine = h('p', { class: 'muted' });
  const runLine = h('p', { class: 'muted' });
  const advice = h('p', { class: 'note' });
  const nextLine = h('p', { class: 'muted' });
  const archivesLine = h('p', { class: 'muted' });
  const doBtn = h('button', { class: 'btn btn-accent', type: 'button', id: 'rebuild-start', onClick: () => { confirming = true; ctx.refresh(); } }, 'Rebuild the outpost');
  const sure = h('div', { class: 'rb-confirm', role: 'alertdialog', 'aria-label': 'Confirm Rebuild' });
  const sureText = h('p', {});
  const yesBtn = h('button', {
    class: 'btn btn-danger', type: 'button', id: 'rebuild-confirm',
    onClick: () => {
      const r = act((s) => rebuild(s), (res) => `Rebuilt. ${res.gain} Renown earned.`);
      confirming = false;
      if (r.ok && onDone) onDone();
      ctx.refresh();
    },
  }, 'Yes, rebuild now');
  const noBtn = h('button', { class: 'btn', type: 'button', id: 'rebuild-cancel', onClick: () => { confirming = false; ctx.refresh(); } }, 'Not yet');
  sure.append(sureText, h('div', { class: 'order-ctl' }, yesBtn, noBtn));

  const lists = h('div', { class: 'rb-lists' },
    h('div', {}, h('h4', { class: 'h-sub' }, 'A Rebuild resets'), h('ul', { class: 'rb-list' }, RESETS.map((t) => h('li', {}, t)))),
    h('div', {}, h('h4', { class: 'h-sub' }, 'A Rebuild keeps'), h('ul', { class: 'rb-list' }, KEEPS.map((t) => h('li', {}, t)))));

  const card = h('div', { class: 'card', id: 'rebuild-card' },
    h('div', { class: 'card-head' }, h('div', { class: 'b-icon' }, icon('archives')), h('h2', { class: 'h-sec' }, 'Rebuild'), balance, multNow),
    h('p', { class: 'b-blurb' }, 'Raise the outpost again from the foundations. Your heroes remember everything; the town does not. The gold earned this run turns into Renown, which makes every future town richer.'),
    gainLine, afterLine, runLine, advice, nextLine, archivesLine,
    h('div', { class: 'order-ctl' }, doBtn), sure, lists);

  // ---- The shop ----
  const refs = new Map();
  const branchEls = DATA.renown.branches.map((b) => {
    const ul = h('ul', { class: 'upgrades', 'aria-label': `${b.name} upgrades` });
    for (const up of DATA.renown.upgrades.filter((u) => u.branch === b.id)) {
      const r = { up };
      r.level = h('span', { class: 'chip' });
      r.now = h('span', { class: 'muted' });
      r.cost = h('span', { class: 'rb-cost' });
      r.btn = h('button', { class: 'btn btn-small', type: 'button', onClick: () => act((s) => buyUpgrade(s, up.id), (res) => `${up.name} level ${res.level}.`) }, 'Buy');
      r.el = h('li', { class: 'upgrade' },
        h('span', { class: 'up-text' }, h('strong', {}, up.name), h('span', { class: 'muted' }, up.blurb), r.now),
        r.level, r.cost, r.btn);
      refs.set(up.id, r);
      ul.append(r.el);
    }
    return h('div', { class: 'zone-block' }, h('h4', { class: 'h-sub' }, b.name), h('p', { class: 'muted' }, b.blurb), ul);
  });
  const spendLine = h('p', { class: 'muted' });
  const shop = h('div', { class: 'card', id: 'renown-shop' }, h('h2', { class: 'h-sec' }, 'Renown shop'), spendLine, ...branchEls);

  const legacy = createLegacy({ ...ctx, onEpoch: onDone });
  const el = h('section', { class: 'panel', id: 'panel-rebuild', 'aria-label': 'Rebuild', hidden: true }, card, shop, legacy.el);

  function update(state) {
    legacy.update(state);
    const mode = state.settings.numberFormat;
    const p = rebuildPreview(state);
    const total = renownTotal(state);

    setText(balance, `${fmt(state.prestige.renown, mode)} Renown to spend`);
    setText(multNow, `All production ${x2(p.multiplier)}`);
    setText(gainLine, p.can ? `A Rebuild now earns ${fmt(p.gain, mode)} Renown.` : 'No Renown to earn yet. A Rebuild pays out once the run has earned 10,000 gold.');
    setText(afterLine, p.can ? `Renown earned in total goes from ${fmt(total, mode)} to ${fmt(p.totalAfter, mode)}, raising production from ${x2(p.multiplier)} to ${x2(p.multiplierAfter)}.` : '');
    afterLine.hidden = !p.can;
    setText(runLine, `This run: ${fmt(p.runGold, mode)} gold earned over ${fmtDuration(p.runSeconds)}. All runs: ${fmt(totalGold(state), mode)} gold, ${state.stats.rebuilds} ${state.stats.rebuilds === 1 ? 'Rebuild' : 'Rebuilds'}.`);

    advice.hidden = !p.can;
    setText(advice, p.advised
      ? 'This is a good time: the gain is at least as large as all the Renown you already hold.'
      : `Most players wait until a Rebuild would earn at least ${fmt(p.adviceAt, mode)} Renown. You can go sooner, but the next run will be slower to pay back.`);
    setClass(advice, 'good', p.advised);

    const nextGain = p.gain + 1;
    const goal = goldForGain(nextGain);
    setText(nextLine, p.can ? `The next point of Renown needs about ${fmt(goal, mode)} gold in this run.` : '');
    nextLine.hidden = !p.can;
    const arch = archivesLevel(state);
    setText(archivesLine, arch > 0
      ? `Archives level ${arch} adds ${Math.round(arch * DATA.renown.gain.archivesPerLevel * 100)}% to every Rebuild's Renown.`
      : `The Archives (Town Hall 14) will add ${Math.round(DATA.renown.gain.archivesPerLevel * 100)}% to Renown gain per level.`);

    if (!p.can) confirming = false;
    doBtn.hidden = confirming;
    setAttr(doBtn, 'disabled', !p.can);
    sure.hidden = !confirming;
    const out = state.quests.active.length;
    setText(sureText, `Rebuild for ${fmt(p.gain, mode)} Renown? The town starts again from ${startText(state)}.${out ? ` ${out} ${out === 1 ? 'party' : 'parties'} on the road will come home with nothing.` : ''}`);

    setText(spendLine, `Renown to spend: ${fmt(state.prestige.renown, mode)}. Earned in total: ${fmt(total, mode)}. Spending never lowers the production multiplier, which follows what you have earned.`);
    for (const [id, r] of refs) {
      const up = r.up;
      const level = upgradeLevel(state, id);
      const max = up.values.length;
      const cost = upgradeCost(state, up);
      setText(r.level, `${level} of ${max}`);
      setClass(r.level, 'is-good', level >= max);
      setText(r.now, level > 0
        ? `Now ${show(up, valueAt(up, level), mode)}${level < max ? `, next ${show(up, valueAt(up, level + 1), mode)}` : ', the most there is'}.`
        : `Level 1 gives ${show(up, valueAt(up, 1), mode)}.`);
      r.cost.hidden = cost === null;
      setText(r.cost, cost === null ? '' : `${fmt(cost, mode)} Renown`);
      setClass(r.cost, 'lack', cost !== null && state.prestige.renown < cost);
      r.btn.hidden = cost === null;
      setAttr(r.btn, 'disabled', cost === null || state.prestige.renown < cost);
      setAttr(r.btn, 'aria-label', `Buy ${up.name} level ${level + 1}`);
    }
  }

  return { el, update };
}

function startText(state) {
  const up = DATA.renownById;
  const th = state.prestige.upgrades;
  const hall = th.headstart ? valueAt(up.headstart, th.headstart) : 1;
  return `Town Hall ${hall}${th.foundations ? ' and your Old Foundations' : ''}`;
}
