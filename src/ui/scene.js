import { h, setText } from './dom.js';
import { sceneParts, sceneSvg, sceneCaption } from './scene-parts.js';

export function createScene() {
  const holder = h('div', {});
  const caption = h('p', { class: 'scene-caption' });
  const el = h('section', { class: 'card scene', id: 'scene', 'aria-label': 'Town picture' }, holder, caption);
  let sig = '';
  function update(state) {
    const p = sceneParts(state);
    const key = JSON.stringify(p);
    if (key !== sig) { sig = key; holder.innerHTML = sceneSvg(p); }
    setText(caption, sceneCaption(p, state));
  }
  return { el, update };
}
