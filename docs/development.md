# Development

Toolchain: **Python 3** and **Firefox** (or another browser for manual testing). No Node.js, no npm
([ADR 0011](adr/0011-python-build-and-browser-tests.md)).

## Build

```bash
python3 build/build.py                                                      # blank app → dist/famtee.html
python3 build/build.py --data samples/sample.famtee.json --out dist/sample.html   # app with embedded data
```

`dist/` is git-ignored; the output is a single HTML file that opens from `file://` on any OS.

## Run during development

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000/src/index.html`; modules load natively, no build needed. (Opening `src/index.html`
directly from disk does **not** work — browsers block ES modules on `file://`; that's what the build is for.)

## View the samples

```bash
python3 build/build.py --data samples/extended.famtee.json --out dist/extended.html
```

Open the file in a browser. `samples/sample.famtee.json` shows multi-graph navigation (overview → family,
cross-graph "same person" badges); `samples/extended.famtee.json` is a four-generation family with remarriage,
divorce, adoption and a cousin marriage. Append `#g=<graphId>` to the URL to open a specific graph.

## Test

```bash
python3 tests/run.py
```

Runs the Python build tests, then the JS test suite in headless Firefox twice: as ES modules over http and as
the bundled file from `file://`. For interactive debugging, serve the repo as above and open
`http://localhost:8000/tests/index.html`.

## Code layout

```
src/
  index.html          HTML shell: stylesheet link, empty famtee-data block, one module script
  main.js             bootstrap: embedded data → Store → renderer; breadcrumb navigation, selection
  store/
    schema.js         format constants, node/edge/link types, "graphId:nodeId" endpoints
    ids.js            ULID ids with type prefixes (p-, u-, grp-, ref-, g-, e-, l-)
    model.js          document mutation helpers (addPerson, addUnion, addChild, addLink, removeNode, …)
    validate.js       integrity rules incl. ancestry cycles (via same-as identities) and graphRef cycles
    migrate.js        schemaVersion migrations; newer files open read-only
    serialize.js      JSON load/save, script-safe embedding, data-block replacement in HTML
    store.js          Store: apply() with snapshot undo/redo, validation rollback, change events
  layout/
    layout.js         generational layout (ADR 0008): rank → order → place → pin
  render/
    renderer.js       SVG renderer with fixed layers (ADR 0003), connector lanes, link badges
    format.js         card text: names, lifespans, truncation
  styles/main.css     theme tokens (light/dark) and graph styles
build/build.py        bundler + inliner
samples/              example documents
tests/                harness.js, *.test.js (browser), test_build.py (Python), run.py
```

## Changing the document: always through the Store

```js
const id = store.apply('Add person', (doc) => addPerson(doc, graphId, { name: { given: 'Ann' } }));
store.undo();
```

`apply` snapshots the document, runs the change, validates the whole document and rolls back (throwing
`ValidationError`) if any integrity rule breaks. At 50–100 people a full snapshot + validation is well under a
millisecond.

## Supported module syntax (bundler subset)

```js
import { a, b as c } from './x.js';
import * as ns from './x.js';
import './x.js';
export function f() {}      export async function f() {}      export class C {}
export const a = 1;         export { a, b as c };
```

Not supported (the build fails with a clear message): default imports/exports, `export … from`, dynamic
`import()`, `import.meta`, bare package specifiers, circular imports. Import/export statements must start a line.

## Current limitations

- No pan/zoom yet. Graphs are fitted to the window and never drawn above 1:1. Interactive pan/zoom is planned
  with vendored `d3-zoom` (ADR 0007), which needs the build to support vendored UMD scripts.
- Top-down orientation only (left-to-right is reserved as a layout option).
- Pinned nodes (`attrs.pos`) are placed after the automatic layout. Their neighbours don't move out of the way,
  so a pinned card can overlap others.
- No editing UI or saving yet. The Store and the data-block replacement are ready for it.
