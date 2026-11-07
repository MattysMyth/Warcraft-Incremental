import { DATA } from '../engine/data.js';
import { fmt, fmtDuration } from '../engine/numbers.js';
import { h } from './dom.js';

// "While you were away" card. `report` comes from engine/offline.js.
export function createWelcome(report, mode, onClose) {
  const gains = DATA.resources
    .filter((r) => report.gains[r.id] > 0)
    .map((r) => h('li', {}, h('span', {}, r.name), h('span', { class: 'lead' }), h('span', {}, `+${fmt(report.gains[r.id], mode)}`)));
  const levels = (report.heroLevels ?? []).map((x) => h('li', {}, h('span', {}, x.name), h('span', { class: 'lead' }), h('span', {}, `level ${x.from} to ${x.to}`)));
  const qs = report.quests;
  const questLines = [];
  if (qs && (qs.done || qs.failed)) {
    questLines.push(h('li', {}, h('span', {}, 'Quests won'), h('span', { class: 'lead' }), h('span', {}, String(qs.done))));
    if (qs.failed) questLines.push(h('li', {}, h('span', {}, 'Quests failed'), h('span', { class: 'lead' }), h('span', {}, String(qs.failed))));
    if (qs.gold) questLines.push(h('li', {}, h('span', {}, 'Bounty gold'), h('span', { class: 'lead' }), h('span', {}, `+${fmt(qs.gold, mode)}`)));
    if (qs.items) questLines.push(h('li', {}, h('span', {}, 'Items found'), h('span', { class: 'lead' }), h('span', {}, String(qs.items))));
    if (qs.sold) questLines.push(h('li', {}, h('span', {}, 'Spare gear sold'), h('span', { class: 'lead' }), h('span', {}, `+${fmt(qs.sold, mode)}`)));
    if (qs.firstClears) questLines.push(h('li', {}, h('span', {}, 'First clears'), h('span', { class: 'lead' }), h('span', {}, String(qs.firstClears))));
    for (const [id, amt] of Object.entries(qs.res)) questLines.push(h('li', {}, h('span', {}, `${DATA.resourceById[id].name} brought back`), h('span', { class: 'lead' }), h('span', {}, `+${fmt(amt, mode)}`)));
  }
  const reduced = report.credited < report.elapsed - 1;
  return h(
    'section',
    { class: 'card welcome', role: 'region', 'aria-label': 'While you were away' },
    h('h2', { class: 'h-sec' }, 'While you were away'),
    h('p', {}, `The outpost ran for ${fmtDuration(report.elapsed)} and earned ${fmtDuration(report.credited)} of production.`),
    reduced
      ? h('p', { class: 'muted' }, report.beyondLimit
          ? 'Time away counts in full for the first 15 minutes, then at 40% to 2 hours, 15% to 12 hours and 5% up to 3 days. Anything past 3 days is not counted. Playing is worth more than waiting.'
          : 'Time away counts in full for the first 15 minutes, then at 40% to 2 hours, 15% to 12 hours and 5% up to 3 days. Playing is worth more than waiting.')
      : null,
    gains.length ? h('ul', { class: 'gains' }, gains) : null,
    levels.length ? h('p', { class: 'muted' }, 'Heroes who trained while you were away:') : null,
    levels.length ? h('ul', { class: 'gains' }, levels) : null,
    questLines.length ? h('p', { class: 'muted' }, 'Parties on the road:') : null,
    questLines.length ? h('ul', { class: 'gains' }, questLines) : null,
    qs && qs.running ? h('p', { class: 'muted' }, `${qs.running} ${qs.running === 1 ? 'party is' : 'parties are'} still out.`) : null,
    h('button', { class: 'btn', type: 'button', onClick: onClose }, 'Back to the outpost'),
  );
}
