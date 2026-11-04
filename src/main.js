import { DATA, validateData } from './engine/data.js';
import { newState } from './engine/state.js';
import { newSeed } from './engine/rng.js';
import { advance, effectiveSeconds, questSummary } from './engine/offline.js';
import { bonusOf } from './engine/renown.js';
import { serialize, deserialize, exportString, importString } from './engine/save.js';
import { readSave, writeSave, setAsideBrokenSave, eraseSave } from './storage.js';
import { createApp } from './ui/app.js';
import { createWelcome } from './ui/welcome.js';

const eco = DATA.economy;
const problems = validateData();
if (problems.length) console.error('Game data problems:', problems);

let state;
let noticeText = '';
let lastSave = 0;
let storageOk = true;
let saveTimer = null;
let renderQueued = false;

function freshGame() {
  return newState({ seed: newSeed(), now: Date.now() });
}

function load() {
  const raw = readSave();
  if (!raw) return freshGame();
  try {
    return deserialize(raw);
  } catch (err) {
    setAsideBrokenSave(raw);
    noticeText = `Your saved game could not be read. ${err.message} A copy was kept aside and a new game has started. You can still load an export string in Settings.`;
    return freshGame();
  }
}

function save() {
  storageOk = writeSave(serialize(state));
  if (storageOk) lastSave = Date.now();
  return storageOk;
}

const ctx = {
  state: () => state,
  // Run a validated action. On success the new state replaces the old one.
  run(fn) {
    const result = fn(state);
    if (result.ok) {
      state = result.state;
      refresh();
    }
    return result;
  },
  refresh,
  pulse(el) {
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  },
  announce: (text) => app.announce(text),
  saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 1000);
  },
  saveNow: save,
  lastSave: () => lastSave,
  storageOk: () => storageOk,
  notice: () => noticeText,
  exportState: () => exportString(state),
  async importText(text) {
    try {
      const imported = await importString(text);
      state = imported;
      catchUp(Date.now());
      save();
      refresh();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },
  eraseAll() {
    eraseSave();
    state = freshGame();
    noticeText = '';
    lastSave = 0;
    save();
    refresh();
  },
};

const root = document.getElementById('app');
const app = createApp(root, ctx);

function refresh() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    app.update(state);
  });
}

function showWelcome(report) {
  const slot = app.welcomeSlot;
  const card = createWelcome(report, state.settings.numberFormat, () => card.remove());
  slot.replaceChildren(card);
}

// Bring the game up to the current time. Long gaps show the welcome-back card.
function catchUp(now) {
  const { state: next, report } = advance(state, now);
  state = next;
  if (report.elapsed >= eco.welcomeBackMinSeconds) showWelcome(report);
}

state = load();
catchUp(Date.now());
save();
refresh();

// Live loop: wall-clock driven, so a throttled or sleeping tab catches up the same way.
let hiddenAt = null;
let hiddenRes = null;
let hiddenHeroes = [];
let hiddenSeq = 0;
setInterval(() => {
  state = advance(state, Date.now()).state;
  refresh();
}, eco.tickSeconds * 1000);

setInterval(save, 30_000);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hiddenAt = Date.now();
    hiddenRes = { ...state.res };
    hiddenSeq = state.quests.seq;
    hiddenHeroes = state.heroes.map((x) => ({ id: x.id, name: x.name, level: x.level }));
    state = advance(state, hiddenAt).state;
    save();
  } else if (hiddenAt !== null) {
    const now = Date.now();
    state = advance(state, now).state;
    const elapsed = (now - hiddenAt) / 1000;
    if (elapsed >= eco.welcomeBackMinSeconds) {
      const gains = {};
      for (const r of DATA.resources) gains[r.id] = state.res[r.id] - hiddenRes[r.id];
      const heroLevels = state.heroes
        .map((x) => ({ name: x.name, from: hiddenHeroes.find((o) => o.id === x.id)?.level ?? x.level, to: x.level }))
        .filter((x) => x.to > x.from);
      showWelcome({ elapsed, credited: effectiveSeconds(elapsed, DATA.economy.offlineTiers, bonusOf(state, 'offlineRate')), gains, beyondLimit: elapsed > eco.offlineTiers.at(-1).upToSeconds, heroLevels, quests: questSummary({ quests: { seq: hiddenSeq } }, state) });
    }
    hiddenAt = null;
    refresh();
  }
});
window.addEventListener('pagehide', () => {
  state = advance(state, Date.now()).state;
  save();
});
