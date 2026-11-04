import { DATA } from '../src/engine/data.js';
import { newState } from '../src/engine/state.js';

export const T0 = 1_700_000_000_000;
export const fresh = (over = {}) => ({ ...newState({ seed: 12345, now: T0 }), ...over });
export const withRes = (state, res) => ({ ...state, res: { ...state.res, ...res } });
export const withBuildings = (state, b) => ({
  ...state,
  town: { ...state.town, buildings: { ...state.town.buildings, ...b } },
});
export const eco = DATA.economy;
export { DATA };
