// Standing orders: a party that keeps going out without the player. The running of orders
// lives in quests.js (stepQuests); this file holds the rules for making and changing them.
import { DATA } from './data.js';
import { levelOf } from './derive.js';
import { meets } from './quests.js';

const OD = (data) => data.quests.orders;

export function orderSlots(state, data = DATA) {
  const o = OD(data);
  const b = levelOf(state, 'barracks');
  if (b < o.barracks) return 0;
  return Math.min(o.maxSlots, 1 + Math.floor((b - o.barracks) / o.levelsPerSlot));
}

export const smartOrders = (state, data = DATA) => levelOf(state, 'barracks') >= OD(data).smartBarracks;

// Order templates a player may repeat: any ordinary template whose zone is open and whose needs are met.
export const repeatable = (state, data = DATA) => data.quests.templates.filter((t) => !t.story && meets(t, state, data));

export function createOrder(state, { mode, template = null, party, minOdds, potion = null }, data = DATA) {
  const cfg = OD(data);
  const slots = orderSlots(state, data);
  if (slots < 1) return { ok: false, error: `Standing orders need the Barracks (level ${cfg.barracks}).` };
  if (state.quests.orders.length >= slots) return { ok: false, error: `Your Barracks allows ${slots} standing order${slots > 1 ? 's' : ''}. Remove one first.` };
  if (mode !== 'repeat' && mode !== 'best') return { ok: false, error: 'Choose repeat or best available.' };
  if (mode === 'best' && !smartOrders(state, data)) return { ok: false, error: `Best-available orders need Barracks level ${cfg.smartBarracks}.` };
  const ids = [...new Set(party ?? [])];
  if (!ids.length) return { ok: false, error: 'Choose at least one hero.' };
  if (ids.some((id) => !state.heroes.some((h) => h.id === id))) return { ok: false, error: 'That hero is not in the roster.' };
  const taken = state.quests.orders.find((o) => o.party.some((id) => ids.includes(id)));
  if (taken) return { ok: false, error: 'A hero can only follow one standing order.' };
  const odds = minOdds ?? cfg.defaultMinOdds;
  if (!cfg.minOdds.includes(odds)) return { ok: false, error: 'Choose one of the offered safety levels.' };
  if (potion && !data.potionById[potion]) return { ok: false, error: 'No such potion.' };
  if (mode === 'repeat') {
    const t = data.templateById[template];
    if (!t || t.story) return { ok: false, error: 'That quest cannot be repeated.' };
    if (!meets(t, state, data)) return { ok: false, error: 'The outpost cannot take that quest on yet.' };
    const size = data.quests.types[t.type].party;
    if (ids.length < size[0] || ids.length > size[1]) return { ok: false, error: `${data.quests.types[t.type].name} quests take ${size[0] === size[1] ? size[0] : `${size[0]} to ${size[1]}`} heroes.` };
  }
  const n = (state.quests.orderSeq ?? 0) + 1;
  const order = { id: `o${n}`, mode, template: mode === 'repeat' ? template : null, party: ids, minOdds: odds, potion: potion ?? null, paused: false, wait: 0, note: '', runs: 0 };
  return { ok: true, order, state: { ...state, quests: { ...state.quests, orderSeq: n, orders: [...state.quests.orders, order] } } };
}

const patch = (state, id, fn) => {
  if (!state.quests.orders.some((o) => o.id === id)) return { ok: false, error: 'That order no longer exists.' };
  return { ok: true, state: { ...state, quests: { ...state.quests, orders: state.quests.orders.map((o) => (o.id === id ? fn(o) : o)) } } };
};

export const removeOrder = (state, id) => {
  if (!state.quests.orders.some((o) => o.id === id)) return { ok: false, error: 'That order no longer exists.' };
  return { ok: true, state: { ...state, quests: { ...state.quests, orders: state.quests.orders.filter((o) => o.id !== id) } } };
};
export const pauseOrder = (state, id, paused) => patch(state, id, (o) => ({ ...o, paused: !!paused, wait: 0, note: '' }));
export function setOrderOdds(state, id, minOdds, data = DATA) {
  if (!OD(data).minOdds.includes(minOdds)) return { ok: false, error: 'Choose one of the offered safety levels.' };
  return patch(state, id, (o) => ({ ...o, minOdds, wait: 0, note: '' }));
}
export function setOrderPotion(state, id, potion, data = DATA) {
  if (potion && !data.potionById[potion]) return { ok: false, error: 'No such potion.' };
  return patch(state, id, (o) => ({ ...o, potion: potion || null }));
}
