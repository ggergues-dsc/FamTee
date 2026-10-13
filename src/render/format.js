// Text shown on cards. Kept separate from drawing so it can be unit-tested.

export function displayName(attrs = {}) {
  const name = attrs.name;
  if (typeof name === 'string') return name.trim() || 'Unnamed';
  const parts = [name?.given, name?.surname].filter((s) => typeof s === 'string' && s.trim());
  return parts.length ? parts.join(' ') : 'Unnamed';
}

export function lifespan(attrs = {}) {
  const birth = attrs.birth?.date;
  const death = attrs.death?.date;
  if (birth && death) return `${birth} – ${death}`;
  if (birth) return `b. ${birth}`;
  if (death) return `d. ${death}`;
  return '';
}

// Cuts text to fit roughly `width` pixels at the given average character width.
export function fitText(text, width, charWidth = 7.5) {
  const max = Math.max(1, Math.floor(width / charWidth));
  return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + '…';
}
