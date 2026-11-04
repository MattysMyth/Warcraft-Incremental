import { setSetting } from '../engine/actions.js';
import { levelOf } from '../engine/derive.js';
import { h, setText, setClass } from './dom.js';

// A short first-run guide. Which step is showing comes from the game state, so nothing about it is saved
// except whether it has been dismissed (settings.tutorial).
const STEPS = [
  { tab: 'town', title: 'Build a Lumber Camp', text: 'Buildings make resources every second, even while the page is closed. You start with 10 gold: a Lumber Camp costs 8.', done: (s) => Object.values(s.town.buildings).some((n) => n > 0) },
  { tab: 'town', title: 'Build a Market', text: 'The Market makes gold, and gold buys everything else. It also needs a little lumber, which your camp is already making.', done: (s) => levelOf(s, 'market') > 0 },
  { tab: 'town', title: 'Build a House', text: 'Houses bring residents. Assign a resident to a building with the plus button and it makes 10% more.', done: (s) => levelOf(s, 'house') > 0 },
  { tab: 'town', title: 'Upgrade the Town Hall', text: 'The Town Hall card, top of the Town tab, unlocks new buildings and raises how far each can be built. The Tavern arrives at Town Hall 2.', done: (s) => s.town.townHall >= 2 },
  { tab: 'town', title: 'Build the Tavern', text: 'Adventurers gather at the Tavern. Build it, then recruit your first hero.', done: (s) => levelOf(s, 'tavern') > 0 },
  { tab: 'heroes', title: 'Recruit a hero', text: 'Pick someone in the Tavern list. Heroes train in the yard, wear gear and learn talents as they level.', done: (s) => s.heroes.length > 0 },
  { tab: 'quests', title: 'Send a quest out', text: 'Open a notice, choose who goes, and read the odds. Quests earn gold, experience and loot, and carry on while you are away.', done: (s) => (s.stats.questsDone ?? 0) > 0 || s.quests.active.length > 0 },
];
const TAB_NAME = { town: 'Town', heroes: 'Heroes', quests: 'Quests' };

export function createTutorial(ctx, { onGo }) {
  const kicker = h('p', { class: 'tut-step' });
  const title = h('h2', {});
  const text = h('p', {});
  const dots = h('div', { class: 'tut-dots', 'aria-hidden': 'true' }, STEPS.map(() => h('span', { class: 'tut-dot' })));
  const go = h('button', { class: 'btn btn-accent', type: 'button', onClick: () => onGo(go.dataset.tab) });
  const skip = h('button', { class: 'btn', type: 'button', id: 'tutorial-skip', onClick: () => ctx.run((s) => setSetting(s, 'tutorial', 'done')) }, 'Skip the tutorial');
  const finish = h('button', { class: 'btn btn-accent', type: 'button', id: 'tutorial-finish', onClick: () => ctx.run((s) => setSetting(s, 'tutorial', 'done')) }, 'Got it');
  const el = h('section', { class: 'tutorial', id: 'tutorial', 'aria-label': 'Getting started', hidden: true },
    kicker, title, text, dots, h('div', { class: 'row' }, go, finish, skip));

  function update(state) {
    el.hidden = state.settings.tutorial !== 'on';
    if (el.hidden) return;
    let at = STEPS.findIndex((st) => !st.done(state));
    const end = at < 0;
    if (end) at = STEPS.length;
    const st = STEPS[at];
    setText(kicker, end ? 'Getting started: all done' : `Getting started: step ${at + 1} of ${STEPS.length}`);
    setText(title, end ? 'You are on your way' : st.title);
    setText(text, end
      ? 'Heroes level up and find gear, zones open as you clear dungeons, and the Rebuild tab turns a good run into permanent Renown. Settings has this guide again whenever you want it.'
      : st.text);
    [...dots.children].forEach((d, i) => { setClass(d, 'is-done', i < at); setClass(d, 'is-now', i === at); });
    go.hidden = end;
    finish.hidden = !end;
    skip.hidden = end;
    if (!end) { go.dataset.tab = st.tab; setText(go, `Open the ${TAB_NAME[st.tab]} tab`); }
  }
  return { el, update };
}
