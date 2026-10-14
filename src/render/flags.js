// Tiny country flags (15×10) for a person's country of birth, drawn as plain shapes so
// they look the same on every system (flag emoji show as two letters on Windows).
// Detailed emblems are simplified to a dot, star or disc: at this size the colours and
// layout are what people recognise. The country is the last part of the birthplace
// ("Cork, Ireland" → Ireland). Unknown countries get no flag.

const RED = '#d52b1e';
const WHITE = '#ffffff';

// Stripes along one axis; `weights` sets their relative widths.
const stripes = (dir, colors, weights = colors.map(() => 1)) => {
  const total = weights.reduce((a, b) => a + b, 0);
  const size = dir === 'h' ? 10 : 15;
  let at = 0;
  return colors.map((c, i) => {
    const len = (weights[i] / total) * size;
    const r = dir === 'h' ? `<rect y="${at}" width="15" height="${len}" fill="${c}"/>` : `<rect x="${at}" width="${len}" height="10" fill="${c}"/>`;
    at += len;
    return r;
  }).join('');
};
const h = (...colors) => stripes('h', colors);
const v = (...colors) => stripes('v', colors);
const field = (c) => `<rect width="15" height="10" fill="${c}"/>`;
const dot = (c, cx = 7.5, cy = 5, r = 1.6) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}"/>`;
const star = (c, cx = 7.5, cy = 5, r = 2) => {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.42 : r;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="${c}"/>`;
};
// Off-centre (Nordic) cross; `inner` draws a thinner cross of a second colour inside.
const nordic = (bg, cross, inner = null) => field(bg) +
  `<rect x="4" width="3" height="10" fill="${cross}"/><rect y="3.5" width="15" height="3" fill="${cross}"/>` +
  (inner ? `<rect x="4.75" width="1.5" height="10" fill="${inner}"/><rect y="4.25" width="15" height="1.5" fill="${inner}"/>` : '');
const centredCross = (bg, cross, w = 2.4) => field(bg) +
  `<rect x="${7.5 - w / 2}" width="${w}" height="10" fill="${cross}"/><rect y="${5 - w / 2}" width="15" height="${w}" fill="${cross}"/>`;
const crescent = (bg, fg, cx = 6.5) => `<circle cx="${cx}" cy="5" r="2.6" fill="${fg}"/><circle cx="${cx + 0.8}" cy="5" r="2.1" fill="${bg}"/>`;
const unionJack = '<rect width="15" height="10" fill="#012169"/><path d="M0 0 15 10M15 0 0 10" stroke="#fff" stroke-width="2"/>' +
  '<path d="M0 0 15 10M15 0 0 10" stroke="#c8102e" stroke-width="0.7"/>' +
  '<rect x="6" width="3" height="10" fill="#fff"/><rect y="3.5" width="15" height="3" fill="#fff"/>' +
  '<rect x="6.6" width="1.8" height="10" fill="#c8102e"/><rect y="4.1" width="15" height="1.8" fill="#c8102e"/>';
const canton = (markup, w = 7, hgt = 5) => `<svg width="${w}" height="${hgt}" viewBox="0 0 15 10" preserveAspectRatio="none">${markup}</svg>`;

const FLAGS = {
  // British Isles
  England: centredCross(WHITE, '#ce1124'),
  Scotland: field('#005eb8') + '<path d="M0 0 15 10M15 0 0 10" stroke="#fff" stroke-width="1.8"/>',
  Wales: h(WHITE, '#00b140') + dot('#c8102e', 7.5, 5, 2.2),
  'United Kingdom': unionJack,
  Ireland: v('#169b62', WHITE, '#ff883e'),
  // Western and Northern Europe
  France: v('#002395', WHITE, '#ed2939'),
  Italy: v('#009246', WHITE, '#ce2b37'),
  Belgium: v('#000000', '#fdda24', '#ef3340'),
  Germany: h('#000000', '#dd0000', '#ffce00'),
  Netherlands: h('#ae1c28', WHITE, '#21468b'),
  Luxembourg: h('#ed2939', WHITE, '#00a1de'),
  Austria: h('#ed2939', WHITE, '#ed2939'),
  Switzerland: field('#da291c') + '<rect x="6.5" y="2" width="2" height="6" fill="#fff"/><rect x="4.5" y="4" width="6" height="2" fill="#fff"/>',
  Spain: stripes('h', ['#aa151b', '#f1bf00', '#aa151b'], [1, 2, 1]),
  Portugal: stripes('v', ['#006600', '#ff0000'], [2, 3]) + dot('#ffcc00', 6, 5, 1.8),
  Sweden: nordic('#006aa7', '#fecc00'),
  Norway: nordic('#ba0c2f', WHITE, '#00205b'),
  Denmark: nordic('#c8102e', WHITE),
  Finland: nordic(WHITE, '#002f6c'),
  Iceland: nordic('#02529c', WHITE, '#dc1e35'),
  Greece: stripes('h', ['#0d5eaf', WHITE, '#0d5eaf', WHITE, '#0d5eaf', WHITE, '#0d5eaf', WHITE, '#0d5eaf']) +
    '<rect width="6" height="5.6" fill="#0d5eaf"/><rect x="2.4" width="1.2" height="5.6" fill="#fff"/><rect y="2.2" width="6" height="1.2" fill="#fff"/>',
  // Central and Eastern Europe
  Poland: h(WHITE, '#dc143c'),
  Ukraine: h('#0057b7', '#ffd700'),
  Russia: h(WHITE, '#0039a6', '#d52b1e'),
  Hungary: h('#ce2939', WHITE, '#477050'),
  Romania: v('#002b7f', '#fcd116', '#ce1126'),
  Bulgaria: h(WHITE, '#00966e', '#d62612'),
  Lithuania: h('#fdb913', '#006a44', '#c1272d'),
  Estonia: h('#0072ce', '#000000', WHITE),
  Latvia: stripes('h', ['#9e3039', WHITE, '#9e3039'], [2, 1, 2]),
  Armenia: h('#d90012', '#0033a0', '#f2a800'),
  Turkey: field('#e30a17') + crescent('#e30a17', WHITE) + star(WHITE, 9.6, 5, 1.2),
  // Middle East and North Africa
  Lebanon: stripes('h', ['#ed1c24', WHITE, '#ed1c24'], [1, 2, 1]) + star('#00a651', 7.5, 5, 2),
  Syria: h('#ce1126', WHITE, '#000000') + star('#007a3d', 5.5, 5, 1.1) + star('#007a3d', 9.5, 5, 1.1),
  Egypt: h('#ce1126', WHITE, '#000000') + dot('#c09300', 7.5, 5, 1.2),
  Iraq: h('#ce1126', WHITE, '#000000') + '<rect x="5" y="4.5" width="5" height="1" fill="#007a3d"/>',
  Yemen: h('#ce1126', WHITE, '#000000'),
  Jordan: h('#000000', WHITE, '#007a3d') + '<polygon points="0,0 7,5 0,10" fill="#ce1126"/>' + star(WHITE, 2.6, 5, 0.9),
  Palestine: h('#000000', WHITE, '#007a3d') + '<polygon points="0,0 6,5 0,10" fill="#ce1126"/>',
  Israel: field(WHITE) + '<rect y="1" width="15" height="1.4" fill="#0038b8"/><rect y="7.6" width="15" height="1.4" fill="#0038b8"/>' +
    '<polygon points="7.5,3.2 9,5.8 6,5.8" fill="none" stroke="#0038b8" stroke-width="0.5"/><polygon points="7.5,6.6 9,4 6,4" fill="none" stroke="#0038b8" stroke-width="0.5"/>',
  'Saudi Arabia': field('#006c35') + '<rect x="4" y="6.5" width="7" height="0.7" fill="#fff"/>',
  'United Arab Emirates': h('#00732f', WHITE, '#000000') + '<rect width="4" height="10" fill="#ff0000"/>',
  Kuwait: h('#007a3d', WHITE, '#ce1126') + '<polygon points="0,0 4,3.3 4,6.7 0,10" fill="#000"/>',
  Iran: h('#239f40', WHITE, '#da0000') + dot('#da0000', 7.5, 5, 1),
  Morocco: field('#c1272d') + '<polygon points="7.5,2.6 8.9,7 5.2,4.3 9.8,4.3 6.1,7" fill="none" stroke="#006233" stroke-width="0.6"/>',
  Algeria: v('#006633', WHITE) + crescent(WHITE, '#d21034', 7.3),
  Tunisia: field('#e70013') + dot(WHITE, 7.5, 5, 2.6) + crescent(WHITE, '#e70013', 7.2),
  // Africa
  Nigeria: v('#008751', WHITE, '#008751'),
  Ghana: h('#ce1126', '#fcd116', '#006b3f') + star('#000', 7.5, 5, 1.4),
  Kenya: h('#000000', '#bb0000', '#006600') + '<rect y="3.2" width="15" height="0.5" fill="#fff"/><rect y="6.3" width="15" height="0.5" fill="#fff"/>',
  Ethiopia: h('#078930', '#fcdd09', '#da121a') + dot('#0f47af', 7.5, 5, 1.8),
  'South Africa': h('#e03c31', WHITE, '#001489') + '<polygon points="0,0 7,5 0,10" fill="#007749"/><polygon points="0,1.5 5,5 0,8.5" fill="#000"/>',
  // Asia and Oceania
  India: h('#ff9933', WHITE, '#138808') + dot('#000080', 7.5, 5, 1.2),
  Pakistan: '<rect width="4" height="10" fill="#fff"/><rect x="4" width="11" height="10" fill="#01411c"/>' + crescent('#01411c', WHITE, 9) + star(WHITE, 11.2, 4, 0.9),
  Bangladesh: field('#006a4e') + dot('#f42a41', 6.6, 5, 3),
  China: field('#de2910') + star('#ffde00', 3, 3, 1.8),
  Japan: field(WHITE) + dot('#bc002d', 7.5, 5, 3),
  Vietnam: field('#da251d') + star('#ffff00', 7.5, 5, 3),
  Philippines: h('#0038a8', '#ce1126') + '<polygon points="0,0 8,5 0,10" fill="#fff"/>' + dot('#fcd116', 2.8, 5, 1),
  Thailand: stripes('h', ['#a51931', WHITE, '#2d2a4a', WHITE, '#a51931'], [1, 1, 2, 1, 1]),
  Indonesia: h('#ce1126', WHITE),
  Australia: field('#012169') + canton(unionJack) + star(WHITE, 3.5, 7.6, 1.2) + star(WHITE, 11, 3, 0.8) + star(WHITE, 12, 7, 0.8),
  'New Zealand': field('#012169') + canton(unionJack) + star('#c8102e', 11, 3, 0.9) + star('#c8102e', 12, 7, 0.9),
  // Americas
  'United States': stripes('h', Array.from({ length: 13 }, (_, i) => (i % 2 ? WHITE : '#b22234'))) + '<rect width="6.5" height="5.4" fill="#3c3b6e"/>',
  Canada: stripes('v', [RED, WHITE, RED], [1, 2, 1]) + '<polygon points="7.5,2.2 9,5.6 7.5,7.6 6,5.6" fill="#d52b1e"/>',
  Mexico: v('#006847', WHITE, '#ce1126') + dot('#8c5a2b', 7.5, 5, 1.2),
  Brazil: field('#009c3b') + '<polygon points="7.5,1.2 14,5 7.5,8.8 1,5" fill="#ffdf00"/>' + dot('#002776', 7.5, 5, 2.2),
  Argentina: h('#74acdf', WHITE, '#74acdf') + dot('#f6b40e', 7.5, 5, 1.1),
  Colombia: stripes('h', ['#fcd116', '#003893', '#ce1126'], [2, 1, 1]),
  Peru: v('#d91023', WHITE, '#d91023'),
  Chile: '<rect width="15" height="5" fill="#fff"/><rect y="5" width="15" height="5" fill="#d52b1e"/><rect width="5" height="5" fill="#0039a6"/>' + star(WHITE, 2.5, 2.5, 1.3),
  Cuba: stripes('h', ['#002a8f', WHITE, '#002a8f', WHITE, '#002a8f']) + '<polygon points="0,0 7,5 0,10" fill="#cf142b"/>' + star(WHITE, 2.4, 5, 1.1),
  Jamaica: field('#009b3a') + '<polygon points="0,0 7.5,5 0,10" fill="#000"/><polygon points="15,0 7.5,5 15,10" fill="#000"/>' +
    '<path d="M0 0 15 10M15 0 0 10" stroke="#fed100" stroke-width="1.4"/>',
};

// Other names people write for the same countries.
const ALIASES = {
  uk: 'United Kingdom', 'great britain': 'United Kingdom', britain: 'United Kingdom',
  usa: 'United States', us: 'United States', 'u.s.a.': 'United States', 'u.s.': 'United States', 'united states of america': 'United States', america: 'United States',
  holland: 'Netherlands', 'the netherlands': 'Netherlands',
  uae: 'United Arab Emirates', 'republic of ireland': 'Ireland', eire: 'Ireland', éire: 'Ireland',
  deutschland: 'Germany', españa: 'Spain', türkiye: 'Turkey', 'state of palestine': 'Palestine',
  persia: 'Iran', 'russian federation': 'Russia', 'viet nam': 'Vietnam',
};
const BY_LOWER = new Map(Object.keys(FLAGS).map((name) => [name.toLowerCase(), name]));

// The country named at the end of a place ("Cork, Ireland"), if we have its flag.
export function countryOf(place) {
  const last = String(place ?? '').split(',').pop().trim().replace(/\.$/, '').toLowerCase();
  if (!last) return null;
  if (last in ALIASES) return ALIASES[last];
  return BY_LOWER.get(last) ?? null;
}

// The flag's shapes in a 15×10 box, with a thin edge so white flags show on white cards.
export function flagMarkup(country) {
  return FLAGS[country] ? `${FLAGS[country]}<rect class="flag-edge" width="15" height="10" rx="1"/>` : '';
}

export const FLAG_COUNTRIES = Object.keys(FLAGS);
