# ADR-001: ARM64 port strategy & de-risking spike (the gate)

- **Status:** Accepted
- **Date:** 2026-06-22
- **Deciders:** Lead Architect, Senior Developer
- **Supersedes:** —

## Context

This fork (`Dopamine-ARM64`) aims to produce a **native Windows-on-ARM64** build
of Dopamine v3. The upstream app is Electron 38 + Angular 16 + TypeScript and
already builds for Windows, macOS (Intel + Apple Silicon) and Linux. The
architecture is therefore CPU-neutral at the source level; the risk lives
entirely in **native modules, packaging configuration, and CI**, not in app code.

The team must decide *how* to sequence the work so that effort is not spent on
packaging/CI plumbing before the one real technical risk — the native module's
ARM64 ABI — is proven.

Forces:

- One compiled native dependency exists: `better-sqlite3@12.5.0`. Everything
  else in the dependency graph is pure JS.
- A wrong assumption about that module's prebuilt-binary availability is the
  single most likely source of multi-day delay (historically, native-module
  ABI mismatches compile silently against the wrong runtime).
- The build host is already ARM64, so "native build" is the path of least
  resistance — but this must be proven end-to-end, not assumed.
- Decisions ADR-002…ADR-005 (build host, module strategy, packaging, CI) all
  depend on the outcome of that proof.

## Decision

Adopt a **spike-first, gated strategy**:

1. **No source re-architecture.** Treat the port as a configuration + CI change.
   The Angular/Electron/TypeScript code is not modified for ARM64.
2. **Run a time-boxed de-risking spike (1 day) before ratifying ADR-002…005.**
   The spike must, on the ARM64 host, prove:
   - `npm install` completes under the repo's `engine-strict` Node policy;
   - `better-sqlite3` resolves to an **arm64** binary (prebuilt, per ADR-003);
   - `npm start` launches the app and it plays audio, scans a library, reads
     tags, and writes to its SQLite database;
   - `electron-builder` emits an **arm64** Windows installer (per ADR-004).
3. **The spike is a gate.** ADR-002…005 remain *Proposed* until the spike's
   acceptance checklist (below) is green. Only then are they promoted to
   *Accepted*. This is the "last responsible moment" applied deliberately:
   commit the cheap, reversible decisions now; ratify the rest on evidence.
4. **Keep the x64 build path intact.** ARM64 is additive. No change may regress
   the existing x64 Windows output.

### Spike acceptance checklist

> **Executed 2026-06-22 (install + native-binary portion). Result: PASS.**
> See "Spike execution log" below for the verified arch evidence. The remaining
> runtime/packaging items are still open and tracked here.

- [x] `node -v` matches the project's supported major (Node 22 line) — see
      ADR-002 / implementation note re: `engine-strict`.
      *(Used portable Node v22.23.0 win-arm64, `process.arch=arm64`.)*
- [x] `npm install` + `postinstall` (`electron-builder install-app-deps`) succeed.
      *(Exit 0 after applying the `@parcel/watcher` override — see ADR-006.)*
- [x] The resolved `better_sqlite3.node` is machine type **AArch64**, not
      x64-under-emulation. *(Verified: PE machine `0xAA64`, `buildFromSource=false`.)*
- [ ] `npm start` runs; audio playback works; library indexing completes.
- [ ] Tag read/write (taglib-sharp) and DB read/write (better-sqlite3) verified.
- [ ] `electron-builder --win --arm64` produces `Dopamine-*-arm64.exe`.
- [ ] App launches from the installed arm64 artifact on the host.

### Spike execution log (2026-06-22)

What was run and found, verbatim enough to reproduce:

- **Host:** `PROCESSOR_ARCHITECTURE=ARM64` (CPU arch code 12). Confirmed native.
- **Installed (x64) app, for contrast:** `C:\Program Files\Dopamine\Dopamine.exe`
  and its bundled `better_sqlite3.node` are both **x64 (AMD64)** — i.e. today the
  released app runs under Windows-on-ARM **x64 emulation (Prism)**, not natively.
  Removing that is the whole point of this port.
- **No `nvm`/`fnm`/`volta` present**; global Node was v24.11.1. The spike used a
  **portable Node 22 (v22.23.0 win-arm64)** scoped to the build only.
- **First `npm install` FAILED** — not on `better-sqlite3`, but on a *second,
  build-tree* native module: **`@parcel/watcher@2.0.4`** (pulled by `nx`, which
  is pulled by `@angular-eslint/builder` + `@angular-eslint/schematics`). 2.0.4
  predates win32-arm64 prebuilds, so it tried to compile and died on
  **Python 3.14 having removed `distutils`** (old bundled `node-gyp@9.4.1`).
- **Fix:** npm `override` forcing `@parcel/watcher` → `2.5.1` (first arm64
  prebuilds land in 2.3.0). Captured as **ADR-006**.
- **Second `npm install` SUCCEEDED (exit 0).** `@electron/rebuild` reported
  `electronVersion=38.8.6 arch=arm64 buildFromSource=false` and
  `finished better-sqlite3 arch=arm64`.
- **Architecture sweep of all `*.node` in `node_modules`: 3 files, all AArch64,
  zero non-arm64.** (`better_sqlite3.node`, `@parcel/watcher` `watcher.node`,
  plus electron.exe itself AArch64.)

## Consequences

**Easier:**

- Risk is front-loaded and bounded to one day; the expensive CI/packaging work
  only proceeds on proven ground.
- Clear, evidence-based gate prevents "looks done" false positives.

**Harder / costs:**

- Slight upfront latency before packaging/CI work begins (deliberate).

**Follow-ups:**

- A green spike promotes ADR-002…005 to *Accepted*.
- A red spike (e.g. prebuilt binary unexpectedly absent) routes to ADR-003's
  contingency (source compilation) and re-scopes the timeline before any CI work.

## Alternatives considered

- **Big-bang: change packaging + CI + deps together, test at the end.**
  Rejected — defers discovery of the only real risk to the most expensive
  moment; classic late-feedback anti-pattern.
- **Assume prebuilt ARM64 binary exists and skip the spike.** Rejected — the
  ABI number alone is error-prone (this very analysis initially mis-mapped
  Electron 38 to ABI 137 instead of 139); the binary must be proven to load.
- **Ship x64 and rely on Windows emulation only.** Rejected as the project
  goal is a *native* ARM64 player; emulation is the fallback, not the target.
