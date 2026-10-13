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

Open the file in a browser and click a person to edit them. `samples/sample.famtee.json` shows multi-graph navigation (overview → family,
cross-graph "same person" badges); `samples/extended.famtee.json` is a four-generation family with remarriage,
divorce, adoption and a cousin marriage. Append `#g=<graphId>&sel=<nodeId>` to the URL to open a specific graph with a node selected.

## Editing and saving

| Action | How |
|---|---|
| Edit a person / partnership | Click it; edit fields in the side panel (applied when a field loses focus or on Enter) |
| Add partner, child, parent | Buttons in the person panel; "+ Child" asks which partnership |
| Add person / sub-graph, rename | Panel with nothing selected (click empty canvas or press Esc) |
| Delete | "Delete …" in the panel (click twice), or Delete/Backspace for the selected person |
| Undo / redo | Toolbar, Ctrl/⌘+Z, Ctrl/⌘+Shift+Z or Ctrl+Y |
| Save | Ctrl/⌘+S or Save. Chromium overwrites the file you pick; Firefox/Safari download a new copy |
| Export / import | Export JSON writes `.famtee.json`; Import… reads `.famtee.json` or a FamTee `.html` (undoable) |

Edits that would break integrity (e.g. making someone their own ancestor) are rejected with a message, and the
document is left unchanged.

## Test

```bash
python3 tests/run.py
```

Runs the Python build tests, then the JS test suite in headless Firefox twice (as ES modules over http and as
the bundled file from `file://`), then the end-to-end test against the built app (`tests/e2e.html`). For interactive debugging, serve the repo as above and open
`http://localhost:8000/tests/index.html`.

## Code layout

```
src/
  index.html          HTML shell: stylesheet link, empty famtee-data block, one module script
  main.js             wiring: Store ↔ renderer, panel, toolbar, keyboard, save/autosave/import
  store/
    schema.js         format constants, node/edge/link types, "graphId:nodeId" endpoints
    ids.js            ULID ids with type prefixes (p-, u-, grp-, ref-, g-, e-, l-)
    model.js          document mutation helpers (addPerson, addUnion, addChild, addLink, removeNode, …)
    validate.js       integrity rules incl. ancestry cycles (via same-as identities) and graphRef cycles
    migrate.js        schemaVersion migrations; newer files open read-only
    serialize.js      JSON load/save, script-safe embedding, data-block replacement in HTML
    store.js          Store: apply() with snapshot undo/redo, validation rollback, change events
    family.js         family-level edits: add partner/child/parent, remove person, replace document
  layout/
    layout.js         generational layout (ADR 0008): rank → order → place → pin
  render/
    renderer.js       SVG renderer with fixed layers (ADR 0003), connector lanes, link badges
    format.js         card text: names, lifespans, truncation
  persist/
    save.js           template capture, HTML/JSON output, File System Access write or download
    autosave.js       localStorage drafts + debounce
    import.js         read .famtee.json or FamTee .html
  ui/
    panel.js          side panel: person / partnership / graph editing forms
    toolbar.js        undo, redo, save, export, import, save state
    dom.js            h() element helper, two-click confirm button
  styles/main.css     theme tokens (light/dark), graph and app styles
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
- No drag-to-move yet (the `attrs.pos` override and "Reset position" exist, but nothing sets positions).
- No UI yet for cross-graph links (`same-as`), groups, or editing/deleting a sub-graph tile in place. Clicking a
  tile opens the graph, and the graph can be renamed or deleted from there.
- GEDCOM import/export (ADR 0010) is not implemented.
