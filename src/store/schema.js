// Vocabulary of the native document format. See docs/data-model.md.

export const FORMAT = 'famtee';
export const CURRENT_SCHEMA_VERSION = 1;

export const NODE_TYPES = ['person', 'union', 'group', 'graphRef'];
export const EDGE_TYPES = ['partner', 'child', 'custom'];
export const LINK_TYPES = ['same-as', 'custom'];

// Cross-graph endpoints are written "graphId:nodeId".
export function endpoint(graphId, nodeId) {
  return `${graphId}:${nodeId}`;
}

export function parseEndpoint(value) {
  if (typeof value !== 'string') return null;
  const i = value.indexOf(':');
  if (i <= 0 || i === value.length - 1) return null;
  return { graphId: value.slice(0, i), nodeId: value.slice(i + 1) };
}
