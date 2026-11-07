import { setSetting } from '../engine/actions.js';
import { h, setText, setAttr } from './dom.js';
import { createAchievements } from './achievements.js';
import { createJournal } from './journal.js';

export function createSettings(ctx) {
  const msg = (el, text, kind = '') => {
    el.textContent = text;
    el.className = `note ${kind}`.trim();
  };

  // ---- Display ----
  const fmtSelect = h(
    'select',
    { id: 'set-format', onChange: (e) => ctx.run((s) => setSetting(s, 'numberFormat', e.target.value)) },
    [['suffix', 'Suffixes (1.23M)'], ['grouped', 'Grouped digits (123,456)'], ['scientific', 'Scientific (1.23e6)'], ['engineering', 'Engineering (123.45e3)']].map(([v, t]) => h('option', { value: v }, t)),
  );
  const motionSelect = h(
    'select',
    { id: 'set-motion', onChange: (e) => ctx.run((s) => setSetting(s, 'reducedMotion', e.target.value)) },
    [['auto', 'Follow my device'], ['on', 'Reduce motion'], ['off', 'Allow motion']].map(([v, t]) => h('option', { value: v }, t)),
  );

  const pick = (id, key, options) => h('select', { id, onChange: (e) => ctx.run((s) => setSetting(s, key, e.target.value)) }, options.map(([v, t]) => h('option', { value: v }, t)));
  const themeSelect = pick('set-theme', 'theme', [['auto', 'Follow my device'], ['dark', 'Dark'], ['light', 'Light']]);
  const textSelect = pick('set-text', 'textSize', [['normal', 'Normal'], ['large', 'Larger']]);
  const effectsSelect = pick('set-effects', 'effects', [['on', 'Show event notices and highlights'], ['off', 'Keep it quiet']]);
  const sceneSelect = pick('set-scene', 'scene', [['on', 'Show the town picture'], ['off', 'Hide it']]);
  const eventsSelect = pick('set-events', 'events', [['on', 'Show them'], ['off', 'Switch them off']]);
  const tutorialBtn = h('button', { class: 'btn', type: 'button', id: 'tutorial-again', onClick: () => ctx.run((s) => setSetting(s, 'tutorial', 'on')) }, 'Show the tutorial again');

  // ---- Saving ----
  const saveStatus = h('p', { class: 'note', id: 'save-status', role: 'status' });
  const exportBox = h('textarea', { id: 'export-text', class: 'save-text', readOnly: true, rows: 4, spellcheck: false, 'aria-label': 'Export string', placeholder: 'Press "Create export string" to fill this box.' });
  const exportMsg = h('p', { class: 'note', role: 'status' });
  const importBox = h('textarea', { id: 'import-text', class: 'save-text', rows: 4, spellcheck: false, 'aria-label': 'Import string', placeholder: 'Paste an export string here.' });
  const importMsg = h('p', { class: 'note', role: 'status' });

  const copyBtn = h('button', {
    class: 'btn', type: 'button',
    onClick: async () => {
      if (!exportBox.value) return msg(exportMsg, 'Create an export string first.', 'bad');
      try {
        await navigator.clipboard.writeText(exportBox.value);
        msg(exportMsg, 'Copied to the clipboard.', 'good');
      } catch {
        exportBox.focus();
        exportBox.select();
        msg(exportMsg, 'Copy was blocked here. The text is selected: press Ctrl+C (or Cmd+C).', 'warn');
      }
    },
  }, 'Copy');

  const eraseBtn = h('button', { class: 'btn btn-danger', type: 'button' }, 'Erase this save');
  let eraseTimer = null;
  eraseBtn.addEventListener('click', () => {
    if (eraseBtn.dataset.armed !== '1') {
      eraseBtn.dataset.armed = '1';
      eraseBtn.textContent = 'Press again to erase everything';
      eraseTimer = setTimeout(disarm, 5000);
      return;
    }
    disarm();
    ctx.eraseAll();
    msg(importMsg, 'Save erased. A new game has started.', 'good');
  });
  function disarm() {
    clearTimeout(eraseTimer);
    eraseBtn.dataset.armed = '0';
    eraseBtn.textContent = 'Erase this save';
  }

  const achievements = createAchievements();
  const journal = createJournal();
  const el = h(
    'section',
    { class: 'panel settings', id: 'panel-settings', 'aria-label': 'Settings' },
    h('div', { class: 'card' },
      h('h2', { class: 'h-sec' }, 'Display'),
      h('div', { class: 'field' }, h('label', { for: 'set-format' }, 'Number format'), fmtSelect),
      h('div', { class: 'field' }, h('label', { for: 'set-theme' }, 'Colours'), themeSelect),
      h('div', { class: 'field' }, h('label', { for: 'set-text' }, 'Text size'), textSelect),
      h('div', { class: 'field' }, h('label', { for: 'set-motion' }, 'Motion'), motionSelect),
      h('div', { class: 'field' }, h('label', { for: 'set-effects' }, 'Feedback'), effectsSelect),
      h('div', { class: 'field' }, h('label', { for: 'set-scene' }, 'Town picture'), sceneSelect),
      h('div', { class: 'field' }, h('label', { for: 'set-events' }, 'Timed decisions (caravans, omens)'), eventsSelect),
      h('div', { class: 'row' }, tutorialBtn),
    ),
    h('div', { class: 'card' },
      h('h2', { class: 'h-sec' }, 'Saving'),
      h('p', { class: 'muted' }, 'The game saves in this browser every 30 seconds and when you leave. Browsers can clear that storage, so keep an export string somewhere safe. It also moves your progress to another device.'),
      saveStatus,
      h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', onClick: () => msg(saveStatus, ctx.saveNow() ? 'Saved just now.' : 'This browser would not store the save. Use an export string instead.', ctx.storageOk() ? 'good' : 'bad') }, 'Save now'),
        h('button', { class: 'btn', type: 'button', onClick: async () => {
          exportBox.value = await ctx.exportState();
          msg(exportMsg, 'Export string created. Copy it to keep it.', 'good');
        } }, 'Create export string'),
        copyBtn,
      ),
      exportBox,
      exportMsg,
      h('h3', { class: 'h-sub' }, 'Load a save'),
      importBox,
      h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', onClick: async () => {
          const r = await ctx.importText(importBox.value);
          if (r.ok) { importBox.value = ''; msg(importMsg, 'Save loaded.', 'good'); } else msg(importMsg, r.error, 'bad');
        } }, 'Load save'),
      ),
      importMsg,
    ),
    achievements.el,
    journal.el,
    h('div', { class: 'card' },
      h('h2', { class: 'h-sec' }, 'Start over'),
      h('p', { class: 'muted' }, 'This removes your progress from this browser. Export first if you might want it back.'),
      h('div', { class: 'row' }, eraseBtn),
    ),
    h('div', { class: 'card' },
      h('h2', { class: 'h-sec' }, 'About'),
      h('p', { class: 'muted' }, 'Outpost of Azeroth is an unofficial, non-commercial fan project. Warcraft and its names belong to Blizzard Entertainment. This game uses none of Blizzard\'s art, audio or text; every picture is original.'),
      h('p', { class: 'muted', id: 'build-info' }, 'Checkpoint 11: hands-on play. Rally meter, building perks, edicts, timed decisions and hero commands.'),
    ),
  );

  function update(state) {
    achievements.update(state);
    journal.update(state);
    if (fmtSelect.value !== state.settings.numberFormat) fmtSelect.value = state.settings.numberFormat;
    if (motionSelect.value !== state.settings.reducedMotion) motionSelect.value = state.settings.reducedMotion;
    for (const [sel, key] of [[themeSelect, 'theme'], [textSelect, 'textSize'], [effectsSelect, 'effects'], [sceneSelect, 'scene'], [eventsSelect, 'events']]) if (sel.value !== state.settings[key]) sel.value = state.settings[key];
    setAttr(tutorialBtn, 'disabled', state.settings.tutorial === 'on');
    const t = ctx.lastSave();
    if (!ctx.storageOk()) setText(saveStatus, 'This browser is not keeping a save. Use an export string to keep your progress.');
    else if (t) setText(saveStatus, `Last saved at ${new Date(t).toLocaleTimeString()}.`);
    else setText(saveStatus, 'Not saved yet.');
  }
  return { el, update };
}
