import { DATA } from '../engine/data.js';
import { levelOf } from '../engine/derive.js';
import { orderSlots, smartOrders } from '../engine/orders.js';
import { stockCap, potionStock, queuedOf, brewSpeed, potionsUnlocked } from '../engine/alchemy.js';
import { createOrder, removeOrder, pauseOrder, setOrderOdds, setOrderPotion, brewPotion, cancelBrew } from '../engine/actions.js';
import { fmt as fmtBig, fmtInt, fmtDuration } from '../engine/numbers.js';
const fmt = (v, mode) => (v < 1000 ? fmtInt(v) : fmtBig(v, mode));
import { h, setText, setClass, setAttr } from './dom.js';
import { icon } from './icons.js';

const OC = DATA.quests.orders;
const pct = (x) => `${Math.round(x * 100)}%`;
const oddsLabel = (x) => (x === 0 ? 'Go regardless of the odds' : `Only if the odds are ${pct(x)} or better`);

function costChips(cost, state, mode) {
  return Object.entries(cost).map(([id, amt]) =>
    h('span', { class: `cost cost-${id}${state.res[id] < amt ? ' lack' : ''}` }, icon(id), h('span', { class: 'cost-v' }, fmt(amt, mode)), h('span', { class: 'sr-only' }, DATA.resourceById[id].name)));
}

// Standing orders and the Alchemy Lab: the two panels that keep parties going while the player is away.
export function createOrdersPanel(ctx) {
  const act = (fn, say) => {
    const r = ctx.run(fn);
    if (r.ok) { if (say) ctx.announce(say(r)); ctx.saveSoon(); } else ctx.announce(r.error);
    return r;
  };

  // ---------- Standing orders ----------
  const slotLine = h('p', { class: 'muted' });
  const orderList = h('ul', { class: 'orders', 'aria-label': 'Standing orders' });
  const orderEmpty = h('p', { class: 'muted' });
  const formParty = h('ul', { class: 'picker', 'aria-label': 'Heroes for a best-available order' });
  const formOdds = h('select', { class: 'select', 'aria-label': 'Safety level' }, OC.minOdds.map((v) => h('option', { value: String(v) }, oddsLabel(v))));
  formOdds.value = String(OC.defaultMinOdds);
  const formPicks = new Set();
  const formBtn = h('button', { class: 'btn btn-accent', type: 'button', onClick: () => {
    const res = act((s) => createOrder(s, { mode: 'best', party: [...formPicks], minOdds: Number(formOdds.value) }), () => 'Standing order set.');
    if (res.ok) formPicks.clear();
  } }, 'Set best-available order');
  const form = h('div', { class: 'order-form' },
    h('h4', { class: 'h-sub' }, 'Best-available order'),
    h('p', { class: 'muted' }, 'This party takes the hardest notice on the board that meets your safety level, again and again. Story notices are left for you.'),
    formParty, formOdds, formBtn);
  const ordersCard = h('section', { class: 'card', 'aria-label': 'Standing orders' },
    h('div', { class: 'card-head' }, h('div', { class: 'b-icon' }, icon('barracks')), h('div', {}, h('h2', { class: 'h-sec' }, 'Standing orders'), slotLine)),
    orderEmpty, orderList, form);

  const orderRefs = new Map();
  let orderSig = '';
  let partySig = '';
  const partyRows = new Map();

  function makeOrder(o) {
    const r = { id: o.id };
    r.title = h('strong', {});
    r.status = h('span', { class: 'muted' });
    r.runs = h('span', { class: 'muted' });
    r.odds = h('select', { class: 'select', 'aria-label': 'Safety level', onChange: () => act((s) => setOrderOdds(s, o.id, Number(r.odds.value), DATA)) }, OC.minOdds.map((v) => h('option', { value: String(v) }, oddsLabel(v))));
    r.potion = h('select', { class: 'select', 'aria-label': 'Potion for this order', onChange: () => act((s) => setOrderPotion(s, o.id, r.potion.value || null, DATA)) });
    r.potionSig = '';
    r.pause = h('button', { class: 'btn btn-small', type: 'button', onClick: () => act((s) => pauseOrder(s, o.id, !s.quests.orders.find((x) => x.id === o.id)?.paused), () => 'Order changed.') });
    r.remove = h('button', { class: 'btn btn-small btn-danger', type: 'button', onClick: () => act((s) => removeOrder(s, o.id), () => 'Order removed.') }, 'Remove');
    r.el = h('li', { class: 'order' },
      h('span', { class: 'od-text' }, r.title, r.status, r.runs),
      h('span', { class: 'order-ctl' }, r.odds, r.potion, r.pause, r.remove));
    return r;
  }

  function statusOf(state, o) {
    if (o.paused) return 'Paused.';
    if (state.quests.active.some((r) => r.order === o.id)) return 'Out on the road.';
    const heroes = o.party.map((id) => state.heroes.find((x) => x.id === id)).filter(Boolean);
    const hurt = heroes.find((x) => x.injury > 0);
    if (hurt) return `Waiting for ${hurt.name} to recover.`;
    const busy = heroes.find((x) => state.quests.active.some((r) => r.party.includes(x.id)));
    if (busy) return `Waiting for ${busy.name} to finish another quest.`;
    if (o.note.startsWith('odds:')) return `Waiting: the best chance is ${o.note.slice(5)}%, below your ${pct(o.minOdds)} line.`;
    if (o.note === 'none') return 'Waiting for a notice this party can take.';
    if (o.note === 'size') return 'This party is the wrong size for that quest.';
    if (o.note === 'closed') return 'That quest is not available right now.';
    if (o.note === 'gone') return 'A hero has left the roster.';
    if (o.note.startsWith('error:')) return o.note.slice(6);
    return 'Ready to go.';
  }

  function updateOrders(state) {
    const b = levelOf(state, 'barracks');
    ordersCard.hidden = b < OC.barracks;
    if (ordersCard.hidden) return;
    const slots = orderSlots(state);
    const orders = state.quests.orders;
    setText(slotLine, `${orders.length} of ${slots} orders. A party on an order goes out again as soon as everyone is rested${smartOrders(state) ? '' : `; best-available orders need Barracks level ${OC.smartBarracks}`}. Another order slot opens every ${OC.levelsPerSlot} Barracks levels.`);
    orderEmpty.hidden = orders.length > 0;
    setText(orderEmpty, 'No standing orders yet. Open a notice, pick a party and choose "Repeat with this party".');
    const sig = orders.map((o) => o.id).join(',');
    if (sig !== orderSig) {
      orderSig = sig;
      const keep = new Map(orders.map((o) => [o.id, orderRefs.get(o.id) ?? makeOrder(o)]));
      orderRefs.clear();
      for (const [k, v] of keep) orderRefs.set(k, v);
      orderList.replaceChildren(...[...orderRefs.values()].map((x) => x.el));
    }
    for (const o of orders) {
      const r = orderRefs.get(o.id);
      const names = o.party.map((id) => state.heroes.find((x) => x.id === id)?.name ?? '?').join(' and ');
      const tpl = o.template ? DATA.templateById[o.template] : null;
      setText(r.title, `${tpl ? `Repeat: ${tpl.title}` : 'Best available quest'} (${names})`);
      setText(r.status, statusOf(state, o));
      setText(r.runs, `${o.runs} trips so far.`);
      if (r.odds.value !== String(o.minOdds)) r.odds.value = String(o.minOdds);
      const known = DATA.crafting.potions.filter((p) => potionStock(state, p.id) > 0 || o.potion === p.id);
      const psig = `${o.potion}|${known.map((p) => `${p.id}${potionStock(state, p.id)}`).join(',')}`;
      if (psig !== r.potionSig) {
        r.potionSig = psig;
        r.potion.replaceChildren(h('option', { value: '' }, 'No potion'), ...known.map((p) => h('option', { value: p.id }, `${p.name} (${potionStock(state, p.id)} left)`)));
        r.potion.value = o.potion ?? '';
      }
      r.potion.hidden = known.length === 0;
      setText(r.pause, o.paused ? 'Resume' : 'Pause');
    }
    const inOrder = new Set(orders.flatMap((o) => o.party));
    const free = state.heroes.filter((x) => !inOrder.has(x.id));
    const canForm = smartOrders(state) && orders.length < slots;
    form.hidden = !canForm;
    if (canForm) {
      const psig2 = free.map((x) => x.id).join(',');
      if (psig2 !== partySig) {
        partySig = psig2;
        partyRows.clear();
        for (const k of [...formPicks]) if (!free.some((x) => x.id === k)) formPicks.delete(k);
        formParty.replaceChildren(...free.map((hero) => {
          const id = `form-${hero.id}`;
          const box = h('input', { type: 'checkbox', id, onChange: () => { if (box.checked) formPicks.add(hero.id); else formPicks.delete(hero.id); ctx.refresh(); } });
          const label = h('label', { for: id }, h('span', { class: 'pk-name' }, hero.name), h('span', { class: 'pk-meta muted' }));
          partyRows.set(hero.id, { box, meta: label.querySelector('.pk-meta') });
          return h('li', { class: 'pick' }, box, label);
        }));
      }
      for (const hero of free) {
        const row = partyRows.get(hero.id);
        if (!row) continue;
        row.box.checked = formPicks.has(hero.id);
        setText(row.meta, ` Level ${hero.level} ${DATA.classById[hero.class].name}`);
      }
      setAttr(formBtn, 'disabled', formPicks.size === 0);
    }
  }

  // ---------- Alchemy Lab ----------
  const labLine = h('p', { class: 'muted' });
  const potionList = h('ul', { class: 'potions', 'aria-label': 'Potions' });
  const brewList = h('ul', { class: 'brews', 'aria-label': 'Brewing' });
  const brewEmpty = h('p', { class: 'muted' }, 'Nothing is brewing.');
  const labCard = h('section', { class: 'card', 'aria-label': 'Alchemy Lab' },
    h('div', { class: 'card-head' }, h('div', { class: 'b-icon' }, icon('potion')), h('div', {}, h('h2', { class: 'h-sec' }, 'Alchemy Lab'), labLine)),
    potionList, h('h4', { class: 'h-sub' }, 'Brewing'), brewEmpty, brewList);
  const potionRefs = DATA.crafting.potions.map((p) => {
    const r = { p };
    r.stock = h('span', { class: 'muted' });
    r.costs = h('span', { class: 'costs' });
    r.btn = h('button', { class: 'btn btn-small', type: 'button', onClick: () => act((s) => brewPotion(s, p.id), () => `Brewing ${p.name}.`) }, 'Brew');
    r.lock = h('span', { class: 'muted' });
    r.el = h('li', { class: 'potion' }, h('span', { class: 'po-text' }, h('strong', {}, p.name), h('span', { class: 'muted' }, `${p.text}. Takes ${fmtDuration(p.seconds)}.`), r.stock, r.lock), r.costs, r.btn);
    return r;
  });
  potionList.append(...potionRefs.map((r) => r.el));
  let brewSig = '';
  const brewRefs = [];

  function updateLab(state) {
    const lab = levelOf(state, 'alchemy_lab');
    labCard.hidden = lab < 1;
    if (labCard.hidden) return;
    const mode = state.settings.numberFormat;
    const cap = stockCap(state);
    const speed = brewSpeed(state);
    setText(labLine, `Potions are drunk by a party for one quest (one per hero) and are chosen when you send the party. The Lab holds ${cap} of each. Brewing speed x${speed.toFixed(2)}; Gnome heroes brew faster. Higher Lab levels teach more recipes.`);
    const open = new Set(potionsUnlocked(state).map((p) => p.id));
    for (const r of potionRefs) {
      const on = open.has(r.p.id);
      setText(r.stock, on ? `In stock: ${potionStock(state, r.p.id)} of ${cap}${queuedOf(state, r.p.id) ? `, ${queuedOf(state, r.p.id)} brewing` : ''}.` : '');
      setText(r.lock, on ? '' : `Needs Alchemy Lab level ${r.p.lab}.`);
      r.costs.replaceChildren(...costChips(r.p.cost, state, mode));
      r.btn.hidden = !on;
      setAttr(r.btn, 'disabled', Object.entries(r.p.cost).some(([id, amt]) => state.res[id] < amt));
    }
    const q = state.alchemy.queue;
    brewEmpty.hidden = q.length > 0;
    const sig = q.map((x) => x.id).join(',');
    if (sig !== brewSig) {
      brewSig = sig;
      brewRefs.length = 0;
      brewList.replaceChildren(...q.map((x, i) => {
        const left = h('span', { class: 'chip' });
        const li = h('li', { class: 'brew' }, h('strong', {}, DATA.potionById[x.id].name), left, h('button', { class: 'btn btn-small', type: 'button', onClick: () => act((s) => cancelBrew(s, i), () => 'Brew cancelled and refunded.') }, 'Cancel'));
        brewRefs.push(left);
        return li;
      }));
    }
    q.forEach((x, i) => setText(brewRefs[i], i === 0 ? `${fmtDuration(x.left / speed)} left` : 'Waiting'));
  }

  const el = h('div', { class: 'stack' }, ordersCard, labCard);
  return { el, update(state) { updateOrders(state); updateLab(state); } };
}
