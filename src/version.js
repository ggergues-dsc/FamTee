// The app's version and build, stamped into the page by build/build.py (from VERSION,
// and the source tree's short hash for CI builds). Run from source, it says "dev".

const meta = (name) => (typeof document === 'undefined' ? '' : document.querySelector(`meta[name="${name}"]`)?.content ?? '');

export function appVersion() {
  const version = meta('famtee-version') || 'dev';
  const build = meta('famtee-build');
  return { version, build };
}

// "FamTee 1.1.15", or "FamTee dev" when run from source.
export function versionLabel({ version } = appVersion()) {
  return `FamTee ${version}`;
}
