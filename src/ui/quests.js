import { DATA, isDelve } from '../engine/data.js';
import { questSpeedMultiplier, isHungry } from '../engine/derive.js';
import { heroRating, partyRating, oddsFor, runSeconds, rewardFor, heroXpFor, enemySummary, replayRun, regularCount, boardSize, isStory, isPinned } from '../engine/quests.js';
import { levelOf } from '../engine/derive.js';
import { orderSlots } from '../engine/orders.js';
import { potionStock } from '../engine/alchemy.js';
import { createOrdersPanel } from './orders.js';
import { dispatchQuest, recallQuest, discardOffer, createOrder } from '../engine/actions.js';
import { fmt, fmtDuration } from '../engine/numbers.js';
import { h, setText, setClass, setAttr } from './dom.js';
import { icon } from './icons.js';

const QD = DATA.quests;
const pct = (x) => `${Math.round(x * 100)}%`;
const oddsWord = (p) => (p >= 0.85 ? 'Very likely' : p >= 0.65 ? 'Likely' : p >= 0.4 ? 'A coin toss' : p >= 0.2 ? 'Unlikely' : 'Near hopeless');
const TANKS = new Set(['warrior', 'paladin']);
const HEALERS = new Set(['priest', 'paladin']);

function rewardChips(reward, mode) {
  const chips = [];
  if (reward.gold) chips.push(h('span', { class: 'cost cost-gold' }, icon('gold'), h('span', { class: 'cost-v' }, fmt(reward.gold, mode)), h('span', { class: 'sr-only' }, 'gold')));
  for (const [id, amt] of Object.entries(reward.res)) {
    chips.push(h('span', { class: `cost cost-${id}` }, icon(id), h('span', { class: 'cost-v' }, fmt(amt, mode)), h('span', { class: 'sr-only' }, DATA.resourceById[id].name)));
  }
  return chips;
}

// "1:05 Edric hits ..." -> seconds into the fight
const lineTime = (line) => {
  const m = /^(\d+):(\d{2}) /.exec(line);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
};

function enemyText(offer) {
  const list = enemySummary(offer);
  if (isDelve(offer.type)) {
    const boss = list.at(-1);
    return `${list.length} fights, ending with ${boss.name}. Fights run on their own once the party is inside.`;
  }
  return `Enemies: ${list.map((e) => `${e.count > 1 ? `${e.count} ` : ''}${e.name}${e.count > 1 ? 's' : ''}`).join(', ')}.`;
}

export function createQuests(ctx) {
  const act = (fn, say) => {
    const r = ctx.run(fn);
    if (r.ok) { if (say) ctx.announce(say(r)); ctx.saveSoon(); } else ctx.announce(r.error);
    return r;
  };

  // The party being put together for each offer on the board. UI-only state.
  const picks = new Map();
  const potionPicks = new Map();

  // ---------- Board ----------
  const boardHead = h('p', { class: 'b-prod' });
  const boardNote = h('p', { class: 'muted' });
  const offerList = h('ul', { class: 'offers', 'aria-label': 'Quest offers' });
  const emptyNote = h('p', { class: 'muted' }, 'The board is bare for now. New notices go up every few minutes.');
  const boardCard = h('section', { class: 'card', 'aria-label': 'Quest Board' },
    h('div', { class: 'card-head' }, h('div', { class: 'b-icon' }, icon('quest')), h('div', {}, h('h2', { class: 'h-sec' }, 'Quest Board'), boardHead)),
    boardNote, emptyNote, offerList);

  const cards = new Map();
  let boardSig = '';

  function makeOffer(o) {
    const type = QD.types[o.type];
    const r = { id: o.id, o };
    r.time = h('span', { class: 'chip' });
    r.odds = h('p', { class: 'odds', 'aria-live': 'off' });
    r.rewardLine = h('div', { class: 'costs' });
    r.xpLine = h('p', { class: 'muted' });
    r.roles = h('p', { class: 'muted' });
    r.heroList = h('ul', { class: 'picker', 'aria-label': `Choose a party for ${o.title}` });
    r.rows = new Map();
    r.send = h('button', { class: 'btn btn-accent', type: 'button', onClick: () => {
      const party = [...(picks.get(o.id) ?? [])];
      const res = act((s) => dispatchQuest(s, o.id, party, DATA, potionPicks.get(o.id) || null), () => `Party sent on ${o.title}.`);
      if (res.ok) { picks.delete(o.id); potionPicks.delete(o.id); }
    } }, 'Send the party');
    r.repeat = h('button', { class: 'btn', type: 'button', onClick: () => {
      const party = [...(picks.get(o.id) ?? [])];
      act((s) => createOrder(s, { mode: 'repeat', template: o.template, party, potion: potionPicks.get(o.id) || null }), () => 'Standing order set. The party will keep going on its own.');
    } }, 'Repeat with this party');
    r.potion = h('select', { class: 'select', 'aria-label': 'Potion for this quest', onChange: () => { potionPicks.set(o.id, r.potion.value); ctx.refresh(); } });
    r.potionRow = h('div', { class: 'potion-row' }, h('span', { class: 'toolbar-label' }, 'Potion'), r.potion);
    r.potionSig = '';
    r.drop = h('button', { class: 'btn btn-small', type: 'button', onClick: () => { act((s) => discardOffer(s, o.id), () => 'Notice taken down.'); picks.delete(o.id); } }, 'Take down');
    r.hint = h('p', { class: 'muted' });
    const tpl = DATA.templateById[o.template];
    const chips = [
      h('span', { class: 'chip' }, tpl.label ?? type.name),
      tpl.story ? h('span', { class: 'chip is-story' }, 'Story') : null,
      h('span', { class: 'chip' }, DATA.zoneById[o.zone].name),
      h('span', { class: 'chip' }, `Level ${o.level}`),
      DATA.modifierById[o.modifier].name ? h('span', { class: 'chip is-good' }, DATA.modifierById[o.modifier].name) : null,
      r.time,
    ];
    r.el = h('li', { class: `offer type-${o.type}` },
      h('details', {},
        h('summary', {}, h('span', { class: 'hero-sum' }, h('strong', { class: 'offer-title' }, o.title), ...chips)),
        h('div', { class: 'offer-body' },
          h('p', { class: 'b-blurb' }, o.text),
          h('p', { class: 'muted' }, enemyText(o)),
          h('div', { class: 'offer-rewards' }, h('span', { class: 'toolbar-label' }, 'Reward'), r.rewardLine),
          r.xpLine,
          h('h4', { class: 'h-sub' }, `Party (${type.party[0] === type.party[1] ? type.party[0] : `${type.party[0]} to ${type.party[1]}`})`),
          r.heroList, r.hint, r.roles, r.potionRow, r.odds,
          h('div', { class: 'row' }, r.send, r.repeat, r.drop))));
    return r;
  }

  function heroRow(r, hero) {
    const id = `${r.id}-${hero.id}`;
    const box = h('input', { type: 'checkbox', id, onChange: () => {
      const set = picks.get(r.id) ?? new Set();
      const max = QD.types[r.o.type].party[1];
      if (box.checked) {
        set.add(hero.id);
        while (set.size > max) set.delete(set.values().next().value);
      } else set.delete(hero.id);
      picks.set(r.id, set);
      ctx.refresh();
    } });
    const label = h('label', { for: id }, h('span', { class: 'pk-name' }, hero.name), h('span', { class: 'pk-meta muted' }));
    const li = h('li', { class: 'pick' }, box, label);
    return { li, box, meta: label.querySelector('.pk-meta') };
  }

  function updateBoard(state, mode, speedMul) {
    const q = state.quests;
    const n = q.board.length;
    const reg = regularCount(state);
    const focus = q.focus ? DATA.zoneById[q.focus].name : null;
    setText(boardHead, `${reg} of ${boardSize(state)} notices up${n > reg ? `, plus ${n - reg} story ${n - reg === 1 ? 'notice' : 'notices'}` : ''}. ${state.heroes.length ? '' : 'Recruit a hero first.'}`.trim());
    setText(boardNote, `${reg >= boardSize(state) ? 'The board is full. Take one down or send a party to make room.' : `A new notice goes up in ${fmtDuration(q.refreshIn)}.`} ${focus ? `New notices come from ${focus} (change this in the Zones tab).` : 'New notices come from every open zone.'}`);
    emptyNote.hidden = n > 0;

    const sig = q.board.map((o) => o.id).join(',');
    if (sig !== boardSig) {
      boardSig = sig;
      const keep = new Map();
      for (const o of q.board) keep.set(o.id, cards.get(o.id) ?? makeOffer(o));
      for (const id of cards.keys()) if (!keep.has(id)) picks.delete(id);
      cards.clear();
      for (const [id, r] of keep) cards.set(id, r);
      offerList.replaceChildren(...[...cards.values()].map((r) => r.el));
    }
    const heroSig = state.heroes.map((x) => x.id).join(',');
    const busy = new Set(q.active.flatMap((r) => r.party));
    for (const r of cards.values()) {
      const o = r.o;
      const type = QD.types[o.type];
      if (r.rosterSig !== heroSig) {
        r.rosterSig = heroSig;
        r.rows.clear();
        for (const hero of state.heroes) r.rows.set(hero.id, heroRow(r, hero));
        r.heroList.replaceChildren(...[...r.rows.values()].map((x) => x.li));
      }
      const set = picks.get(o.id) ?? new Set();
      for (const id of [...set]) if (!state.heroes.some((x) => x.id === id) || busy.has(id) || state.heroes.find((x) => x.id === id).injury > 0) set.delete(id);
      setText(r.time, fmtDuration(runSeconds(state, o) / speedMul));
      for (const hero of state.heroes) {
        const row = r.rows.get(hero.id);
        if (!row) continue;
        const hurt = hero.injury > 0;
        const away = busy.has(hero.id);
        row.box.checked = set.has(hero.id);
        setAttr(row.box, 'disabled', hurt || away);
        const cls = DATA.classById[hero.class];
        setText(row.meta, ` Level ${hero.level} ${cls.name} (${cls.role.toLowerCase()}), rating ${fmt(heroRating(state, hero), mode)}${away ? ', away' : hurt ? ', resting' : ''}`);
        setClass(row.li, 'is-off', hurt || away);
      }
      const party = [...set];
      const members = party.map((id) => state.heroes.find((x) => x.id === id)).filter(Boolean);
      const rating = partyRating(state, party);
      const full = party.length >= type.party[0] && party.length <= type.party[1];
      if (isDelve(o.type)) {
        const tank = members.some((m) => TANKS.has(m.class));
        const healer = members.some((m) => HEALERS.has(m.class));
        setText(r.roles, party.length ? `Tank: ${tank ? 'yes' : 'no'}. Healer: ${healer ? 'yes' : 'no'}. Damage dealers: ${members.filter((m) => ['rogue', 'mage', 'hunter'].includes(m.class)).length}.` : 'A dungeon is best faced with a tank, a healer and damage dealers.');
      } else setText(r.roles, '');
      r.roles.hidden = !isDelve(o.type);
      if (party.length) {
        const p = oddsFor(state, o, party, DATA, potionPicks.get(o.id) || null);
        setText(r.odds, `${oddsWord(p)}: ${pct(p)} chance. Measured by fighting it ${isDelve(o.type) ? DATA.combat.odds.dungeonSamples : DATA.combat.odds.samples} times. Party rating ${fmt(rating, mode)}, recommended ${fmt(o.rec, mode)}.`);
        setClass(r.odds, 'is-good', p >= 0.65);
        setClass(r.odds, 'is-bad', p < 0.4);
      } else {
        setText(r.odds, `Recommended party rating ${fmt(o.rec, mode)}. Pick heroes to see the odds.`);
        setClass(r.odds, 'is-good', false);
        setClass(r.odds, 'is-bad', false);
      }
      const reward = rewardFor(state, o, Math.max(1, party.length));
      r.rewardLine.replaceChildren(...rewardChips(reward, mode));
      const loot = isDelve(o.type) ? ' Dungeons drop gear, and the first clear pays more.' : o.type === 'bounty' ? ' Bounties sometimes drop an item.' : o.type === 'slay' ? ' Slay quests often drop gear.' : o.type === 'escort' ? ' Escorts earn standing in the zone.' : '';
      setText(r.xpLine, `${party.length ? `Experience each: about ${fmt(heroXpFor(state, members[0], o), mode)}. ` : ''}A failed quest pays nothing and leaves the party hurt.${loot}`);
      setText(r.hint, type.party[0] === type.party[1] ? '' : o.type === 'gathering' ? 'A second hero adds to the odds and the haul.' : '');
      r.hint.hidden = type.party[0] === type.party[1] || isDelve(o.type);
      if (o.type === 'slay') setText(r.hint, 'A third hero makes it safer.');
      if (o.type === 'escort') setText(r.hint, 'A second hero adds to the odds.');
      const drink = potionPicks.get(o.id) || null;
      const known = DATA.crafting.potions.filter((p) => potionStock(state, p.id) > 0);
      const psig = `${party.length}|${known.map((p) => `${p.id}${potionStock(state, p.id)}`).join(',')}`;
      if (psig !== r.potionSig) {
        r.potionSig = psig;
        r.potion.replaceChildren(h('option', { value: '' }, 'None'), ...known.map((p) => h('option', { value: p.id, disabled: potionStock(state, p.id) < Math.max(1, party.length) }, `${p.name} (${potionStock(state, p.id)} left, ${Math.max(1, party.length)} needed)`)));
        r.potion.value = drink ?? '';
      }
      r.potionRow.hidden = known.length === 0;
      const slots = orderSlots(state);
      const inOrder = state.quests.orders.some((x) => x.party.some((id) => party.includes(id)));
      r.repeat.hidden = slots < 1 || isStory(o);
      setAttr(r.repeat, 'disabled', !full || state.quests.orders.length >= slots || inOrder);
      setAttr(r.repeat, 'title', inOrder ? 'A hero in this party already follows an order' : state.quests.orders.length >= slots ? 'No free order slot' : 'Send this party again and again, as long as it stays healthy');
      r.drop.hidden = isPinned(o, state);
      setAttr(r.send, 'disabled', !full);
      setAttr(r.send, 'aria-label', `Send the party on ${o.title}`);
    }
  }

  // ---------- On the road ----------
  const runList = h('ul', { class: 'runs', 'aria-label': 'Parties on the road' });
  const runEmpty = h('p', { class: 'muted' }, 'Nobody is out. Pick a notice and send a party.');
  const hungerNote = h('p', { class: 'warn-box', hidden: true }, 'The town is hungry, so parties are travelling slowly. Restore the food supply.');
  const runCard = h('section', { class: 'card', 'aria-label': 'On the road' }, h('h2', { class: 'h-sec' }, 'On the road'), hungerNote, runEmpty, runList);
  const runRefs = new Map();
  let runSig = '';

  function bars(count) {
    return Array.from({ length: count }, () => ({
      fill: h('span', { class: 'hpfill' }),
      name: h('span', { class: 'hpname' }),
      val: h('span', { class: 'hpval muted' }),
    })).map((b) => ({ ...b, el: h('li', { class: 'hprow' }, b.name, h('span', { class: 'hpbar' }, b.fill), b.val) }));
  }

  function makeRun(run) {
    const r = { id: run.id, replay: undefined, enemyBars: [], enemyEnc: -1 };
    r.left = h('span', { class: 'chip' });
    r.bar = h('div', { class: 'xpbar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': `Progress on ${run.offer.title}` }, h('span', { class: 'xpfill' }));
    r.fill = r.bar.firstChild;
    r.odds = h('p', { class: 'muted' });
    r.recall = h('button', { class: 'btn btn-small btn-danger', type: 'button', onClick: () => act((s) => recallQuest(s, run.id), () => 'Party called back.') }, 'Call back');
    r.heroBars = bars(run.party.length);
    r.heroList = h('ul', { class: 'hpbars', 'aria-label': 'Party health' }, r.heroBars.map((b) => b.el));
    r.enemyList = h('ul', { class: 'hpbars enemies', 'aria-label': 'Enemy health' });
    r.fightLog = h('ol', { class: 'fightlog', 'aria-label': 'Combat so far' });
    r.fightNote = h('p', { class: 'muted' });
    r.watch = h('details', { class: 'watch' },
      h('summary', {}, 'Watch the fight'),
      h('div', { class: 'fight' }, r.fightNote, r.heroList, r.enemyList, r.fightLog));
    r.el = h('li', { class: 'run' },
      h('div', { class: 'run-head' }, h('strong', {}, run.offer.title), r.left),
      h('p', { class: 'b-blurb' }, `${run.party.length > 1 ? 'Party' : 'Hero'}: `, h('span', { class: 'run-party' })),
      r.bar, r.odds, r.watch, h('div', { class: 'row' }, r.recall));
    r.partyEl = r.el.querySelector('.run-party');
    return r;
  }

  // The fight is already decided, so the view replays it in step with the quest's timer.
  function updateWatch(state, run, r, frac) {
    if (!r.watch.open) return;
    if (r.replay === undefined) r.replay = replayRun(state, run);
    const rp = r.replay;
    if (!rp) { setText(r.fightNote, 'There is no record of this fight; it began before combat was added.'); r.heroList.hidden = true; return; }
    setText(r.fightNote, 'Watching shows how the fight goes, including whether it is won.');
    const at = frac * rp.seconds;
    let frame = rp.frames[0];
    for (const f of rp.frames) { if (f.t <= at) frame = f; else break; }
    if (!frame) return;
    run.units.forEach((u, i) => {
      const b = r.heroBars[i];
      setText(b.name, u.name);
      b.fill.style.width = `${Math.round(frame.h[i] * 100)}%`;
      setText(b.val, frame.h[i] <= 0 ? 'down' : `${Math.round(frame.h[i] * 100)}%`);
      setClass(b.el, 'is-down', frame.h[i] <= 0);
    });
    if (r.enemyEnc !== frame.e || r.enemyBars.length !== frame.n.length) {
      r.enemyEnc = frame.e;
      r.enemyBars = bars(frame.n.length);
      r.enemyList.replaceChildren(...r.enemyBars.map((b) => b.el));
    }
    const names = rp.encounters[frame.e]?.enemies ?? [];
    frame.n.forEach((v, i) => {
      const b = r.enemyBars[i];
      setText(b.name, names[i] ?? 'Reinforcement');
      b.fill.style.width = `${Math.round(Math.max(0, v) * 100)}%`;
      setText(b.val, v <= 0 ? 'down' : `${Math.round(v * 100)}%`);
      setClass(b.el, 'is-down', v <= 0);
    });
    const lines = rp.log.filter((l) => lineTime(l) <= at).slice(-8);
    const sig = lines.join('\n');
    if (sig !== r.logSig) {
      r.logSig = sig;
      r.fightLog.replaceChildren(...lines.map((l) => h('li', {}, l)));
    }
  }

  function updateRuns(state, speedMul) {
    const runs = state.quests.active;
    runEmpty.hidden = runs.length > 0;
    hungerNote.hidden = !isHungry(state);
    const sig = runs.map((x) => x.id).join(',');
    if (sig !== runSig) {
      runSig = sig;
      const keep = new Map(runs.map((x) => [x.id, runRefs.get(x.id) ?? makeRun(x)]));
      runRefs.clear();
      for (const [k, v] of keep) runRefs.set(k, v);
      runList.replaceChildren(...[...runRefs.values()].map((x) => x.el));
    }
    for (const run of runs) {
      const r = runRefs.get(run.id);
      const frac = 1 - run.remaining / run.total;
      setText(r.left, `${fmtDuration(run.remaining / speedMul)} left`);
      r.fill.style.width = `${Math.round(frac * 100)}%`;
      setAttr(r.bar, 'aria-valuenow', Math.round(frac * 100));
      setText(r.partyEl, run.party.map((id) => state.heroes.find((x) => x.id === id)?.name ?? '?').join(' and '));
      setText(r.odds, `${pct(run.chance)} chance of success.${run.potion ? ` Drinking ${DATA.potionById[run.potion].name}.` : ''}${run.order ? ' On a standing order.' : ''}`);
      updateWatch(state, run, r, frac);
    }
  }

  // ---------- Results ----------
  const histList = h('ul', { class: 'history', 'aria-label': 'Recent results' });
  const histEmpty = h('p', { class: 'muted' }, 'Nothing finished yet.');
  const histStats = h('p', { class: 'muted' });
  const histCard = h('section', { class: 'card', 'aria-label': 'Recent results' }, h('h2', { class: 'h-sec' }, 'Recent results'), histStats, histEmpty, histList);
  let histSig = '';

  function updateHistory(state, mode) {
    const hist = state.quests.history;
    histEmpty.hidden = hist.length > 0;
    const trophies = Object.values(state.zones).reduce((a, z) => a + (z.trophies ?? 0), 0);
    setText(histStats, `${state.stats.questsDone} completed, ${state.stats.questsFailed} failed. Recent wins lift morale.${trophies ? ` Boss trophies: ${trophies}.` : ''}`);
    const sig = hist.map((e) => e.n).join(',');
    if (sig === histSig) return;
    histSig = sig;
    histList.replaceChildren(...hist.slice(0, 12).map((e) => {
      const bits = [];
      if (e.gold) bits.push(`${fmt(e.gold, mode)} gold`);
      for (const [id, amt] of Object.entries(e.res)) bits.push(`${fmt(amt, mode)} ${DATA.resourceById[id].name.toLowerCase()}`);
      if (e.ok) bits.push(`${fmt(e.xp, mode)} experience`);
      const text = e.ok ? `: ${bits.join(', ')}` : ` came home hurt${e.where ? ` ${e.where}` : ''}`;
      const extra = [];
      if (e.firstClear) extra.push('First clear: triple gold and a trophy.');
      if (e.story) extra.push('The story moves on.');
      if (e.rep) extra.push(`Standing +${e.rep}.`);
      if (e.tierUp) extra.push(`Standing is now ${e.tierUp}.`);
      if (e.opened?.length) extra.push(`${e.opened.join(' and ')} opened.`);
      if (e.stolen > 0) extra.push(`Brigands took ${pct(e.stolen)} of the gold.`);
      if (e.loot?.length) extra.push(`Found: ${e.loot.join(', ')}.`);
      if (e.sold > 0) extra.push(`The bag was full, so spare gear sold for ${fmt(e.sold, mode)} gold.`);
      return h('li', { class: 'result' },
        h('span', { class: `chip ${e.ok ? 'is-good' : 'is-bad'}` }, e.ok ? 'Won' : 'Failed'),
        h('div', { class: 'result-body' },
          h('span', {}, h('strong', {}, e.title), h('span', { class: 'muted' }, ` ${e.party.join(' and ')}${text}`)),
          extra.length ? h('span', { class: 'muted' }, extra.join(' ')) : null,
          e.log?.length ? h('details', { class: 'combat-log' }, h('summary', {}, 'Combat log'), h('ol', { class: 'fightlog' }, e.log.map((l) => h('li', {}, l)))) : null));
    }));
  }

  const orders = createOrdersPanel(ctx);
  const el = h('section', { class: 'panel', id: 'panel-quests', 'aria-label': 'Quests', hidden: true },
    h('div', { class: 'heroes-grid' }, h('div', { class: 'town-main' }, boardCard), h('aside', { class: 'aside' }, runCard, orders.el, histCard)));

  function update(state) {
    const mode = state.settings.numberFormat;
    const speedMul = questSpeedMultiplier(state);
    updateBoard(state, mode, speedMul);
    updateRuns(state, speedMul);
    updateHistory(state, mode);
    orders.update(state);
  }
  return { el, update };
}
