import { DATA } from '../engine/data.js';
import { housingCapacity, freeResidents, workersAssigned, arrivalStatus, isHungry } from '../engine/derive.js';
import { fmt, fmtRate, fmtDuration } from '../engine/numbers.js';
import { h, setText, setClass } from './dom.js';

// Residents card: housing, who is working, and why the next settler has not come.
export function createResidents() {
  const headline = h('p', { class: 'big' });
  const split = h('p', {});
  const eating = h('p', { class: 'muted' });
  const status = h('p', { class: 'muted' });
  const hunger = h('p', { class: 'warn-box', role: 'status', hidden: true });
  const el = h('section', { class: 'card', 'aria-label': 'Residents' }, h('h2', { class: 'h-sec' }, 'Residents'), headline, split, eating, status, hunger);

  function update(state, info) {
    const mode = state.settings.numberFormat;
    const { residents } = state.town;
    const room = housingCapacity(state);
    setText(headline, `${residents} of ${room} housed`);
    setText(split, residents ? `${freeResidents(state)} free, ${workersAssigned(state)} working` : 'Nobody has settled yet.');
    setText(eating, residents ? `They eat ${fmtRate(info.food.uses.reduce((a, u) => a + u.amount, 0), mode)} of food.` : '');
    eating.hidden = !residents;

    const a = arrivalStatus(state);
    if (a.state === 'full') setText(status, 'Housing is full. Build a House to welcome more settlers.');
    else if (a.state === 'needsFood') setText(status, `Settlers come once the larder holds ${DATA.economy.residents.arrivalFood} food. Build a Farm.`);
    else setText(status, `Next settler in ${fmtDuration(a.secondsLeft)}.`);

    const hungry = isHungry(state);
    hunger.hidden = !hungry;
    setClass(el, 'is-hungry', hungry);
    if (hungry) setText(hunger, `The larder is empty. Quests will run at ${fmt(DATA.economy.hungerQuestSpeed * 100, mode)}% speed until it recovers (quests arrive in a later build).`);
  }
  return { el, update };
}
