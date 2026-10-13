// Field conversions between GEDCOM and FamTee attrs: dates and names.

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const QUALIFIER = /^(ABT|CAL|EST|BEF|AFT|BET|FROM|TO|INT)\b/i;

// Exact GEDCOM dates become ISO-style ("14 MAR 1950" → "1950-03-14", "MAR 1950" →
// "1950-03", "1950" → "1950"). Anything else (ABT 1900, BET … AND …) is kept as written.
export function dateFromGedcom(value) {
  const s = value.trim();
  const up = s.toUpperCase();
  let m = /^(\d{1,2}) ([A-Z]{3}) (\d{3,4})$/.exec(up);
  if (m && MONTHS.includes(m[2])) return `${m[3].padStart(4, '0')}-${pad(MONTHS.indexOf(m[2]) + 1)}-${pad(m[1])}`;
  m = /^([A-Z]{3}) (\d{3,4})$/.exec(up);
  if (m && MONTHS.includes(m[1])) return `${m[2].padStart(4, '0')}-${pad(MONTHS.indexOf(m[1]) + 1)}`;
  if (/^\d{3,4}$/.test(s)) return s.padStart(4, '0');
  const phrase = /^\((.*)\)$/.exec(s);
  return phrase ? phrase[1] : s;
}

// The reverse. Free text that isn't a GEDCOM date becomes a date phrase "(…)".
export function dateToGedcom(value) {
  const s = String(value).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m && +m[2] >= 1 && +m[2] <= 12) return `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}`;
  m = /^(\d{4})-(\d{2})$/.exec(s);
  if (m && +m[2] >= 1 && +m[2] <= 12) return `${MONTHS[+m[2] - 1]} ${m[1]}`;
  if (/^\d{3,4}$/.test(s)) return s;
  if (QUALIFIER.test(s) || /^(\d{1,2} )?[A-Z]{3} \d{3,4}$/i.test(s)) return s.toUpperCase();
  return `(${s.replace(/[()]/g, '')})`;
}

const pad = (n) => String(n).padStart(2, '0');

// "John Paul /Smith/ Jr." → { given: 'John Paul', surname: 'Smith', suffix: 'Jr.' }.
// GIVN/SURN sub-tags, when present, win over the parsed parts.
export function nameFromGedcom(value, givn = '', surn = '') {
  const m = /^([^/]*)(?:\/([^/]*)\/?)?(.*)$/.exec(value.trim());
  const name = {};
  const given = (givn || m[1]).trim();
  const surname = (surn || m[2] || '').trim();
  const suffix = (m[3] || '').trim();
  if (given) name.given = given;
  if (surname) name.surname = surname;
  if (suffix) name.suffix = suffix;
  return name;
}

// Slashes mark the surname; a name without one is written without slashes.
export function nameToGedcom(name) {
  if (typeof name === 'string') return name.trim();
  const surname = name?.surname?.trim();
  return [name?.given?.trim(), surname && `/${surname}/`, name?.suffix?.trim()].filter(Boolean).join(' ');
}
