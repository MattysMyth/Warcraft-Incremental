import { levelOf } from '../engine/derive.js';

// The town picture: one original SVG that fills in as buildings are bought. It is drawn from state alone,
// carries no game logic, and is skipped by screen readers in favour of the caption underneath.
const OUT = 'stroke="var(--bg)" stroke-width="1" stroke-linejoin="round"';
const rect = (x, y, w, hh, fill) => `<rect x="${x}" y="${y}" width="${w}" height="${hh}" fill="${fill}" ${OUT}/>`;
const tri = (x, y, w, hh, fill) => `<path d="M${x - 2} ${y} L${x + w / 2} ${y - hh} L${x + w + 2} ${y} Z" fill="${fill}" ${OUT}/>`;
const WOOD = '#8b5e3c'; const ROOF = '#a4442f'; const STONE = '#9aa0a8'; const DARK = '#6e747d'; const LEAF = '#4f8a4b'; const HAY = '#d6b85a'; const WALL = '#b7a98f';

function house(x) { return rect(x, 138, 22, 14, WALL) + tri(x, 138, 22, 11, ROOF) + rect(x + 8, 144, 6, 8, WOOD); }
function tree(x, y) { return `<g class="anim">${rect(x + 3, y, 3, 8, WOOD)}<circle cx="${x + 4.5}" cy="${y - 3}" r="7" fill="${LEAF}" ${OUT}/></g>`; }
function hall(tier) {
  let s = rect(168, 120, 64, 32, WALL) + tri(164, 120, 72, 20, ROOF) + rect(194, 132, 12, 20, WOOD);
  if (tier >= 1) s += rect(158, 106, 12, 46, STONE) + tri(156, 106, 16, 10, ROOF);
  if (tier >= 2) s += rect(230, 106, 12, 46, STONE) + tri(228, 106, 16, 10, ROOF);
  if (tier >= 3) s += rect(190, 96, 20, 24, STONE) + tri(188, 96, 24, 14, ROOF);
  return `${s}<path d="M200 ${tier >= 3 ? 82 : 100} v-12 l12 4 l-12 4" fill="var(--accent)" ${OUT}/>`;
}
const stall = (x, n) => rect(x, 162, 32, 11, WOOD) + `<path d="M${x - 3} 162 L${x + 35} 162 L${x + 32} 153 L${x} 153 Z" fill="${n ? ROOF : HAY}" ${OUT}/>` + rect(x + 6, 166, 6, 4, HAY) + rect(x + 18, 166, 6, 4, LEAF);
const tent = (x) => `<path d="M${x} 130 L${x + 12} 112 L${x + 24} 130 Z" fill="${HAY}" ${OUT}/>` + rect(x + 10, 123, 4, 7, DARK);
const rocks = (n) => Array.from({ length: n }, (_, i) => `<path d="M${14 + i * 16} 176 l5 -11 l9 -2 l5 13 Z" fill="${STONE}" ${OUT}/>`).join('');
const field = (n) => Array.from({ length: n }, (_, i) => `<path d="M${280 + i * 12} 176 l8 -16 h6 l-8 16 Z" fill="${i % 2 ? HAY : LEAF}" ${OUT}/>`).join('');
const figure = (x) => `<circle cx="${x}" cy="164" r="3" fill="#e0c3a0" ${OUT}/><rect x="${x - 3}" y="167" width="6" height="9" rx="2" fill="var(--blue)" ${OUT}/>`;

function wall(level) {
  const tall = level >= 30 ? 22 : level >= 10 ? 16 : 10;
  let s = '';
  for (let x = 12; x < 388; x += 24) s += rect(x, 128 - tall, 22, tall, STONE) + rect(x + 2, 126 - tall, 4, 3, STONE);
  if (level >= 5) s += rect(10, 118 - tall, 14, tall + 10, DARK) + rect(376, 118 - tall, 14, tall + 10, DARK);
  return s;
}

export function sceneParts(state) {
  const lv = (id) => levelOf(state, id);
  const th = state.town.townHall;
  const tier = th >= 10 ? 3 : th >= 6 ? 2 : th >= 3 ? 1 : 0;
  const away = new Set(state.quests.active.flatMap((r) => r.party));
  const home = state.heroes.filter((x) => !away.has(x.id)).length;
  const parts = {
    wall: lv('wall_watchtower') > 0 ? Math.min(40, lv('wall_watchtower')) : 0,
    houses: lv('house') > 0 ? Math.min(6, 1 + Math.floor(lv('house') / 6)) : 0,
    trees: lv('lumber_camp') > 0 ? Math.min(6, 1 + Math.floor(lv('lumber_camp') / 8)) : 0,
    stalls: lv('market') > 0 ? (lv('market') >= 20 ? 2 : 1) : 0,
    field: lv('farm') > 0 ? Math.min(7, 2 + Math.floor(lv('farm') / 5)) : 0,
    rocks: lv('quarry') > 0 ? Math.min(4, 1 + Math.floor(lv('quarry') / 8)) : 0,
    tavern: lv('tavern') > 0, barracks: lv('barracks') > 0 ? Math.min(3, 1 + Math.floor(lv('barracks') / 4)) : 0,
    chapel: lv('chapel') > 0, tower: lv('archives') > 0 || lv('mage_tower') > 0,
    tier, heroes: Math.min(6, home), era: state.era ?? 1,
  };
  return parts;
}

export function sceneSvg(p) {
  let s = `<rect width="400" height="180" class="sc-sky"/>`;
  if (p.era > 1) s += `<circle cx="352" cy="46" r="22" fill="none" stroke="#6bd48a" stroke-width="5" opacity="0.8"/><circle cx="352" cy="46" r="12" fill="#6bd48a" opacity="0.35"/>`;
  else s += `<circle cx="340" cy="34" r="14" fill="var(--accent)" opacity="0.55"/>`;
  s += `<path d="M0 118 Q60 84 130 112 T260 104 T400 116 V180 H0 Z" class="sc-far"/><rect y="128" width="400" height="52" class="sc-ground"/>`;
  s += `<path d="M120 180 Q190 150 200 152 Q214 152 290 180 Z" fill="var(--line)" opacity="0.7"/>`;
  if (p.wall) s += wall(p.wall);
  for (let i = 0; i < p.trees; i += 1) s += tree(18 + i * 15, 124 + (i % 2) * 5);
  for (let i = 0; i < p.barracks; i += 1) s += tent(296 + i * 28);
  s += hall(p.tier);
  for (let i = 0; i < p.houses; i += 1) s += house([22, 54, 86, 262, 294, 326][i]);
  if (p.tavern) s += rect(244, 128, 30, 24, WOOD) + tri(242, 128, 34, 14, ROOF) + rect(250, 140, 8, 12, DARK) + `<rect x="266" y="134" width="6" height="5" fill="var(--accent)" ${OUT}/>`;
  if (p.chapel) s += rect(348, 134, 18, 18, WALL) + tri(346, 134, 22, 12, ROOF) + rect(354, 112, 6, 22, STONE) + `<path d="M357 104 v8 M353 107 h8" stroke="var(--accent)" stroke-width="2"/>`;
  if (p.tower) s += rect(374, 108, 16, 44, STONE) + tri(372, 108, 20, 14, '#5a5fa8') + `<circle cx="382" cy="124" r="3" fill="var(--accent)"/>`;
  s += rocks(p.rocks);
  for (let i = 0; i < p.stalls; i += 1) s += stall(100 + i * 44, i);
  s += field(p.field);
  for (let i = 0; i < p.heroes; i += 1) s += figure(232 + i * 11);
  return `<svg viewBox="0 0 400 180" role="img" aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid slice">${s}</svg>`;
}

export function sceneCaption(p, state) {
  const bits = [`Town Hall ${state.town.townHall}`];
  if (p.houses) bits.push(`${levelOf(state, 'house')} house levels`);
  if (p.wall) bits.push('a wall');
  if (p.tavern) bits.push('a tavern');
  if (p.heroes) bits.push(`${p.heroes} ${p.heroes === 1 ? 'hero' : 'heroes'} at home`);
  return `Your outpost: ${bits.join(', ')}.`;
}

