import { h } from './dom.js';

// Short event notices above the tab bar. Everything shown here is also in the event log; nothing needs audio or motion.
const WORTHY = [/^Achievement/, /^Standing in/, /is open to the outpost/, /output doubled/, / finished "/, / failed "/, /was hurt/, /retired from the road/, /^Rebuild \d/, /^Era \d/, /called back/];
const KEEP_MS = 4500;
const MAX = 3;

export function createToasts() {
  const el = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
  let head = undefined;
  let levels = null;

  function show(text) {
    while (el.children.length >= MAX) el.firstChild.remove();
    const t = h('p', { class: 'toast' }, text);
    el.append(t);
    setTimeout(() => t.remove(), KEEP_MS);
  }

  function update(state) {
    const log = state.log ?? [];
    const now = Object.fromEntries(state.heroes.map((x) => [x.id, x.level]));
    if (head === undefined || levels === null) { head = log[0] ?? null; levels = now; return; }
    const quiet = state.settings.effects === 'off';
    if (log[0] !== head) {
      const fresh = [];
      for (const e of log) { if (e === head) break; fresh.push(e); }
      head = log[0] ?? null;
      if (!quiet) for (const e of fresh.reverse().filter((x) => WORTHY.some((re) => re.test(x.text))).slice(-MAX)) show(e.text);
    }
    const up = state.heroes.filter((x) => levels[x.id] !== undefined && x.level > levels[x.id]);
    levels = now;
    if (!quiet && up.length) show(up.length === 1 ? `${up[0].name} reached level ${up[0].level}.` : `${up.length} heroes gained levels.`);
  }
  return { el, update };
}
