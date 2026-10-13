# FamTee

Lightweight family tree UI and storage: a single portable HTML file that holds both the family graph and its
visualization, and runs in any modern browser on any OS, offline.

```bash
python3 build/build.py --data samples/sample.famtee.json --out dist/sample.html
python3 tests/run.py
```

See [docs/](docs/README.md) for the architecture, data model and design decisions, and
[docs/development.md](docs/development.md) for building and testing.
