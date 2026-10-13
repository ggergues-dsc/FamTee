// Minimal test harness that runs in any browser (ADR 0011). Results render into
// the page and, when the URL has ?report=<url>, are POSTed there for tests/run.py.

const tests = [];

export function test(name, fn) {
  tests.push({ name, fn });
}

export function assert(condition, message = 'assertion failed') {
  if (!condition) throw new Error(message);
}

export function assertEqual(actual, expected, message = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message ? message + ': ' : ''}expected ${e}, got ${a}`);
}

export function assertThrows(fn, pattern) {
  try {
    fn();
  } catch (e) {
    if (pattern && !pattern.test(e.message)) throw new Error(`threw "${e.message}", expected ${pattern}`);
    return e;
  }
  throw new Error(`expected an error${pattern ? ' matching ' + pattern : ''}`);
}

export async function run() {
  const results = [];
  for (const { name, fn } of tests) {
    try {
      await fn();
      results.push({ name, ok: true });
    } catch (e) {
      results.push({ name, ok: false, error: e.message });
    }
  }
  const failed = results.filter((r) => !r.ok).length;
  const summary = { total: results.length, failed, results, userAgent: navigator.userAgent };

  const out = document.getElementById('results');
  out.textContent = results.map((r) => `${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.ok ? '' : '\n     ' + r.error}`).join('\n') +
    `\n\n${results.length - failed}/${results.length} passed`;
  document.title = failed ? `FAIL (${failed})` : 'PASS';

  const report = new URLSearchParams(location.search).get('report');
  if (report) {
    await fetch(report, { method: 'POST', mode: 'no-cors', body: JSON.stringify(summary) });
  }
  return summary;
}
