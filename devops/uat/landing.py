#!/usr/bin/env python3
"""Write the UAT landing page for a release folder (ADR 0016).

    landing.py <release-dir> <output-index.html>

Reads manifest.json and SHA256SUMS from the release; everything shown is escaped.
"""
import html
import json
import sys
from pathlib import Path

release, out = Path(sys.argv[1]), Path(sys.argv[2])
m = json.loads((release / "manifest.json").read_text(encoding="utf-8"))
samples = sorted(p.name for p in (release / "samples").glob("*.html")) if (release / "samples").is_dir() else []
e = html.escape
ok = m.get("tests") == "ALL PASSED"

rows = "".join(
    f'<li><a href="samples/{e(name)}">{e(name.removesuffix(".html").replace("-", " ").title())} family</a></li>'
    for name in samples
)
out.write_text(f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FamTee UAT · {e(m["version"])}</title>
<style>
  :root {{ color-scheme: light dark; --fg: #1f2328; --bg: #fbfaf7; --muted: #6b6f76; --card: #fff; --line: #d0d4da;
          --ok: #1a7f37; --bad: #b42318; --accent: #2f6fdb; }}
  @media (prefers-color-scheme: dark) {{ :root {{ --fg: #e6e6e6; --bg: #16181c; --muted: #9aa0a6; --card: #22252b;
          --line: #3c4048; --ok: #4ac26b; --bad: #f97066; --accent: #7aa7ff; }} }}
  body {{ margin: 0; padding: 2rem 1rem; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, sans-serif; }}
  main {{ max-width: 42rem; margin: 0 auto; }}
  .badge {{ display: inline-block; padding: .1rem .55rem; border-radius: 999px; font-size: .8rem; font-weight: 600;
           border: 1px solid currentColor; color: {"var(--ok)" if ok else "var(--bad)"}; }}
  h1 {{ margin: .2rem 0 .25rem; font-size: 1.6rem; }}
  .muted {{ color: var(--muted); }}
  section {{ background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 1rem 1.25rem; margin-top: 1rem; }}
  h2 {{ margin: 0 0 .5rem; font-size: 1rem; }}
  a {{ color: var(--accent); }}
  .open {{ display: inline-block; margin: .25rem 0; padding: .55rem 1rem; border-radius: 8px; background: var(--accent);
          color: #fff; text-decoration: none; font-weight: 600; }}
  dl {{ display: grid; grid-template-columns: max-content 1fr; gap: .2rem 1rem; margin: 0; font-size: .9rem; }}
  dt {{ color: var(--muted); }} dd {{ margin: 0; overflow-wrap: anywhere; }}
  code {{ font-size: .85em; }}
</style>
</head>
<body>
<main>
  <span class="badge">{"Tests passed" if ok else "Tests: " + e(m.get("tests") or "unknown")}</span>
  <h1>FamTee UAT</h1>
  <p class="muted">Release <strong>{e(m["version"])}</strong> · {e(m.get("subject", ""))}</p>

  <section>
    <h2>Try it</h2>
    <a class="open" href="famtee.html">Open FamTee (empty family)</a>
    <ul>{rows}</ul>
    <p class="muted">Each link is the exact single-file app that would ship. Use <em>Save</em> to download a copy and check it opens on its own.</p>
  </section>

  <section>
    <h2>Release</h2>
    <dl>
      <dt>Version</dt><dd>{e(m["version"])}</dd>
      <dt>Commit</dt><dd><code>{e(m["commit"])}</code></dd>
      <dt>Built</dt><dd>{e(m.get("built", ""))}</dd>
      <dt>Tests</dt><dd>{e(m.get("tests", ""))}</dd>
      <dt>Files</dt><dd><a href="SHA256SUMS">SHA256SUMS</a> · <a href="ci.log">pipeline log</a> · <a href="manifest.json">manifest.json</a></dd>
    </dl>
  </section>
</main>
</body>
</html>
""", encoding="utf-8")
