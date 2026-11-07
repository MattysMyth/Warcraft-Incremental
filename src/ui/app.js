import { h, setText, setClass, setAttr } from './dom.js';
import { incomeBreakdown, levelOf } from '../engine/derive.js';
import { createResourceStrip, createTown } from './town.js';
import { createSettings } from './settings.js';
import { createHeroes } from './heroes.js';
import { createQuests } from './quests.js';
import { createZones } from './zones.js';
import { createRebuild } from './rebuild.js';
import { rebuildPreview, renownTotal } from '../engine/renown.js';
import { retireOpen } from '../engine/legacy.js';
import { createTutorial } from './tutorial.js';
import { createScene } from './scene.js';
import { createToasts } from './toasts.js';
import { createEventCard } from './engage.js';

// Tabs appear as their systems unlock. Town, Heroes, Quests, Zones, Rebuild and Settings exist so far;
// later checkpoints turn the others on by changing their `unlocked` rule.
const TABS = [
  { id: 'town', label: 'Town', unlocked: () => true },
  { id: 'heroes', label: 'Heroes', unlocked: (s) => levelOf(s, 'tavern') > 0 || s.heroes.length > 0 },
  { id: 'quests', label: 'Quests', unlocked: (s) => s.heroes.length > 0 || s.quests.active.length > 0 },
  { id: 'zones', label: 'Zones', unlocked: (s) => s.heroes.length > 0 || s.quests.active.length > 0 },
  { id: 'rebuild', label: 'Rebuild', unlocked: (s) => rebuildPreview(s).can || renownTotal(s) > 0 || s.stats.rebuilds > 0 || retireOpen(s) || (s.era ?? 1) > 1 || (s.prestige.bosses ?? []).length > 0 },
  { id: 'settings', label: 'Settings', unlocked: () => true },
];

export function createApp(root, ctx) {
  const strip = createResourceStrip(ctx);
  const town = createTown(ctx);
  const settings = createSettings(ctx);
  const heroes = createHeroes(ctx);
  const quests = createQuests(ctx);
  const zones = createZones(ctx);
  const rebuild = createRebuild(ctx, { onDone: () => { active = 'town'; } });
  const go = (id) => { active = id; ctx.refresh(); };
  const tutorial = createTutorial(ctx, { onGo: go });
  const scene = createScene();
  const toasts = createToasts();
  const eventCard = createEventCard(ctx);
  const panels = { town: town.el, heroes: heroes.el, quests: quests.el, zones: zones.el, rebuild: rebuild.el, settings: settings.el };
  let active = 'town';

  const kicker = h('p', { class: 'kicker' }, 'Elwynn Forest · Alliance frontier');
  const saveChip = h('span', { class: 'save-chip', role: 'status' });
  const notice = h('p', { class: 'notice', role: 'alert', hidden: true });
  const live = h('div', { class: 'sr-only', 'aria-live': 'polite', id: 'live' });

  const tabButtons = {};
  const tabs = h(
    'nav',
    { class: 'tabs', 'aria-label': 'Sections' },
    h('div', { class: 'tabs-inner' }, TABS.map((t) => {
      const b = h('button', { class: 'tab', type: 'button', hidden: true, onClick: () => { active = t.id; ctx.refresh(); } }, t.label);
      tabButtons[t.id] = b;
      return b;
    })),
  );

  root.append(
    h('header', { class: 'masthead' },
      h('div', {},
        kicker,
        h('h1', { class: 'title' }, 'Outpost of Azeroth')),
      saveChip),
    h('a', { class: 'skip', href: '#panel-area' }, 'Skip to the main content'),
    notice,
    eventCard.el,
    tutorial.el,
    strip.el,
    tabs,
    h('main', { class: 'main', id: 'panel-area', tabindex: '-1' }, scene.el, town.el, heroes.el, quests.el, zones.el, rebuild.el, settings.el),
    h('footer', { class: 'foot' }, 'Unofficial fan project. Warcraft belongs to Blizzard Entertainment.'),
    toasts.el,
    live,
  );

  function update(state) {
    document.documentElement.dataset.motion =
      state.settings.reducedMotion === 'on' ? 'reduce' : state.settings.reducedMotion === 'off' ? 'full' : 'auto';

    setText(kicker, (state.era ?? 1) > 1 ? `Era ${state.era} · Hellfire Peninsula` : 'Elwynn Forest · Alliance frontier');
    const root = document.documentElement;
    if (state.settings.theme === 'auto') delete root.dataset.theme; else root.dataset.theme = state.settings.theme;
    root.dataset.text = state.settings.textSize;
    root.dataset.effects = state.settings.effects;
    root.lang = 'en';
    for (const t of TABS) {
      const open = t.unlocked(state);
      tabButtons[t.id].hidden = !open;
      setAttr(tabButtons[t.id], 'aria-current', open && active === t.id ? 'page' : false);
      setClass(tabButtons[t.id], 'is-active', active === t.id);
    }
    for (const [id, el] of Object.entries(panels)) el.hidden = id !== active;

    tutorial.update(state);
    eventCard.update(state);
    toasts.update(state);
    scene.el.hidden = !(active === 'town' && state.settings.scene === 'on');
    if (!scene.el.hidden) scene.update(state);
    const info = incomeBreakdown(state);
    strip.update(state, info);
    if (active === 'town') town.update(state, info);
    if (active === 'heroes') heroes.update(state);
    if (active === 'quests') quests.update(state);
    if (active === 'zones') zones.update(state);
    if (active === 'rebuild') rebuild.update(state);
    if (active === 'settings') settings.update(state);

    const t = ctx.lastSave();
    if (!ctx.storageOk()) setText(saveChip, 'Not saved: use Export');
    else setText(saveChip, t ? `Saved ${Math.max(0, Math.round((Date.now() - t) / 1000))}s ago` : 'Not saved yet');
    setClass(saveChip, 'bad', !ctx.storageOk());

    const n = ctx.notice();
    notice.hidden = !n;
    if (n) setText(notice, n);
  }

  return {
    update,
    announce(text) { live.textContent = ''; setTimeout(() => { live.textContent = text; }, 30); },
    welcomeSlot: town.welcomeSlot,
  };
}
