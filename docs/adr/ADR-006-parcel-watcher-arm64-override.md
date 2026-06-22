# ADR-006: Override transitive `@parcel/watcher` to an arm64-prebuilt version

- **Status:** Accepted (applied to `package.json` and verified by the ADR-001 spike)
- **Date:** 2026-06-22
- **Deciders:** Lead Architect, Senior Developer
- **Depends on:** ADR-001, ADR-002
- **Relates to:** ADR-003 (the *other* native module)

## Context

The ADR-001 spike surfaced a native module that static analysis of the
production `dependencies` had missed, because it lives entirely in the **build
toolchain**:

```
@angular-eslint/builder  ─┐
@angular-eslint/schematics ┼─► nx@16.5.1 ─► @parcel/watcher@2.0.4   (dev tree)
@nrwl/tao                 ─┘
```

`@parcel/watcher@2.0.4` is **not** `optional` (so `--omit=optional` does not
skip it) and **predates win32-arm64 prebuilds** — the `@parcel/watcher-win32-arm64`
prebuild package only begins at **2.3.0**. On the ARM64 host, `node-gyp-build`
therefore falls through to compiling from source, which fails:

```
gyp ERR! ... @parcel/watcher
ModuleNotFoundError: No module named 'distutils'
```

Two compounding facts make the compile path actively undesirable here:

1. **Python 3.14 removed `distutils`** (PEP 632), breaking the old bundled
   `node-gyp@9.4.1` that `@parcel/watcher@2.0.4` uses — independent of CPU arch.
2. Even with Python fixed, compiling for arm64 would require the **`VC.Tools.ARM64`
   MSVC component**, which is not installed (ADR-003 evidence).

So the failure is *triggered* by ARM64 (no prebuild for 2.0.4) and *amplified*
by the local Python 3.14. It blocks `npm install` outright — nothing else in the
spike can proceed until it is resolved.

`@parcel/watcher` is consumed only by the `nx` daemon's file-watching. Its public
API (`subscribe` / `getEventsSince` / `unsubscribe`) is stable across the entire
2.x line, so the exact patch version is not contractually important to `nx@16.5.1`.

## Decision

Add an **npm `overrides` entry pinning `@parcel/watcher` to `2.5.1`** (the first
arm64-prebuilt minor is 2.3.0; 2.5.1 is a well-proven later patch):

```jsonc
// package.json
"overrides": {
    "@parcel/watcher": "2.5.1"
}
```

Consequences of this choice:

1. **No compilation.** npm installs the `@parcel/watcher-win32-arm64@2.5.x`
   prebuilt binary as an optional dependency. No `node-gyp`, no Python, no MSVC.
2. **The local Python 3.14 / `distutils` problem becomes moot** for this module
   (and there is no other compiling module — `better-sqlite3` uses its own
   prebuilt path per ADR-003).
3. **`nx` keeps working** because the watcher 2.x API is unchanged.
4. The override is the single, declarative source of truth; it travels with the
   repo and applies identically on the CI ARM64 runner (ADR-005).

### Verification (ADR-001 spike, 2026-06-22)

- `npm install` exit 0 after the override.
- `node_modules/@parcel/watcher` resolved to **2.5.1**; the
  `@parcel/watcher-win32-arm64` package is present and its `watcher.node` is
  **AArch64**; no `build/Release` directory exists (it did not compile).

## Consequences

**Easier:**

- Unblocks `npm install` on ARM64 with zero toolchain.
- Keeps the whole port on the "prebuilt binaries only" rail (consistent with
  ADR-003), so neither the dev box nor CI needs a C++ compiler or a specific
  Python.

**Harder / costs:**

- An `overrides` entry is a small piece of dependency-graph surgery that must be
  revisited if `nx` is ever upgraded to a version that itself pins a newer
  `@parcel/watcher` (at which point the override may become redundant — remove it
  and re-verify).
- Overrides apply transitively to *all* consumers of `@parcel/watcher`; since
  there is only one consumer (`nx`) and the 2.x API is stable, the blast radius
  is negligible — but it is not zero and should be noted on any future
  `@parcel/watcher` major bump (3.x).

## Alternatives considered

- **Install Python 3.11 (with `distutils`) + the ARM64 MSVC workload and let
  2.0.4 compile.** Rejected — two heavy installs (~GBs), a locally-compiled
  binary instead of a vetted prebuilt one, and it contradicts the "no
  compilation" posture of ADR-003. This is the contingency, not the default.
- **`pip install setuptools` to shim `distutils`.** Rejected as fragile —
  setuptools' vendored `distutils` shim is itself being retired, and it still
  leaves the ARM64 MSVC requirement unmet.
- **`--omit=optional` / `--ignore-scripts`.** Rejected — `@parcel/watcher` is not
  optional here (so the first does nothing), and `--ignore-scripts` would also
  skip the `better-sqlite3` / electron rebuild we explicitly need.
- **Remove `nx` / the `@angular-eslint` packages that pull it.** Rejected —
  invasive to the lint toolchain for no benefit once the override exists.
- **Upgrade `nx` to a version that pins a newer `@parcel/watcher`.** Deferred —
  larger change with its own compatibility surface; the override achieves the
  same end with far less risk. Revisit if `nx` is upgraded for other reasons.
