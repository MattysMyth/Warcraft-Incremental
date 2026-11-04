// Tiny DOM helpers. The UI builds its elements once and then only patches text
// and classes, so buttons are never replaced under the player's finger.

export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key.includes('-') || key === 'role') el.setAttribute(key, value === true ? '' : value);
    else if (key in el) el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  add(el, kids);
  return el;
}

function add(el, kids) {
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
}

export function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

export function setClass(el, name, on) {
  if (el.classList.contains(name) !== !!on) el.classList.toggle(name, !!on);
}

export function setAttr(el, name, value) {
  if (value === false || value == null) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== String(value)) {
    el.setAttribute(name, value === true ? '' : String(value));
  }
}
