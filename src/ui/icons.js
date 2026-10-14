// Line icons and placeholder portraits. Original drawings made for FamTee, so they ship
// without any third-party licence or attribution. The markup below is constant (never
// user data), so it is safe to assign as innerHTML.

const SVG_NS = 'http://www.w3.org/2000/svg';

// 24×24, drawn with currentColor strokes (styled by .icon-svg).
const ICONS = {
  family: '<circle cx="7" cy="6.5" r="2.5"/><circle cx="17" cy="6.5" r="2.5"/><circle cx="12" cy="12.5" r="2"/>' +
    '<path d="M2.5 19v-3.5A3.5 3.5 0 0 1 6 12h2a3.5 3.5 0 0 1 1.8.5M21.5 19v-3.5A3.5 3.5 0 0 0 18 12h-2a3.5 3.5 0 0 0-1.8.5M8.5 20.5v-1A2.5 2.5 0 0 1 11 17h2a2.5 2.5 0 0 1 2.5 2.5v1"/>',
  families: '<rect x="2.5" y="3" width="8" height="8" rx="2"/><rect x="13.5" y="3" width="8" height="8" rx="2"/>' +
    '<rect x="8" y="14" width="8" height="7" rx="2"/><path d="M6.5 11v1.5h11V11M12 12.5V14"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  person: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>',
  addPerson: '<circle cx="10" cy="8" r="3.5"/><path d="M3 20c.8-3.6 3.6-5.5 7-5.5 1.6 0 3 .4 4.2 1.1M18 14v6M15 17h6"/>',
  partners: '<circle cx="9" cy="13" r="5"/><circle cx="15" cy="13" r="5"/><path d="M10 4.5 12 6l2-1.5"/>',
  parents: '<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/>' +
    '<path d="M2.5 19c.6-3 2.7-4.5 5.5-4.5s4.9 1.5 5.5 4.5M13 15c.9-.3 1.9-.5 3-.5 2.8 0 4.9 1.5 5.5 4.5"/>',
  children: '<circle cx="12" cy="5.5" r="2.5"/><path d="M12 8v4M6 16v-2h12v2"/><circle cx="6" cy="18.5" r="2"/><circle cx="18" cy="18.5" r="2"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  partnership: '<circle cx="12" cy="12" r="3"/><path d="M3 12h6M15 12h6"/>',
  group: '<rect x="3" y="4" width="18" height="16" rx="3" stroke-dasharray="3 2.5"/><circle cx="9" cy="11" r="2"/><circle cx="15" cy="11" r="2"/>',
  fileTree: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><circle cx="12" cy="10.5" r="1.4"/><circle cx="9" cy="16.5" r="1.4"/>' +
    '<circle cx="15" cy="16.5" r="1.4"/><path d="M12 12v1.5M9 15v-1.5h6V15"/>',
  resume: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4v4h4"/><path d="M12 7.5V12l3 2"/>',
  sprout: '<path d="M12 21v-9"/><path d="M12 12c0-4 3-7 7-7 0 4-3 7-7 7z"/><path d="M12 15.5c0-3-2.5-5.5-6.5-5.5 0 3 2.5 5.5 6.5 5.5z"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 10.5v5M9.5 13l2.5 2.5 2.5-2.5"/>',
};

export function icon(name) {
  const el = document.createElementNS(SVG_NS, 'svg');
  el.setAttribute('class', 'icon-svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = ICONS[name] ?? '';
  return el;
}

// Placeholder portraits for people without a photo, by sex (M, F, or neutral for U).
// 40×40 and meant to be clipped to a circle of radius 19.5 centred at (20, 20).
const PORTRAITS = {
  U: '<circle class="portrait" cx="20" cy="16" r="7"/><path class="portrait" d="M5 41c0-8.5 6.7-14 15-14s15 5.5 15 14z"/>',
  M: '<path class="portrait" d="M13 15.5c0-5 3-8.5 7-8.5s7 3.5 7 8.5c0 4.5-3 8-7 8s-7-3.5-7-8z"/>' +
    '<path class="portrait-hair" d="M12.6 14c.4-5.2 3.3-8.3 7.4-8.3s7 3.1 7.4 8.3c-1.6-1.9-4.2-2.6-7.4-2.6s-5.8.7-7.4 2.6z"/>' +
    '<path class="portrait" d="M3 41c0-9 7-14.5 17-14.5S37 32 37 41z"/><path class="portrait-collar" d="M16.8 26.8 20 31l3.2-4.2"/>',
  F: '<path class="portrait-hair" d="M11.5 25c-1.2-2.5-1.5-5.5-1.5-8.5C10 10.5 14.3 6 20 6s10 4.5 10 10.5c0 3-.3 6-1.5 8.5z"/>' +
    '<circle class="portrait" cx="20" cy="16.5" r="6.5"/><path class="portrait" d="M7 41c0-8 5.8-13.5 13-13.5S33 33 33 41z"/>',
};

export const portraitSex = (sex) => (sex === 'M' || sex === 'F' ? sex : 'U');

// The portrait's shapes as markup, for an element whose box is 40×40.
export function portraitMarkup(sex) {
  return PORTRAITS[portraitSex(sex)];
}

// A standalone portrait for HTML; its container is round and clips it (overflow: hidden).
export function portrait(sex) {
  const el = document.createElementNS(SVG_NS, 'svg');
  el.setAttribute('viewBox', '0 0 40 40');
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = portraitMarkup(sex);
  return el;
}
