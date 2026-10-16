#!/usr/bin/env python3
"""Build FamTee into one self-contained HTML file (ADR 0001, 0002, 0011).

Inlines the module entry script, stylesheets and an optional data document into
the HTML shell so the result works from file:// with no network.

    python3 build/build.py                                   # src/index.html -> dist/famtee.html
    python3 build/build.py --data samples/sample.famtee.json --out dist/sample.html

The bundler supports a deliberate subset of ES module syntax. Anything else is a
build error rather than silently broken output:

    import { a, b as c } from './x.js';     import * as ns from './x.js';
    import './x.js';
    export function f() {}    export async function f() {}    export class C {}
    export const a = ...;     export let a = ...;              export { a, b as c };

Not supported: default imports/exports, re-exports (export ... from), dynamic
import(), import.meta, circular imports. Import/export statements must start at
the beginning of a line. Imported bindings are copies, so don't reassign
exported `let` variables.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class BuildError(Exception):
    pass


# --- module bundler ---------------------------------------------------------

IMPORT_RE = re.compile(
    r"^[ \t]*import[ \t]+(?:(?P<clause>[\w$*{}\s,]+?)\s+from\s*)?(?P<q>['\"])(?P<spec>[^'\"]+)(?P=q)[ \t]*;?",
    re.M,
)
EXPORT_DECL_RE = re.compile(
    r"^(?P<indent>[ \t]*)export[ \t]+(?P<kw>(?:async[ \t]+)?function\*?|class|const|let|var)[ \t]+(?P<name>[\w$]+)",
    re.M,
)
EXPORT_LIST_RE = re.compile(r"^[ \t]*export[ \t]*\{(?P<names>[^}]*)\}[ \t]*(?P<from>from\b)?[^;\n]*;?", re.M)
ANY_EXPORT_RE = re.compile(r"^[ \t]*export\b", re.M)
DYNAMIC_IMPORT_RE = re.compile(r"\bimport\s*\(|\bimport\.meta\b")
IDENT_RE = re.compile(r"^[A-Za-z_$][\w$]*$")


def module_id(path: Path) -> str:
    return path.resolve().relative_to(ROOT).as_posix()


def resolve(spec: str, importer: Path) -> Path:
    if not spec.startswith(("./", "../")):
        raise BuildError(f"{module_id(importer)}: only relative imports are supported, got '{spec}'")
    target = (importer.parent / spec).resolve()
    if not target.is_file():
        raise BuildError(f"{module_id(importer)}: cannot find '{spec}'")
    return target


def parse_names(text: str, where: str) -> list[tuple[str, str]]:
    """Parse 'a, b as c' into [(a, a), (b, c)] as (source name, local name)."""
    pairs = []
    for part in text.split(","):
        part = part.strip()
        if not part:
            continue
        bits = part.split()
        if len(bits) == 1:
            pairs.append((bits[0], bits[0]))
        elif len(bits) == 3 and bits[1] == "as":
            pairs.append((bits[0], bits[2]))
        else:
            raise BuildError(f"{where}: cannot parse '{part}'")
        for name in pairs[-1]:
            if not IDENT_RE.match(name):
                raise BuildError(f"{where}: invalid identifier '{name}'")
    return pairs


def transform(path: Path, source: str) -> tuple[str, list[Path]]:
    """Rewrite one module into a function body; return (body, dependency paths)."""
    mid = module_id(path)
    if DYNAMIC_IMPORT_RE.search(source):
        raise BuildError(f"{mid}: dynamic import() and import.meta are not supported")

    deps: list[Path] = []

    def replace_import(m: re.Match) -> str:
        target = resolve(m["spec"], path)
        deps.append(target)
        req = f'__require("{module_id(target)}")'
        clause = (m["clause"] or "").strip()
        if not clause:
            return f"{req};"
        if clause.startswith("*"):
            ns = re.fullmatch(r"\*\s+as\s+([\w$]+)", clause)
            if not ns:
                raise BuildError(f"{mid}: cannot parse import '{clause}'")
            return f"const {ns[1]} = {req};"
        if clause.startswith("{") and clause.endswith("}"):
            pairs = parse_names(clause[1:-1], mid)
            fields = ", ".join(src if src == local else f"{src}: {local}" for src, local in pairs)
            return f"const {{ {fields} }} = {req};"
        raise BuildError(f"{mid}: default imports are not supported ('{clause}')")

    body = IMPORT_RE.sub(replace_import, source)

    exports: list[tuple[str, str]] = []  # (exported name, local name)

    def replace_list(m: re.Match) -> str:
        if m["from"]:
            raise BuildError(f"{mid}: re-exports ('export ... from') are not supported")
        exports.extend((exported, local) for local, exported in parse_names(m["names"], mid))
        return ""

    body = EXPORT_LIST_RE.sub(replace_list, body)

    def replace_decl(m: re.Match) -> str:
        exports.append((m["name"], m["name"]))
        return f"{m['indent']}{m['kw']} {m['name']}"

    body = EXPORT_DECL_RE.sub(replace_decl, body)

    leftover = ANY_EXPORT_RE.search(body)
    if leftover:
        line = body[leftover.start():].splitlines()[0].strip()
        raise BuildError(f"{mid}: unsupported export syntax: {line}")

    # Getters keep exports live and work with hoisted function declarations.
    getters = "".join(
        f'  Object.defineProperty(exports, "{exported}", {{ enumerable: true, get: () => {local} }});\n'
        for exported, local in exports
    )
    return getters + body, deps


def bundle(entry: Path) -> str:
    """Bundle `entry` and its imports into one classic script (an IIFE)."""
    order: list[Path] = []
    bodies: dict[Path, str] = {}
    visiting: list[Path] = []

    def visit(path: Path) -> None:
        if path in bodies:
            return
        if path in visiting:
            cycle = visiting[visiting.index(path):] + [path]
            raise BuildError("circular import: " + " -> ".join(module_id(p) for p in cycle))
        visiting.append(path)
        body, deps = transform(path, path.read_text(encoding="utf-8"))
        for dep in deps:
            visit(dep)
        visiting.pop()
        bodies[path] = body
        order.append(path)

    visit(entry.resolve())

    parts = [
        "(() => {",
        '"use strict";',
        "const __modules = {};",
        "const __cache = {};",
        "function __require(id) {",
        "  if (id in __cache) return __cache[id];",
        "  const exports = (__cache[id] = {});",
        "  __modules[id](exports);",
        "  return exports;",
        "}",
    ]
    for path in order:
        parts.append(f'__modules["{module_id(path)}"] = function (exports) {{')
        parts.append(bodies[path].rstrip())
        parts.append("};")
    parts.append(f'__require("{module_id(entry)}");')
    parts.append("})();")
    return "\n".join(parts) + "\n"


# --- HTML assembly ----------------------------------------------------------

MODULE_SCRIPT_RE = re.compile(r'<script type="module" src="(?P<src>[^"]+)"></script>')
STYLESHEET_RE = re.compile(r'<link rel="stylesheet" href="(?P<href>[^"]+)">')
DATA_BLOCK_RE = re.compile(r'(<script type="application/json" id="famtee-data">)([\s\S]*?)(</script>)')


def inline_safe(code: str, tag: str) -> str:
    """Prevent inline code from closing its <script>/<style> element early."""
    code = re.sub(rf"</({tag})", r"<\\/\1", code, flags=re.I)
    return code.replace("<!--", "<\\!--") if tag == "script" else code


def embed_data(html: str, data_text: str) -> str:
    try:
        doc = json.loads(data_text)
    except json.JSONDecodeError as e:
        raise BuildError(f"data file is not valid JSON: {e}") from e
    if doc.get("format") != "famtee":
        raise BuildError('data file is not a FamTee document (format != "famtee")')
    payload = json.dumps(doc, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
    if not DATA_BLOCK_RE.search(html):
        raise BuildError("HTML has no famtee-data block to embed data into")
    return DATA_BLOCK_RE.sub(lambda m: m[1] + payload + m[3], html, count=1)


VERSION_META_RE = re.compile(r'(<meta name="famtee-version" content=")[^"]*(")')
BUILD_META_RE = re.compile(r'(<meta name="famtee-build" content=")[^"]*(")')


def app_version(root: Path = ROOT) -> tuple[str, str]:
    """(version, build): the product version from VERSION, and the build id the CI pipeline
    writes to BUILD (the source tree's short hash); "local" for a build made by hand."""
    version = (root / "VERSION").read_text(encoding="utf-8").strip()
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise BuildError(f"VERSION must be MAJOR.MINOR.PATCH, got {version!r}")
    build_file = root / "BUILD"
    build = build_file.read_text(encoding="utf-8").strip() if build_file.is_file() else "local"
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,40}", build):
        raise BuildError(f"BUILD must be a short id, got {build!r}")
    return version, build


def build_html(html_path: Path, data_path: Path | None = None) -> str:
    html = html_path.read_text(encoding="utf-8")
    base = html_path.parent

    # Stamp the version and build into the page (the app shows them; downloads keep them).
    version, build = app_version()
    html = VERSION_META_RE.sub(lambda m: f"{m[1]}{version}{m[2]}", html, count=1)
    html = BUILD_META_RE.sub(lambda m: f"{m[1]}{build}{m[2]}", html, count=1)

    scripts = MODULE_SCRIPT_RE.findall(html)
    if len(scripts) != 1:
        raise BuildError(f"{html_path.name}: expected exactly one module script, found {len(scripts)}")

    def inline_css(m: re.Match) -> str:
        css_path = base / m["href"]
        if not css_path.is_file():
            raise BuildError(f"{html_path.name}: stylesheet not found: {m['href']}")
        return f"<style>\n{inline_safe(css_path.read_text(encoding='utf-8'), 'style')}</style>"

    # Stylesheets and data go in before the script: the bundled code may contain
    # strings that look like <link> tags or data blocks, and must not be rewritten.
    html = STYLESHEET_RE.sub(inline_css, html)
    if data_path:
        html = embed_data(html, data_path.read_text(encoding="utf-8"))

    js = bundle(base / scripts[0])
    return MODULE_SCRIPT_RE.sub(lambda _: f"<script>\n{inline_safe(js, 'script')}</script>", html, count=1)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--html", type=Path, default=ROOT / "src" / "index.html", help="HTML shell")
    parser.add_argument("--data", type=Path, help="FamTee JSON document to embed")
    parser.add_argument("--out", type=Path, default=ROOT / "dist" / "famtee.html", help="output file")
    args = parser.parse_args(argv)
    try:
        html = build_html(args.html, args.data)
    except BuildError as e:
        print(f"build failed: {e}", file=sys.stderr)
        return 1
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(html, encoding="utf-8")
    print(f"wrote {args.out} ({len(html.encode('utf-8')) // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
