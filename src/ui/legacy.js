// The deeper prestige layers, shown inside the Rebuild tab: retiring heroes for Legacy, the Legacy
// shop, the Hall of Heroes, the Epoch and the Sands of Time shop.
import { DATA } from '../engine/data.js';
import { retireHero, retirePreview, retireOpen, buyLegacy, legacyLevel, legacyCost, heroTier } from '../engine/legacy.js';
import { epoch, epochPreview, buySands, sandsLevel, sandsCost } from '../engine/epoch.js';
import { valueAt, legacyMultiplier, legacyTotal, sandsTotal } from '../engine/renown.js';
import { fmt as fmtBig, fmtInt } from '../engine/numbers.js';
import { h, setText, setClass, setAttr } from './dom.js';
import { icon } from './icons.js';

const fmt = (v, mode) => (v < 1000 ? fmtInt(v) : fmtBig(v, mode));
const x2 = (v) => `x${v.toFixed(2)}`;
const className = (id) => DATA.classById[id].name;

function show(up, v) {
  switch (up.format) {
    case 'percent': return `${Math.round(v * 100)}%`;
    case 'points': return `${v} points`;
    case 'level': return `Town Hall ${v}`;
    case 'count': return up.key === 'journal' ? 'on' : `${v} more`;
    default: return `${v}`;
  }
}

const RESETS = [
  'Everything a Rebuild resets',
  'Every hero. Those of level 40 or more retire into the Hall of Heroes for Legacy; the rest go home',
  'The bag, and all gear not carried by a retiring hero',
  'Renown: the balance, the total and every Renown shop upgrade',
];
const KEEPS = [
  'Legacy, its shop, class talents and auras',
  'The Hall of Heroes and the heirs waiting in it',
  'Sands of Time and their upgrades',
  'Zone standing and story, achievements, settings and the log',
];

export function createLegacy(ctx) {
  const act = (fn, say) => {
    const r = ctx.run(fn);
    if (r.ok) { if (say) ctx.announce(say(r)); ctx.saveSoon(); } else ctx.announce(r.error);
    return r;
  };

  // A shop made of grouped upgrade rows, patched in place on every update.
  function makeShop({ id, title, groups, list, levelOf, costOf, buy, currency, balanceOf }) {
    const refs = new Map();
    const blocks = groups.map((g) => {
      const ul = h('ul', { class: 'upgrades', 'aria-label': `${g.name} upgrades` });
      for (const up of list.filter((u) => u.group === g.id)) {
        const r = { up };
        r.level = h('span', { class: 'chip' });
        r.now = h('span', { class: 'muted' });
        r.cost = h('span', { class: 'rb-cost' });
        r.btn = h('button', { class: 'btn btn-small', type: 'button', onClick: () => act((s) => buy(s, up.id), (res) => `${up.name} level ${res.level}.`) }, 'Buy');
        r.el = h('li', { class: 'upgrade' }, h('span', { class: 'up-text' }, h('strong', {}, up.name), h('span', { class: 'muted' }, up.blurb), r.now), r.level, r.cost, r.btn);
        refs.set(up.id, r);
        ul.append(r.el);
      }
      return h('div', { class: 'zone-block' }, h('h4', { class: 'h-sub' }, g.name), ul);
    });
    const intro = h('p', { class: 'muted' });
    const el = h('div', { class: 'card', id }, h('h2', { class: 'h-sec' }, title), intro, ...blocks);
    return {
      el, intro,
      update(state, mode) {
        const bal = balanceOf(state);
        for (const [uid, r] of refs) {
          const up = r.up;
          const level = levelOf(state, uid);
          const max = up.values.length;
          const cost = costOf(state, up);
          setText(r.level, `${level} of ${max}`);
          setClass(r.level, 'is-good', level >= max);
          setText(r.now, level > 0
            ? `Now ${show(up, valueAt(up, level))}${level < max ? `, next ${show(up, valueAt(up, level + 1))}` : ', the most there is'}.`
            : `Level 1 gives ${show(up, valueAt(up, 1))}.`);
          r.cost.hidden = cost === null;
          setText(r.cost, cost === null ? '' : `${fmt(cost, mode)} ${currency}`);
          setClass(r.cost, 'lack', cost !== null && bal < cost);
          r.btn.hidden = cost === null;
          setAttr(r.btn, 'disabled', cost === null || bal < cost);
          setAttr(r.btn, 'aria-label', `Buy ${up.name} level ${level + 1}`);
        }
      },
    };
  }

  // ---- Retire a hero ----
  let confirmHero = null;
  const retireIntro = h('p', { class: 'muted' });
  const retireList = h('ul', { class: 'heroes retire-list', 'aria-label': 'Heroes who can retire' });
  const retireEmpty = h('p', { class: 'muted' });
  const retireRows = new Map();
  const retireCard = h('div', { class: 'card', id: 'retire-card' },
    h('div', { class: 'card-head' }, h('div', { class: 'b-icon' }, icon('tavern')), h('h2', { class: 'h-sec' }, 'Retire a hero')),
    retireIntro, retireEmpty, retireList);

  function makeRetireRow(hero) {
    const r = { id: hero.id };
    r.name = h('strong', {});
    r.info = h('span', { class: 'muted' });
    r.gain = h('span', { class: 'chip is-story' });
    r.why = h('span', { class: 'muted' });
    r.btn = h('button', { class: 'btn btn-small', type: 'button', onClick: () => { confirmHero = hero.id; ctx.refresh(); } }, 'Retire');
    r.sure = h('div', { class: 'rb-confirm', role: 'alertdialog' });
    r.sureText = h('p', {});
    r.yes = h('button', { class: 'btn btn-danger btn-small', type: 'button', onClick: () => {
      const name = hero.name;
      confirmHero = null;
      act((s) => retireHero(s, hero.id), (res) => `${name} retired. ${res.gain} Legacy earned.`);
      ctx.refresh();
    } }, 'Yes, retire');
    r.no = h('button', { class: 'btn btn-small', type: 'button', onClick: () => { confirmHero = null; ctx.refresh(); } }, 'Not yet');
    r.sure.append(r.sureText, h('div', { class: 'order-ctl' }, r.yes, r.no));
    r.el = h('li', { class: 'upgrade retire-row' },
      h('span', { class: 'up-text' }, r.name, r.info, r.why), r.gain, r.btn, r.sure);
    return r;
  }

  // ---- The shop ----
  const legacyShop = makeShop({
    id: 'legacy-shop', title: 'Legacy shop', groups: DATA.legacy.groups, list: DATA.legacy.upgrades,
    levelOf: legacyLevel, costOf: legacyCost, buy: buyLegacy, currency: 'Legacy', balanceOf: (s) => s.prestige.legacy ?? 0,
  });
  const legacyBalance = h('span', { class: 'chip is-story' });
  const legacyMult = h('span', { class: 'chip' });
  legacyShop.el.querySelector('h2').after(legacyBalance, legacyMult);

  // ---- Hall of Heroes ----
  const hallList = h('ul', { class: 'upgrades', 'aria-label': 'Hall of Heroes' });
  const hallEmpty = h('p', { class: 'muted' }, 'Nobody has retired yet.');
  const hallCard = h('div', { class: 'card', id: 'hall-card' }, h('h2', { class: 'h-sec' }, 'Hall of Heroes'),
    h('p', { class: 'muted' }, `Retired heroes are remembered here. Up to ${DATA.legacy.descendants.max} unclaimed heirs wait at the Tavern (Heroes tab), recruited at a discount and born stronger.`), hallEmpty, hallList);
  let hallSig = '';

  // ---- The Epoch ----
  let confirmEpoch = false;
  const eraChip = h('span', { class: 'chip is-story' });
  const epochLine = h('p', { class: 'rb-gain' });
  const epochWhy = h('p', { class: 'note' });
  const epochAfter = h('p', { class: 'muted' });
  const epochDo = h('button', { class: 'btn btn-accent', type: 'button', id: 'epoch-start', onClick: () => { confirmEpoch = true; ctx.refresh(); } }, 'End the Era');
  const epochSure = h('div', { class: 'rb-confirm', role: 'alertdialog', 'aria-label': 'Confirm Epoch' });
  const epochSureText = h('p', {});
  const epochYes = h('button', { class: 'btn btn-danger', type: 'button', id: 'epoch-confirm', onClick: () => {
    confirmEpoch = false;
    const r = act((s) => epoch(s), (res) => `Era ${res.era} begins. ${res.gain} Sands of Time earned.`);
    if (r.ok) ctx.onEpoch?.();
    ctx.refresh();
  } }, 'Yes, end the Era');
  const epochNo = h('button', { class: 'btn', type: 'button', id: 'epoch-cancel', onClick: () => { confirmEpoch = false; ctx.refresh(); } }, 'Not yet');
  epochSure.append(epochSureText, h('div', { class: 'order-ctl' }, epochYes, epochNo));
  const epochCard = h('div', { class: 'card', id: 'epoch-card' },
    h('div', { class: 'card-head' }, h('div', { class: 'b-icon' }, icon('archives')), h('h2', { class: 'h-sec' }, 'The Epoch'), eraChip),
    h('p', { class: 'b-blurb' }, 'When the boss of an Era has fallen, the outpost can end it. The veterans retire into legend, the town and its Renown are wiped, and the world turns to the next Era, paying out Sands of Time.'),
    epochLine, epochWhy, epochAfter, h('div', { class: 'order-ctl' }, epochDo), epochSure,
    h('div', { class: 'rb-lists' },
      h('div', {}, h('h4', { class: 'h-sub' }, 'An Epoch resets'), h('ul', { class: 'rb-list' }, RESETS.map((t) => h('li', {}, t)))),
      h('div', {}, h('h4', { class: 'h-sub' }, 'An Epoch keeps'), h('ul', { class: 'rb-list' }, KEEPS.map((t) => h('li', {}, t))))));

  // ---- Sands of Time ----
  const sandsShop = makeShop({
    id: 'sands-shop', title: 'Sands of Time', groups: [{ id: 'sands', name: 'Deep upgrades' }], list: DATA.sands.upgrades.map((u) => ({ ...u, group: 'sands' })),
    levelOf: sandsLevel, costOf: sandsCost, buy: buySands, currency: 'Sands', balanceOf: (s) => s.prestige.sands ?? 0,
  });
  const sandsChip = h('span', { class: 'chip is-story' });
  sandsShop.el.querySelector('h2').after(sandsChip);

  const el = h('div', { class: 'legacy-layers' }, retireCard, legacyShop.el, hallCard, epochCard, sandsShop.el);

  function update(state) {
    const mode = state.settings.numberFormat;
    const open = retireOpen(state);
    const era = state.era ?? 1;
    const bossDown = (state.prestige.bosses ?? []).includes(`era${era}`);
    const showEpoch = open || era > 1 || bossDown || (state.stats.epochs ?? 0) > 0;
    const showSands = sandsTotal(state) > 0 || (state.stats.epochs ?? 0) > 0;
    retireCard.hidden = !open;
    legacyShop.el.hidden = !open;
    hallCard.hidden = !(state.hall ?? []).length;
    epochCard.hidden = !showEpoch;
    sandsShop.el.hidden = !showSands;

    // Retire
    const eligible = state.heroes.filter((x) => x.level >= DATA.legacy.gain.minLevel);
    setText(retireIntro, `Heroes of level ${DATA.legacy.gain.minLevel} or more can retire into the Hall of Heroes. Their level and best gear tier turn into Legacy, which buys permanent talents and auras. Their gear returns to the bag, and an heir may take their place at the Tavern. Retirement is permanent.`);
    const want = new Set(eligible.map((x) => x.id));
    for (const [id, r] of retireRows) if (!want.has(id)) { r.el.remove(); retireRows.delete(id); }
    for (const hero of eligible) {
      let r = retireRows.get(hero.id);
      if (!r) { r = makeRetireRow(hero); retireRows.set(hero.id, r); retireList.append(r.el); }
      const p = retirePreview(state, hero);
      setText(r.name, hero.name);
      setText(r.info, `Level ${hero.level} ${className(hero.class)}, best gear tier ${heroTier(hero)}. An heir would start at level ${p.heirLevel}, ${Math.round(p.heirBonus * 100)}% stronger.${p.orders ? ' Leaves their standing order.' : ''}`);
      setText(r.gain, `+${fmt(p.gain, mode)} Legacy`);
      setText(r.why, p.why);
      r.why.hidden = p.can;
      const asking = confirmHero === hero.id && p.can;
      r.btn.hidden = asking;
      setAttr(r.btn, 'disabled', !p.can);
      setAttr(r.btn, 'aria-label', `Retire ${hero.name}`);
      r.sure.hidden = !asking;
      setText(r.sureText, `Retire ${hero.name} for ${fmt(p.gain, mode)} Legacy? They leave the roster for good.`);
    }
    retireEmpty.hidden = eligible.length > 0;
    setText(retireEmpty, state.heroes.length ? `Nobody has reached level ${DATA.legacy.gain.minLevel} yet.` : 'You have no heroes.');
    if (confirmHero && !want.has(confirmHero)) confirmHero = null;

    // Legacy shop
    setText(legacyBalance, `${fmt(state.prestige.legacy ?? 0, mode)} Legacy to spend`);
    setText(legacyMult, `All production ${x2(legacyMultiplier(legacyTotal(state)))}`);
    setText(legacyShop.intro, `Earned in total: ${fmt(legacyTotal(state), mode)}. Class talents reach every hero of that class, now and in the future. Spending never lowers the production multiplier, which follows what you have earned. Raid first clears also pay Legacy.`);
    legacyShop.update(state, mode);

    // Hall
    const sig = (state.hall ?? []).map((e) => `${e.id}${e.claimed ? 'x' : ''}`).join(',');
    if (sig !== hallSig) {
      hallSig = sig;
      hallList.replaceChildren(...[...(state.hall ?? [])].reverse().map((e) => h('li', { class: 'upgrade' },
        h('span', { class: 'up-text' }, h('strong', {}, e.name), h('span', { class: 'muted' }, `Level ${e.level} ${DATA.raceById[e.race].name} ${className(e.class)}, gear tier ${e.tier}. Retired in Era ${e.era} for ${e.legacy} Legacy.`)),
        h('span', { class: `chip${e.claimed ? ' is-good' : ''}` }, e.claimed ? 'Heir recruited' : 'Heir waiting'))));
    }
    hallEmpty.hidden = (state.hall ?? []).length > 0;

    // Epoch
    const p = epochPreview(state);
    setText(eraChip, `Era ${era} of ${DATA.sands.maxEra}`);
    setText(epochLine, p.can ? `Ending Era ${era} now earns ${fmt(p.gain, mode)} Sands of Time.` : `Era ${era} is still under way.`);
    setText(epochWhy, p.why);
    epochWhy.hidden = p.can;
    setText(epochAfter, p.can
      ? `${p.retiring} ${p.retiring === 1 ? 'hero retires' : 'heroes retire'} for ${fmt(p.retireLegacy, mode)} Legacy${p.lost ? `, and ${p.lost} younger ${p.lost === 1 ? 'hero goes' : 'heroes go'} home` : ''}. Sands of Time total from ${fmt(p.total, mode)} to ${fmt(p.totalAfter, mode)}, raising production from ${x2(p.multiplier)} to ${x2(p.multiplierAfter)}.`
      : `Sands of Time earned so far: ${fmt(p.total, mode)} (production ${x2(p.multiplier)}).`);
    if (!p.can) confirmEpoch = false;
    epochDo.hidden = confirmEpoch;
    setAttr(epochDo, 'disabled', !p.can);
    epochSure.hidden = !confirmEpoch;
    setText(epochSureText, `End Era ${era} for ${fmt(p.gain, mode)} Sands of Time? Every hero leaves the roster, the town and all Renown are wiped, and Era ${p.nextEra} begins.${p.busy ? ` ${p.busy} ${p.busy === 1 ? 'party' : 'parties'} on the road will come home with nothing.` : ''}`);

    // Sands
    setText(sandsChip, `${fmt(state.prestige.sands ?? 0, mode)} Sands to spend`);
    setText(sandsShop.intro, `Earned in total: ${fmt(sandsTotal(state), mode)}. Sands of Time buy the deepest upgrades and raise production on their own, separate from Renown and Legacy.`);
    sandsShop.update(state, mode);
  }

  return { el, update };
}
