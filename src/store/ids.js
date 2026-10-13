// ULID-based identifiers (ADR 0004): time-sortable and collision-free, so
// documents and graphs can be merged without renumbering.

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32

export const ID_PREFIX = {
  graph: 'g',
  person: 'p',
  union: 'u',
  group: 'grp',
  graphRef: 'ref',
  edge: 'e',
  link: 'l',
};

export function ulid(now = Date.now()) {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = ENCODING[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let random = '';
  for (const b of bytes) random += ENCODING[b % 32];
  return time + random;
}

export function newId(kind) {
  const prefix = ID_PREFIX[kind];
  if (!prefix) throw new Error(`Unknown id kind: ${kind}`);
  return `${prefix}-${ulid()}`;
}
