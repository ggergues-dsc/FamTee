// GEDCOM line format (5.5.1 and 7): "level [@xref@] TAG [value]" per line, nested by
// level. CONT/CONC continuation lines are folded back into their parent's value.

const LINE = /^\s*(\d{1,2})\s+(?:(@[^@\s]+@)\s+)?([A-Za-z0-9_]+)(?: (.*))?$/;

// Returns { records: top-level nodes, warnings }. A node is
// { tag, xref, value, children, line }.
export function parseGedcom(text) {
  const warnings = [];
  const records = [];
  const stack = [];
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);

  lines.forEach((raw, i) => {
    if (!raw.trim()) return;
    const m = LINE.exec(raw);
    if (!m) {
      warnings.push(`Line ${i + 1} is not valid GEDCOM and was skipped`);
      return;
    }
    const level = Number(m[1]);
    const node = { tag: m[3].toUpperCase(), xref: m[2] ?? null, value: m[4] ?? '', children: [], line: i + 1 };

    if (level === 0) {
      stack.length = 0;
      records.push(node);
      stack.push(node);
      return;
    }
    if (!stack.length) {
      warnings.push(`Line ${i + 1} has no level-0 record above it and was skipped`);
      return;
    }
    stack.length = Math.min(stack.length, level);
    const parent = stack[stack.length - 1];
    if (node.tag === 'CONT') {
      parent.value += '\n' + node.value;
      return;
    }
    if (node.tag === 'CONC') {
      parent.value += node.value;
      return;
    }
    parent.children.push(node);
    stack.push(node);
  });
  return { records, warnings };
}

export const child = (node, tag) => node?.children.find((c) => c.tag === tag) ?? null;
export const childrenOf = (node, tag) => node?.children.filter((c) => c.tag === tag) ?? [];
export const valueOf = (node, tag) => child(node, tag)?.value.trim() ?? '';

// "@@" escapes a literal "@" in GEDCOM 5.5.1 values.
export const unescapeValue = (value) => value.replace(/@@/g, '@');
export const escapeValue = (value) => value.replace(/@/g, '@@');

// Writes one tag, splitting newlines with CONT and long lines with CONC (GEDCOM
// 5.5.1 lines must stay under 255 characters).
const CHUNK = 200;

export function writeTag(out, level, tag, value = '', xref = null) {
  const [first, ...rest] = String(value).split(/\r\n|\r|\n/);
  pushChunked(out, xref ? `${level} ${xref} ${tag}` : `${level} ${tag}`, first, level + 1);
  for (const line of rest) pushChunked(out, `${level + 1} CONT`, line, level + 1);
}

// Splits never fall next to a space: readers may trim spaces at line ends.
function pushChunked(out, head, text, concLevel) {
  const chunks = [];
  let rest = text;
  while (rest.length > CHUNK) {
    let cut = CHUNK;
    while (cut > 1 && (rest[cut - 1] === ' ' || rest[cut] === ' ')) cut--;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) chunks.push(rest);
  out.push(chunks.length ? `${head} ${chunks[0]}` : head);
  for (const c of chunks.slice(1)) out.push(`${concLevel} CONC ${c}`);
}
