// Seeded generator (mulberry32). Pure: takes a seed, returns [value, nextSeed].
// The seed lives in the save, so the same save always replays the same rolls.

export function nextRandom(seed) {
  const a = (seed + 0x6d2b79f5) >>> 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, a];
}

export function newSeed() {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0];
}

// Mix whole numbers into one seed. Used to give every roll its own reproducible stream.
export function seedFrom(...parts) {
  let s = 0x9e3779b9;
  for (const p of parts) s = Math.floor(nextRandom((s + (p >>> 0)) >>> 0)[0] * 4294967296) >>> 0;
  return s;
}

// A small stateful generator for one batch of rolls: call it to get the next value in [0, 1).
export function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    const [v, next] = nextRandom(s);
    s = next;
    return v;
  };
}
