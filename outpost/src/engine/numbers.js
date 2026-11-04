// Number formatting. Values are truncated, never rounded up, so a displayed
// amount is never more than the player actually holds.

const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc']; // Dc = 1e33

export const NUMBER_FORMATS = ['suffix', 'scientific', 'engineering', 'grouped'];

function trunc(n, digits) {
  const f = 10 ** digits;
  return Math.floor(n * f + 1e-9) / f;
}

function small(n) {
  // Below 1000: two decimals under 10, one under 100, none above.
  if (n < 10) return trunc(n, 2).toFixed(2);
  if (n < 100) return trunc(n, 1).toFixed(1);
  return String(Math.floor(n));
}

export function fmt(value, mode = 'suffix') {
  if (!Number.isFinite(value)) return value > 0 ? 'Infinity' : '0';
  if (value <= 0) return '0';
  if (value < 1000) return small(value);
  const exp = Math.floor(Math.log10(value) + 1e-12);
  // Grouped shows whole numbers with thousands separators up to a million, then falls back to suffixes.
  if (mode === 'grouped' && value < 1e6) return Math.floor(value).toLocaleString('en-US');
  if (mode === 'scientific') {
    return `${trunc(value / 10 ** exp, 2).toFixed(2)}e${exp}`;
  }
  if (mode === 'engineering') {
    const e3 = exp - (exp % 3);
    return `${trunc(value / 10 ** e3, 2).toFixed(2)}e${e3}`;
  }
  const tier = Math.floor(exp / 3);
  if (tier >= SUFFIXES.length) {
    return `${trunc(value / 10 ** exp, 2).toFixed(2)}e${exp}`;
  }
  return `${trunc(value / 10 ** (tier * 3), 2).toFixed(2)}${SUFFIXES[tier]}`;
}

export function fmtInt(value) {
  return Number.isFinite(value) ? String(Math.floor(value)) : '0';
}

export function fmtRate(value, mode = 'suffix') {
  if (!Number.isFinite(value) || value <= 0) return '0/s';
  if (value < 0.01) return '<0.01/s';
  return `${fmt(value, mode)}/s`;
}

export function fmtDuration(seconds) {
  if (!Number.isFinite(seconds)) return 'never';
  const s = Math.max(0, Math.ceil(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}
