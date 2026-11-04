import { DATA } from '../engine/data.js';
import { levelOf } from '../engine/derive.js';
import {
  xpToNext, sheetOf, rosterCap, recruitCost, refreshCost, drillRate, pendingTalents, itemValue,
  classUnlocked, restRate, heroCap,
} from '../engine/heroes.js';
import { heirsOf } from '../engine/heirs.js';
import {
  recruitHero, refreshPool, toggleLock, equipItem, unequipSlot, chooseTalent, craftItem, craftCost, sellItem, setSaveSignature,
} from '../engine/actions.js';
import { fmt, fmtDuration } from '../engine/numbers.js';
import { h, setText, setClass, setAttr } from './dom.js';
import { icon } from './icons.js';

const HD = DATA.heroes;
const nameOf = (list, id) => list.find((x) => x.id === id)?.name ?? id;
const statName = (id) => nameOf(HD.stats, id);
const raceName = (id) => DATA.raceById[id].name;
const className = (id) => DATA.classById[id].name;
const lineText = (l) => `+${Math.round(l.value * 10) / 10} ${statName(l.stat)}`;
const itemLines = (it) => it.lines.map(lineText).join(', ');

// A one-line item: name coloured by rarity, with its stat lines.
function itemSpan(item) {
  return h('span', { class: `item r-${item.rarity}` }, h('span', { class: 'item-name' }, item.name), h('span', { class: 'item-lines' }, itemLines(item)));
}

function costChip(id, amount, lacking, mode) {
  return h('span', { class: `cost cost-${id}${lacking ? ' lack' : ''}`, 'data-res': id }, icon(id), h('span', { class: 'cost-v' }, fmt(amount, mode)), h('span', { class: 'sr-only' }, DATA.resourceById[id].name));
}

export function createHeroes(ctx) {
  const act = (fn, say) => {
    const r = ctx.run(fn);
    if (r.ok) { if (say) ctx.announce(say(r)); ctx.saveSoon(); } else ctx.announce(r.error);
    return r;
  };

  // ---------- Tavern ----------
  const rosterLine = h('p', { class: 'b-prod' });
  const timerLine = h('p', { class: 'muted' });
  const candList = h('ul', { class: 'cands', 'aria-label': 'Adventurers at the Tavern' });
  const refreshBtn = h('button', { class: 'btn', type: 'button', onClick: () => act((s) => refreshPool(s), () => 'New faces at the Tavern.') });
  const tavernCard = h('section', { class: 'card', 'aria-label': 'Tavern' },
    h('div', { class: 'card-head' }, h('div', { class: 'b-icon' }, icon('tavern')), h('div', {}, h('h2', { class: 'h-sec' }, 'Tavern'), rosterLine)),
    timerLine, candList, h('div', { class: 'row' }, refreshBtn));
  let candSig = '';
  let candRefs = [];

  function updateTavern(state, mode) {
    const cap = rosterCap(state);
    const n = state.heroes.length;
    setText(rosterLine, `Roster ${n} of ${cap}. ${cap > n ? '' : 'Raise the Tavern for more room.'}`.trim());
    setText(timerLine, `New faces arrive in ${fmtDuration(state.tavern.refreshIn)}.`);
    // Heirs of retired heroes wait beside the ordinary candidates.
    const pool = [...heirsOf(state), ...(state.tavern.pool ?? [])];
    const sig = pool.map((c) => `${c.id}${c.hired ? 'x' : ''}`).join(',');
    if (sig !== candSig) {
      candSig = sig;
      candRefs = pool.map((c) => {
        const ref = { c };
        ref.cost = h('span', { class: 'cost cost-gold' }, icon('gold'), h('span', { class: 'cost-v' }), h('span', { class: 'sr-only' }, 'Gold'));
        ref.btn = h('button', { class: 'btn buy', type: 'button', onClick: () => act((s) => recruitHero(s, c.id), (r) => `${r.hero.name} joined.`) }, 'Recruit');
        ref.stats = h('p', { class: 'b-prod' });
        const cls = DATA.classById[c.class];
        ref.el = c.hired
          ? h('li', { class: 'cand is-hired' }, h('p', { class: 'cand-sub' }, h('strong', {}, c.name), ` joined the outpost.`))
          : h('li', { class: 'cand' },
          h('div', { class: 'cand-info' },
            h('div', { class: 'b-head' }, h('h3', { class: 'b-name' }, c.name), h('span', { class: 'b-level' }, `Level ${c.level}`)),
            h('p', { class: 'cand-sub' }, `${raceName(c.race)} ${cls.name}, ${cls.role.toLowerCase()}`),
            c.heir ? h('p', { class: 'b-blurb is-heir' }, `Heir of ${c.ancestor.name}: born ${Math.round(c.ancestor.bonus * 100)}% stronger in health and power, and recruited at a discount.`) : null,
            h('p', { class: 'b-blurb' }, `${DATA.traitById[c.trait].name}: ${DATA.traitById[c.trait].text}. ${DATA.raceById[c.race].passive}.`),
            ref.stats,
            h('p', { class: 'b-blurb' }, 'Arrives with ', itemSpan(c.starter))),
          h('div', { class: 'b-buy' }, ref.cost, ref.btn));
        return ref;
      });
      candList.replaceChildren(...candRefs.map((r) => r.el));
    }
    for (const ref of candRefs) {
      if (ref.c.hired) continue;
      const c = ref.c;
      const cost = recruitCost(state, c);
      const lack = state.res.gold < cost;
      setText(ref.cost.querySelector('.cost-v'), fmt(cost, mode));
      setClass(ref.cost, 'lack', lack);
      const full = state.heroes.length >= cap;
      setAttr(ref.btn, 'disabled', lack || full);
      setAttr(ref.btn, 'aria-label', `Recruit ${c.name}`);
      const preview = sheetOf(state, { id: 'x', name: c.name, race: c.race, class: c.class, trait: c.trait, level: c.level, xp: 0, talents: [], gear: { weapon: c.starter }, lock: false, injury: 0, ancestor: c.ancestor });
      setText(ref.stats, `Health ${fmt(preview.hp, mode)}, power ${fmt(preview.power, mode)}${preview.healing > preview.power ? `, healing ${fmt(preview.healing, mode)}` : ''}.`);
    }
    candList.hidden = pool.length === 0;
    const cost = refreshCost(state);
    setText(refreshBtn, `Ask around for ${fmt(cost, mode)} gold`);
    setAttr(refreshBtn, 'disabled', state.res.gold < cost);
  }

  // ---------- Roster ----------
  const rosterList = h('ul', { class: 'heroes' });
  const rosterEmpty = h('p', { class: 'muted' }, 'Nobody yet. Recruit someone at the Tavern.');
  const rosterCard = h('section', { class: 'card', 'aria-label': 'Roster' }, h('h2', { class: 'h-sec' }, 'Roster'), rosterEmpty, rosterList);
  const cards = new Map();
  let rosterSig = '';

  function makeHeroCard(id) {
    const r = { id };
    r.name = h('h3', { class: 'b-name' });
    r.sub = h('span', { class: 'b-level' });
    r.status = h('span', { class: 'chip' });
    r.xpText = h('p', { class: 'muted' });
    r.xpBar = h('div', { class: 'xpbar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('span', { class: 'xpfill' }));
    r.stats = HD.stats.map((st) => ({ id: st.id, v: h('dd', {}), el: null }));
    const statGrid = h('dl', { class: 'statgrid' }, HD.stats.map((st, i) => h('div', { title: st.blurb }, h('dt', {}, st.short), r.stats[i].v)));
    r.derived = {};
    const dlist = [['hp', 'Health'], ['power', 'Power'], ['crit', 'Crit'], ['haste', 'Haste'], ['healing', 'Healing'], ['regen', 'Regen'], ['armour', 'Armour'], ['threat', 'Threat']];
    const derivedGrid = h('dl', { class: 'statgrid derived' }, dlist.map(([k, label]) => { const v = h('dd', {}); r.derived[k] = v; return h('div', {}, h('dt', {}, label), v); }));
    r.slots = {};
    const slotRows = DATA.gear.slots.map((sl) => {
      const cell = h('span', { class: 'slot-item' });
      const btn = h('button', { class: 'btn btn-small', type: 'button', onClick: () => act((s) => unequipSlot(s, id, sl.id), () => `${sl.name} removed.`) }, 'Remove');
      r.slots[sl.id] = { cell, btn, sig: '' };
      return h('li', {}, h('span', { class: 'slot-name' }, sl.name), cell, btn);
    });
    r.lockBox = h('input', { type: 'checkbox', onChange: () => act((s) => toggleLock(s, id)) });
    r.talents = h('div', { class: 'talents' });
    r.talentSig = '';
    r.abilities = h('ul', { class: 'abilities' });
    r.abilityFor = '';
    r.saveBox = h('input', { type: 'checkbox', onChange: () => act((s) => setSaveSignature(s, id, r.saveBox.checked)) });
    r.saveText = h('span', {});
    r.body = h('div', { class: 'hero-body' },
      r.xpBar, r.xpText, statGrid, derivedGrid,
      h('h4', { class: 'h-sub' }, 'Gear'), h('ul', { class: 'slots' }, slotRows),
      h('label', { class: 'lock' }, r.lockBox, h('span', {}, 'Hold gear: no auto-equip for this hero')),
      h('h4', { class: 'h-sub' }, 'Talents'), r.talents,
      h('h4', { class: 'h-sub' }, 'Abilities'), r.abilities,
      h('label', { class: 'lock' }, r.saveBox, r.saveText));
    r.trait = h('p', { class: 'b-blurb' });
    r.el = h('li', { class: 'hero' },
      h('details', {}, h('summary', {}, h('span', { class: 'hero-sum' }, r.name, r.sub, r.status)), r.trait, r.body));
    return r;
  }

  function updateHero(state, hero, r, mode) {
    const cls = DATA.classById[hero.class];
    const sheet = sheetOf(state, hero);
    setText(r.name, hero.name);
    setText(r.sub, `Level ${hero.level} ${raceName(hero.race)} ${cls.name}${hero.ancestor ? `, heir of ${hero.ancestor.name}` : ''}`);
    const injured = hero.injury > 0;
    const away = state.quests.active.some((x) => x.party.includes(hero.id));
    setText(r.status, injured ? `Resting ${fmtDuration(hero.injury / restRate(state, hero))}` : away ? 'On a quest' : 'Ready');
    setClass(r.status, 'is-bad', injured);
    setClass(r.status, 'is-good', !injured);
    setText(r.trait, `${cls.role}. ${cls.ability.name}: ${cls.ability.text}. ${DATA.traitById[hero.trait].name}: ${DATA.traitById[hero.trait].text}. ${DATA.raceById[hero.race].passive}.`);

    const next = xpToNext(hero.level);
    const cap = heroCap(state);
    const max = hero.level >= cap;
    const pct = max ? 100 : Math.min(100, (hero.xp / next) * 100);
    r.xpBar.firstChild.style.width = `${pct.toFixed(1)}%`;
    setAttr(r.xpBar, 'aria-valuenow', Math.round(pct));
    setAttr(r.xpBar, 'aria-label', `${hero.name} experience`);
    if (max) setText(r.xpText, 'Maximum level.');
    else if (injured) setText(r.xpText, `${fmt(hero.xp, mode)} of ${fmt(next, mode)} experience. Resting, so no training.`);
    else if (drillRate(state, hero) > 0) setText(r.xpText, `${fmt(hero.xp, mode)} of ${fmt(next, mode)} experience. Drilling in the yard.`);
    else setText(r.xpText, `${fmt(hero.xp, mode)} of ${fmt(next, mode)} experience. The yard teaches only up to level ${HD.drill.maxLevel}; quests teach more.`);

    HD.stats.forEach((st, i) => setText(r.stats[i].v, fmt(sheet.stats[st.id], mode)));
    setText(r.derived.hp, fmt(sheet.hp, mode));
    setText(r.derived.power, fmt(sheet.power, mode));
    setText(r.derived.crit, `${fmt(sheet.crit, mode)}%`);
    setText(r.derived.haste, `${sheet.haste.toFixed(2)}x`);
    setText(r.derived.healing, fmt(sheet.healing, mode));
    setText(r.derived.regen, `${fmt(sheet.regen, mode)}/s`);
    setText(r.derived.armour, fmt(sheet.armour, mode));
    setText(r.derived.threat, `${sheet.threat.toFixed(1)}x`);

    for (const sl of DATA.gear.slots) {
      const ref = r.slots[sl.id];
      const item = hero.gear[sl.id];
      const sig = item ? `${item.id}` : '';
      if (sig !== ref.sig) {
        ref.sig = sig;
        ref.cell.replaceChildren(item ? itemSpan(item) : h('span', { class: 'muted' }, 'Empty'));
      }
      setAttr(ref.btn, 'disabled', !item);
      setAttr(ref.btn, 'aria-label', `Remove ${sl.name} from ${hero.name}`);
      ref.btn.hidden = !item;
    }
    r.lockBox.checked = hero.lock;
    if (r.abilityFor !== hero.class) {
      r.abilityFor = hero.class;
      const abs = DATA.combat.classes[hero.class].abilities;
      r.abilities.replaceChildren(...abs.map((a, i) => h('li', {}, h('strong', {}, a.name), h('span', { class: 'muted' }, ` ${i === 0 ? '(signature) ' : ''}${a.text}.`))));
      setText(r.saveText, `Save ${abs[0].name} for boss fights`);
    }
    r.saveBox.checked = hero.saveSignature === true;
    setAttr(r.saveBox, 'aria-label', `Save ${DATA.combat.classes[hero.class].abilities[0].name} for bosses: ${hero.name}`);
    setAttr(r.lockBox, 'aria-label', `Hold gear for ${hero.name}`);

    const pending = pendingTalents(hero);
    const tsig = `${hero.talents.join(',')}|${pending}|${hero.level}`;
    if (tsig !== r.talentSig) {
      r.talentSig = tsig;
      const taken = hero.talents.map((id) => cls.perks.find((p) => p.id === id));
      const lines = [];
      if (taken.length) lines.push(h('ul', { class: 'perks-taken' }, taken.map((p) => h('li', {}, h('strong', {}, p.name), ` ${p.text}`))));
      if (pending > 0) {
        lines.push(h('p', {}, `${pending} talent point${pending > 1 ? 's' : ''} to spend. Choose one:`));
        lines.push(h('div', { class: 'perks' }, cls.perks.map((p) =>
          h('button', { class: 'btn perk', type: 'button', 'aria-label': `${hero.name} learns ${p.name}`, onClick: () => act((s) => chooseTalent(s, id0(r), p.id), (res) => `${hero.name} learned ${res.perk.name}.`) }, h('strong', {}, p.name), h('span', {}, p.text)))));
      } else {
        const nextAt = (Math.floor(hero.level / HD.talentEvery) + 1) * HD.talentEvery;
        lines.push(h('p', { class: 'muted' }, nextAt <= heroCap(state) ? `Next talent point at level ${nextAt}.` : 'All talents learned.'));
      }
      r.talents.replaceChildren(...lines);
    }
  }
  const id0 = (r) => r.id;

  function updateRoster(state, mode) {
    const sig = state.heroes.map((x) => x.id).join(',');
    if (sig !== rosterSig) {
      rosterSig = sig;
      for (const hero of state.heroes) if (!cards.has(hero.id)) cards.set(hero.id, makeHeroCard(hero.id));
      for (const k of [...cards.keys()]) if (!state.heroes.some((x) => x.id === k)) cards.delete(k);
      rosterList.replaceChildren(...state.heroes.map((x) => cards.get(x.id).el));
    }
    rosterEmpty.hidden = state.heroes.length > 0;
    for (const hero of state.heroes) updateHero(state, hero, cards.get(hero.id), mode);
  }

  // ---------- Bag ----------
  const bagList = h('ul', { class: 'bag' });
  const bagEmpty = h('p', { class: 'muted' }, 'The bag is empty. The Blacksmith and, later, quests fill it.');
  const bagCard = h('section', { class: 'card', 'aria-label': 'Bag' }, h('div', { class: 'card-head' }, h('div', { class: 'b-icon' }, icon('bag')), h('h2', { class: 'h-sec' }, 'Bag')), bagEmpty, bagList);
  let bagSig = '';
  let bagRefs = [];

  function updateBag(state, mode) {
    const sig = `${state.items.map((i) => i.id).join(',')}|${state.heroes.map((x) => x.id).join(',')}`;
    if (sig !== bagSig) {
      bagSig = sig;
      bagRefs = state.items.map((item) => {
        const sel = h('select', { 'aria-label': `Give ${item.name} to`, class: 'give' }, state.heroes.map((x) => h('option', { value: x.id }, x.name)));
        const equip = h('button', { class: 'btn btn-small', type: 'button', onClick: () => act((s) => equipItem(s, sel.value, item.id), () => `${item.name} equipped.`) }, 'Equip');
        const value = h('span', { class: 'cost cost-gold' }, icon('gold'), h('span', { class: 'cost-v' }));
        const sell = h('button', { class: 'btn btn-small', type: 'button', 'aria-label': `Sell ${item.name}`, onClick: () => act((s) => sellItem(s, item.id), (r) => `Sold for ${fmt(r.gold)} gold.`) }, 'Sell');
        const req = DATA.tierById[item.tier].reqLevel;
        const el = h('li', { class: 'bag-item' },
          h('div', {}, itemSpan(item), h('span', { class: 'muted bag-sub' }, `${DATA.slotById[item.slot].name}, ${DATA.tierById[item.tier].zone}, level ${req}`)),
          h('div', { class: 'bag-act' }, state.heroes.length ? [sel, equip] : null, value, sell));
        return { item, value, el };
      });
      bagList.replaceChildren(...bagRefs.map((x) => x.el));
    }
    for (const ref of bagRefs) setText(ref.value.querySelector('.cost-v'), fmt(itemValue(state, ref.item), mode));
    bagEmpty.hidden = state.items.length > 0;
    bagList.hidden = state.items.length === 0;
  }

  // ---------- Forge ----------
  let forgeTier = 1;
  const forgeSeg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Forge tier' });
  const forgeNote = h('p', { class: 'muted' });
  const forgeRows = {};
  const forgeList = h('ul', { class: 'forge' }, DATA.gear.slots.map((sl) => {
    const costs = h('span', { class: 'costs' });
    const btn = h('button', { class: 'btn btn-small', type: 'button', onClick: () => act((s) => craftItem(s, sl.id, forgeTier), (r) => `Forged ${r.item.name}.`) }, 'Forge');
    forgeRows[sl.id] = { costs, btn, sig: '' };
    return h('li', {}, h('span', { class: 'slot-name' }, sl.name), costs, btn);
  }));
  const forgeCard = h('section', { class: 'card', 'aria-label': 'Forge' },
    h('div', { class: 'card-head' }, h('div', { class: 'b-icon' }, icon('blacksmith')), h('h2', { class: 'h-sec' }, 'Forge')), forgeSeg, forgeNote, forgeList);
  const tierBtns = DATA.gear.tiers.map((t) => {
    const b = h('button', { class: 'seg-btn', type: 'button', role: 'radio', 'aria-checked': 'false', onClick: () => { forgeTier = t.tier; ctx.refresh(); } }, t.zone);
    return b;
  });
  forgeSeg.append(...tierBtns);

  function updateForge(state, mode) {
    const smith = levelOf(state, 'blacksmith');
    forgeCard.hidden = smith < 1;
    if (smith < 1) return;
    DATA.gear.tiers.forEach((t, i) => {
      const open = smith >= t.smithLevel;
      setAttr(tierBtns[i], 'aria-checked', forgeTier === t.tier ? 'true' : 'false');
      setClass(tierBtns[i], 'is-on', forgeTier === t.tier);
      setAttr(tierBtns[i], 'disabled', !open);
      setAttr(tierBtns[i], 'title', open ? `${t.zone} gear, worn from level ${t.reqLevel}` : `Needs Blacksmith level ${t.smithLevel}`);
    });
    const t = DATA.tierById[forgeTier];
    const lockedNext = DATA.gear.tiers.find((x) => smith < x.smithLevel);
    setText(forgeNote, `${t.zone} gear is worn from level ${t.reqLevel}. A higher Blacksmith level raises the chance of fine, superior and heroic work.${lockedNext ? ` ${lockedNext.zone} gear needs Blacksmith level ${lockedNext.smithLevel}.` : ''}`);
    const full = state.items.length >= DATA.gear.inventoryCap;
    for (const sl of DATA.gear.slots) {
      const ref = forgeRows[sl.id];
      const cost = craftCost(state, sl.id, forgeTier);
      const sig = `${forgeTier}`;
      if (sig !== ref.sig) {
        ref.sig = sig;
        ref.costs.replaceChildren(...Object.keys(cost).map((id) => costChip(id, cost[id], false, mode)));
      }
      let ok = true;
      for (const chip of ref.costs.children) {
        const id = chip.dataset.res;
        setText(chip.querySelector('.cost-v'), fmt(cost[id], mode));
        const lack = (state.res[id] ?? 0) < cost[id];
        setClass(chip, 'lack', lack);
        if (lack) ok = false;
      }
      setAttr(ref.btn, 'disabled', !ok || full || smith < t.smithLevel);
      setAttr(ref.btn, 'aria-label', `Forge ${sl.name} (${t.zone})`);
    }
  }

  // ---------- Classes ----------
  const classList = h('ul', { class: 'classes' }, HD.classes.map((c) => {
    const when = h('span', { class: 'cl-when' });
    const li = h('li', { class: 'class-row' }, h('div', {}, h('strong', {}, c.name), h('span', { class: 'muted' }, ` ${c.role}. ${c.ability.name}: ${c.ability.text}.`)), when);
    c.ui = { when, li };
    return li;
  }));
  const classCard = h('section', { class: 'card', 'aria-label': 'Classes' }, h('h2', { class: 'h-sec' }, 'Classes'), classList);

  function updateClasses(state) {
    for (const c of HD.classes) {
      const open = classUnlocked(c, state);
      setText(c.ui.when, open ? 'Available' : `Needs ${DATA.buildingById[c.unlock.building].name} level ${c.unlock.level}`);
      setClass(c.ui.li, 'is-locked', !open);
    }
  }

  const el = h('section', { class: 'panel', id: 'panel-heroes', 'aria-label': 'Heroes', hidden: true },
    h('div', { class: 'heroes-grid' }, h('div', { class: 'town-main' }, tavernCard, rosterCard), h('aside', { class: 'aside' }, bagCard, forgeCard, classCard)));

  function update(state) {
    const mode = state.settings.numberFormat;
    updateTavern(state, mode);
    updateRoster(state, mode);
    updateBag(state, mode);
    updateForge(state, mode);
    updateClasses(state);
  }
  return { el, update };
}
