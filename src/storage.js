// Browser storage can be empty, blocked or throw (private windows, cleared site
// data), so every access is guarded and the game always works without it.

const KEY = 'outpost-of-azeroth.save';
const BROKEN_KEY = `${KEY}.unreadable`;

export function readSave() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function writeSave(text) {
  try {
    localStorage.setItem(KEY, text);
    return true;
  } catch {
    return false;
  }
}

// Keep an unreadable save aside instead of overwriting it, so it can be recovered.
export function setAsideBrokenSave(text) {
  try {
    localStorage.setItem(BROKEN_KEY, text);
  } catch {
    /* nothing more to do */
  }
}

export function eraseSave() {
  try {
    localStorage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}
