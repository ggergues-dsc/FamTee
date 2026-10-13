// Tiny DOM helper: h('button', { class: 'x', onclick }, 'text', child, ...).
// Strings become text nodes, so user data is never parsed as markup.

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key in el && typeof value !== 'string') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

// A button that asks for a second click before running `action` (no confirm() dialogs).
export function confirmButton(label, confirmLabel, action, props = {}) {
  let armed = false;
  let timer = null;
  const button = h('button', { type: 'button', ...props }, label);
  button.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      button.textContent = confirmLabel;
      button.classList.add('armed');
      timer = setTimeout(() => {
        armed = false;
        button.textContent = label;
        button.classList.remove('armed');
      }, 4000);
      return;
    }
    clearTimeout(timer);
    action();
  });
  return button;
}

// A button that opens a small menu of actions: items are { label, title, run }.
// Closes on choosing an item, Escape, or a click outside.
export function menuButton(label, items, props = {}) {
  const button = h('button', { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', ...props }, label);
  const menu = h('div', { class: 'menu', role: 'menu', hidden: true }, items.map((item) =>
    h('button', { type: 'button', role: 'menuitem', title: item.title ?? '', onclick: () => { close(); item.run(); } }, item.label)));
  const wrap = h('div', { class: 'menu-wrap' }, button, menu);

  function open() {
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    menu.querySelector('button')?.focus();
    document.addEventListener('pointerdown', onOutside, true);
  }
  function close() {
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
  }
  function onOutside(event) {
    if (!wrap.contains(event.target)) close();
  }
  button.addEventListener('click', () => (menu.hidden ? open() : close()));
  wrap.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !menu.hidden) {
      event.preventDefault();
      event.stopPropagation();
      close();
      button.focus();
    }
  });
  return { element: wrap, button, menu, close };
}
