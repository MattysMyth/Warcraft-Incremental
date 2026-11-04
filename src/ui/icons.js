// Original line icons (24x24, stroke only). Constant markup, no user content.
const SVG = (body) =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

const ICONS = {
  gold: SVG('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/>'),
  lumber: SVG('<rect x="3" y="14.5" width="18" height="5" rx="2.5"/><rect x="6" y="8" width="12" height="5" rx="2.5"/><circle cx="18" cy="17" r="1"/><circle cx="15" cy="10.5" r="1"/>'),
  stone: SVG('<path d="M4 18.5l2.5-8 6-4 6.5 4.5-1.5 7.5z"/><path d="M6.5 10.5l6 2.5 6.5-2.5M12.5 13l-1 5.5"/>'),
  food: SVG('<path d="M12 21V8"/><path d="M12 10c-3 0-4-2-4-4.5 3 0 4 2 4 4.5zM12 10c3 0 4-2 4-4.5-3 0-4 2-4 4.5zM12 15.5c-3 0-4-2-4-4.5 3 0 4 2 4 4.5zM12 15.5c3 0 4-2 4-4.5-3 0-4 2-4 4.5z"/>'),
  lumber_camp: SVG('<path d="M12 3l5 7h-3l4 6H6l4-6H7z"/><path d="M12 16v5"/>'),
  market: SVG('<path d="M3.5 9L5 4h14l1.5 5"/><path d="M3.5 9c0 2 3.2 2 3.2 0 0 2 2.6 2 2.6 0 0 2 2.6 2 2.6 0 0 2 2.6 2 2.6 0 0 2 3.2 2 3.2 0"/><path d="M5.5 12.5V20M18.5 12.5V20M3.5 20h17"/>'),
  quarry: SVG('<path d="M4.5 9c3-3.5 11-3.5 15 0"/><path d="M12 6v14"/><path d="M9 20h6"/>'),
  farm: SVG('<path d="M12 21V8"/><path d="M12 8c-3 0-4-2-4-4 3 0 4 2 4 4z"/><path d="M12 8c3 0 4-2 4-4-3 0-4 2-4 4z"/><path d="M12 14c-3 0-4-2-4-4 3 0 4 2 4 4z"/><path d="M12 14c3 0 4-2 4-4-3 0-4 2-4 4z"/><path d="M6 21h12"/>'),
  iron_ore: SVG('<path d="M5 17l2-8 6-3 6 5-1 7z"/><circle cx="11" cy="12" r="1"/><circle cx="15" cy="14" r="1"/>'),
  iron_bars: SVG('<path d="M3.5 17l3-4h11l3 4z"/><path d="M7 13l2.5-4h5L17 13"/>'),
  herbs: SVG('<path d="M5 19c0-8 5-13 14-14 0 9-5 14-14 14z"/><path d="M5 19c4-4 7-7 10-9"/>'),
  leather: SVG('<path d="M5 6c3 2 11 2 14 0l1.5 4-2.5 1.5V19H6v-7.5L3.5 10z"/><path d="M10 19v-4h4v4"/>'),
  zone: SVG('<path d="M3.5 6.5l5.5-2 6 2 5.5-2v13l-5.5 2-6-2-5.5 2z"/><path d="M9 4.5v13M15 6.5v13"/>'),
  potion: SVG('<path d="M10 3.5h4"/><path d="M11 3.5V8l-4.5 8.5A2 2 0 008.3 19.5h7.4a2 2 0 001.8-3L13 8V3.5"/><path d="M8.5 14h7"/>'),
  arcane_dust: SVG('<path d="M11 3l1.8 5.2L18 10l-5.2 1.8L11 17l-1.8-5.2L4 10l5.2-1.8z"/><path d="M18 16l.8 2 2 .8-2 .8L18 22l-.8-1.8-2-.8 2-.8z"/>'),
  house: SVG('<path d="M4 11l8-6 8 6"/><path d="M6 10v9h12v-9"/><path d="M10 19v-5h4v5"/>'),
  warehouse: SVG('<path d="M3 9l9-5 9 5v10H3z"/><path d="M7 19v-6h10v6"/><path d="M7 16h10"/>'),
  mine: SVG('<path d="M4 20c0-6 3-11 8-11s8 5 8 11"/><path d="M9 20v-5h6v5"/><path d="M12 9V5"/>'),
  blacksmith: SVG('<path d="M4 9h13c0 3-2 4-4 4v3h3v3H8v-3h3v-3c-3 0-5-1-7-4z"/>'),
  alchemy_lab: SVG('<path d="M10 4h4"/><path d="M11 4v5l-5 9a1.5 1.5 0 001.3 2.2h9.4A1.5 1.5 0 0018 18l-5-9V4"/><path d="M8.5 15h7"/>'),
  mage_tower: SVG('<path d="M9 20V9l3-5 3 5v11"/><path d="M7 20h10"/><path d="M12 12v3"/>'),
  tavern: SVG('<path d="M6 8h9v10a1 1 0 01-1 1H7a1 1 0 01-1-1z"/><path d="M15 10h2a2 2 0 010 5h-2"/><path d="M8 5c0-1 2-1 2-2M12 5c0-1 2-1 2-2"/>'),
  barracks: SVG('<path d="M5 19L17 7M14 6h4v4"/><path d="M19 19L7 7M10 6H6v4"/>'),
  chapel: SVG('<path d="M12 3v5M9.5 5.5h5"/><path d="M6 20v-8l6-4 6 4v8z"/><path d="M10 20v-4h4v4"/>'),
  stables: SVG('<path d="M7 20V10a5 5 0 0110 0v10"/><path d="M7 20h3M14 20h3"/>'),
  wall_watchtower: SVG('<path d="M4 20V9h3V6h2v3h6V6h2v3h3v11z"/><path d="M10 20v-4h4v4"/>'),
  archives: SVG('<path d="M5 5h10a3 3 0 013 3v12H8a3 3 0 01-3-3z"/><path d="M5 17a3 3 0 013-3h10"/>'),
  town_hall: SVG('<path d="M3 20h18"/><path d="M5 20V10l7-5 7 5v10"/><path d="M12 5V2.5"/><path d="M9 20v-6h6v6"/>'),
  hero: SVG('<path d="M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6z"/><path d="M9 12l2 2 4-4.5"/>'),
  quest: SVG('<path d="M7 21V4"/><path d="M7 5h11l-3 4 3 4H7"/>'),
  bag: SVG('<path d="M6 8h12l1.5 12h-15z"/><path d="M9 8V6a3 3 0 016 0v2"/>'),
  worker: SVG('<circle cx="12" cy="8" r="3"/><path d="M6 20c0-4 3-6 6-6s6 2 6 6"/>'),
  tribute: SVG('<path d="M5 8h14l-1.5 11h-11z"/><path d="M8.5 8V6.5a3.5 3.5 0 017 0V8"/>'),
};

export function icon(name) {
  const span = document.createElement('span');
  span.className = `icon icon-${name}`;
  span.innerHTML = ICONS[name] ?? '';
  return span;
}
