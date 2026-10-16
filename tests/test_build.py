"""Unit tests for build/build.py. Run: python3 -m unittest discover -s tests"""

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "build"))
import build  # noqa: E402


class TempModules(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(dir=build.ROOT)  # module ids are relative to ROOT
        self.dir = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def write(self, name, text):
        path = self.dir / name
        path.write_text(text, encoding="utf-8")
        return path

    def mid(self, name):
        return build.module_id(self.dir / name)


class TransformTests(TempModules):
    def test_import_forms(self):
        self.write("x.js", "export const a = 1;\n")
        path = self.write("m.js", "import { a, b as c } from './x.js';\nimport * as ns from './x.js';\nimport './x.js';\n")
        body, deps = build.transform(path, path.read_text())
        req = f'__require("{self.mid("x.js")}")'
        self.assertIn(f"const {{ a, b: c }} = {req};", body)
        self.assertIn(f"const ns = {req};", body)
        self.assertIn(f"\n{req};", body)
        self.assertEqual(len(deps), 3)

    def test_multiline_import(self):
        self.write("x.js", "")
        path = self.write("m.js", "import {\n  a,\n  b,\n} from './x.js';\n")
        body, _ = build.transform(path, path.read_text())
        self.assertIn("const { a, b } =", body)

    def test_export_forms(self):
        src = (
            "export function f() {}\nexport async function g() {}\nexport class C {}\n"
            "export const k = 1;\nlet z = 2;\nexport { z, z as zz };\n"
        )
        path = self.write("m.js", src)
        body, _ = build.transform(path, src)
        for name in ["f", "g", "C", "k", "z", "zz"]:
            self.assertIn(f'Object.defineProperty(exports, "{name}"', body)
        self.assertIn("get: () => z })", body)
        self.assertNotRegex(body, r"(?m)^\s*export\b")
        self.assertIn("async function g", body)

    def test_unsupported_syntax_fails(self):
        cases = {
            "import x from './x.js';": "default imports",
            "export default 1;": "unsupported export",
            "export { a } from './x.js';": "re-exports",
            "const m = import('./x.js');": "dynamic import",
            "import { a } from 'lib';": "only relative",
            "import { a } from './missing.js';": "cannot find",
        }
        self.write("x.js", "")
        for src, message in cases.items():
            with self.subTest(src=src):
                path = self.write("m.js", src + "\n")
                with self.assertRaisesRegex(build.BuildError, message):
                    build.transform(path, src + "\n")


class BundleTests(TempModules):
    def test_dependency_order_and_dedup(self):
        self.write("a.js", "export const a = 1;\n")
        self.write("b.js", "import { a } from './a.js';\nexport const b = a + 1;\n")
        entry = self.write("main.js", "import { a } from './a.js';\nimport { b } from './b.js';\n")
        js = build.bundle(entry)
        defs = [js.index(f'__modules["{self.mid(n)}"]') for n in ["a.js", "b.js", "main.js"]]
        self.assertEqual(defs, sorted(defs))
        self.assertEqual(js.count(f'__modules["{self.mid("a.js")}"] ='), 1)
        self.assertTrue(js.rstrip().endswith(f'__require("{self.mid("main.js")}");\n}})();'))

    def test_circular_imports_fail(self):
        self.write("a.js", "import './b.js';\n")
        self.write("b.js", "import './a.js';\n")
        with self.assertRaisesRegex(build.BuildError, "circular import"):
            build.bundle(self.dir / "a.js")


class HtmlTests(TempModules):
    SHELL = (
        '<head><link rel="stylesheet" href="./s.css"></head><body>'
        '<script type="application/json" id="famtee-data"></script>'
        '<script type="module" src="./main.js"></script></body>'
    )

    def test_inlines_script_css_and_data(self):
        self.write("s.css", "body { color: red }\n")
        self.write("main.js", "const s = '</script>';\n")
        html_path = self.write("index.html", self.SHELL)
        data = self.write("d.json", json.dumps({"format": "famtee", "note": "</script>"}))
        html = build.build_html(html_path, data)
        self.assertIn("<style>\nbody { color: red }\n</style>", html)
        self.assertNotIn('type="module"', html)
        self.assertIn("const s = '<\\/script>';", html)
        self.assertEqual(html.lower().count("</script>"), 2)
        self.assertIn('"note":"\\u003c/script>"', html)

    def test_inlined_code_is_not_rewritten(self):
        self.write("s.css", "")
        self.write("main.js", "const a = '<link rel=\"stylesheet\" href=\"x.css\">';\n"
                   "const b = '<script type=\"application/json\" id=\"famtee-data\"><\\/script>';\n")
        html_path = self.write("index.html", self.SHELL)
        data = self.write("d.json", json.dumps({"format": "famtee"}))
        html = build.build_html(html_path, data)
        self.assertIn('const a = \'<link rel="stylesheet" href="x.css">\';', html)
        self.assertIn('id="famtee-data"><\\/script>\';', html)
        self.assertIn('id="famtee-data">{"format":"famtee"}</script>', html)

    def test_rejects_non_famtee_data(self):
        self.write("s.css", "")
        self.write("main.js", "")
        html_path = self.write("index.html", self.SHELL)
        data = self.write("d.json", "{}")
        with self.assertRaisesRegex(build.BuildError, "not a FamTee document"):
            build.build_html(html_path, data)

    def test_real_app_builds(self):
        html = build.build_html(build.ROOT / "src" / "index.html", build.ROOT / "samples" / "sample.famtee.json")
        self.assertIn('"title":"Sample family"', html)
        self.assertIn('__require("src/main.js");', html)


if __name__ == "__main__":
    unittest.main()


class VersionTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def test_version_and_build(self):
        (self.root / "VERSION").write_text("1.2.3\n", encoding="utf-8")
        self.assertEqual(build.app_version(self.root), ("1.2.3", "local"), "no BUILD file: a local build")
        (self.root / "BUILD").write_text("7eefa04\n", encoding="utf-8")
        self.assertEqual(build.app_version(self.root), ("1.2.3", "7eefa04"))

    def test_bad_version_or_build_fails(self):
        (self.root / "VERSION").write_text("1.2\n", encoding="utf-8")
        with self.assertRaises(build.BuildError):
            build.app_version(self.root)
        (self.root / "VERSION").write_text("1.2.3\n", encoding="utf-8")
        (self.root / "BUILD").write_text('"><script>\n', encoding="utf-8")
        with self.assertRaises(build.BuildError):
            build.app_version(self.root)

    def test_real_app_is_stamped(self):
        version, _ = build.app_version()
        html = build.build_html(build.ROOT / "src" / "index.html")
        self.assertIn(f'<meta name="famtee-version" content="{version}">', html)
        self.assertNotIn('content="dev"', html)
