// The Alchemy Lab: potions brewed from herbs, drunk by a party for one quest.
// Stock and the brew queue are state; speed, caps and costs are derived.
import { DATA } from './data.js';
import { levelOf } from './derive.js';
import { effectsOf } from './heroes.js';

export const newAlchemy = () => ({ stock: {}, queue: [] });

const CD = (data) => data.crafting;

export const potionStock = (state, id) => state.alchemy?.stock?.[id] ?? 0;
export const queuedOf = (state, id) => (state.alchemy?.queue ?? []).filter((q) => q.id === id).length;

export const stockCap = (state, data = DATA) => {
  const b = CD(data).brew;
  return b.stockBase + b.stockPerLab * levelOf(state, 'alchemy_lab');
};

// Brewing speed: each Lab level adds a little, and every Gnome in the roster adds the race's crafting bonus.
export function brewSpeed(state, data = DATA) {
  const b = CD(data).brew;
  const craft = Math.min(b.craftMax, state.heroes.reduce((a, h) => a + (effectsOf(h, data).craft ?? 0), 0));
  return (1 + b.speedPerLab * levelOf(state, 'alchemy_lab')) * (1 + craft);
}

export const potionsUnlocked = (state, data = DATA) => CD(data).potions.filter((p) => levelOf(state, 'alchemy_lab') >= p.lab);

// Advance the brew queue. Time left over after one potion finishes goes to the next.
export function stepAlchemy(state, dt, data = DATA) {
  const a = state.alchemy;
  if (!a?.queue.length) return a;
  const speed = brewSpeed(state, data);
  const cap = stockCap(state, data);
  let left = dt * speed;
  const queue = [];
  const stock = { ...a.stock };
  for (const q of a.queue) {
    if (left <= 0) { queue.push(q); continue; }
    if (q.left > left) { queue.push({ ...q, left: q.left - left }); left = 0; continue; }
    left -= q.left;
    stock[q.id] = Math.min(cap, (stock[q.id] ?? 0) + 1);
  }
  return { stock, queue };
}
