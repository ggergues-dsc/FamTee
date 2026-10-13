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

Every session starts on the **start screen**: open the family stored in the file, continue an unsaved session kept
in this browser, start a new tree, or open another file. `#start=file|new|continue` skips it (ADR 0017).

| Action | How |
|---|---|
| See everything about a node | Click it: the side panel shows the editable fields and **All attributes** (every stored field, ID, photo, manual position) |
| Edit a person / partnership | Edit fields in the side panel (applied when a field loses focus or on Enter) |
| Add partner, child, parent | Buttons in the person panel; "+ Child" asks which partnership |
| Add person, rename the family | Panel with nothing selected (click empty canvas or press Esc) |
| Photos | Person panel → **Add photo…** (or drop an image on the circle). Shrunk to 256 px JPEG and embedded |
| Advanced (collapsed) | Groups, links to other graphs, sub-graphs, adding GEDCOM as a sub-graph, position/layout reset |
| Move a card | Drag it (one undoable step); cards in the way move aside. Advanced → "Reset position" / "Reset layout" |
| Layout direction | Family panel → **Layout**: generations top to bottom or left to right (saved per graph) |
| Pan / zoom | Drag the background; scroll wheel or pinch; + / − / Fit buttons; keys `+` `-` `0` |
| Delete | "Delete …" in the panel (click twice), or Delete/Backspace for the selected person or group |
| Undo / redo | Toolbar, Ctrl/⌘+Z, Ctrl/⌘+Shift+Z or Ctrl+Y |
| Keep working | Changes are kept **in this browser** automatically; the toolbar says when, and that they are not downloaded |
| Save to disk | **Download** (Ctrl/⌘+S): a new file named `<family>-<date-time>-<fingerprint>.html`, stamped with its content hash. Nothing is overwritten |
| Export / open | **Export ▾**: FamTee data (`.famtee.json`), GEDCOM, and (with several graphs) GEDCOM merged. **Open…** replaces the family with a file (undoable) |

Edits that would break integrity (e.g. making someone their own ancestor) are rejected with a message, and the
document is left unchanged.

## Test

```bash
python3 tests/run.py
```

Runs the Python build tests, then the JS test suite in headless Firefox twice (as ES modules over http and as
the bundled file from `file://`), then the end-to-end test against the built app (`tests/e2e.html`). For interactive debugging, serve the repo as above and open
`http://localhost:8000/tests/index.html`.

### In a disposable container

```bash
devops/test.sh
```

Runs the same suite in Docker with Python and Firefox ESR, on a read-only copy of the repo, with no network,
leaving nothing behind. See [devops/README.md](../devops/README.md) and ADR 0014.

### CI/CD: merge through the gate

Merge PRs with `devops/merge.sh <number>`: it tests the merge result in the container, merges only if green, and
writes a release to `releases/` (ADR 0015). `devops/ci.sh` runs the same pipeline on any commit.

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
    media.js          embedded photos: append-only store, safe-image check, pruning on save (ADR 0013)
  layout/
    layout.js         generational layout (ADR 0008): rank → order → place → pin
  render/
    renderer.js       SVG renderer with fixed layers (ADR 0003), connector lanes, link badges
    format.js         card text: names, lifespans, truncation
  io/photo.js         image file → 256 px JPEG data URI
  io/gedcom/
    lines.js          GEDCOM line parser/writer (levels, CONC/CONT, @@ escaping)
    convert.js        dates and names between GEDCOM and FamTee
    import.js         .ged → new graph (+ tile), with a report of what was skipped
    export.js         graph, or all graphs merged via same-as → GEDCOM 5.5.1, with a report of what GEDCOM can't hold
  persist/
    save.js           template capture, HTML/JSON output, File System Access write or download
    autosave.js       localStorage drafts + debounce
    import.js         read .famtee.json or FamTee .html
  ui/
    viewport.js       pan/zoom transform math: zoom at point, fit, screen→world
    interaction.js    Pointer Events: pan, pinch, wheel zoom, card drag (ADR 0012)
    panel.js          side panel: person / partnership / graph editing forms
    toolbar.js        undo, redo, save, export, import, save state
    dom.js            h() element helper, two-click confirm button, menu button
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

- Moved cards push other cards aside within their row; two cards both moved by hand can still overlap. No momentum
  panning.
- Sub-graph tiles can't be edited or deleted in place: clicking a tile opens the graph, and the graph can be
  renamed or deleted from there. Links can be made only from people (the model also allows unions and tiles).
- Group outlines are bounding boxes, so a group whose members are far apart can enclose other cards.
- Photos are stored only as 256 px versions; originals aren't kept. With many photos the browser draft backup
  may not fit (a notice says so).
- ANSEL-encoded GEDCOM files are read as UTF-8 (a warning says so). FamTee keeps one name per person; extra
  GEDCOM names are reported on import, not stored.
