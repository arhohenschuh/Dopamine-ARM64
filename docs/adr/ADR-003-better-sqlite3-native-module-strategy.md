# ADR-003: `better-sqlite3` native-module ABI strategy

- **Status:** Proposed (pending ADR-001 spike)
- **Date:** 2026-06-22
- **Deciders:** Lead Architect, Senior Developer
- **Depends on:** ADR-001, ADR-002

## Context

`better-sqlite3` is the only compiled native module that **ships in the app**
(production `dependencies`). The other "native-sounding" runtime deps —
`@digimezzo/node-taglib-sharp` and `discord-rpc` — are pure JavaScript
(confirmed by inspecting their published package contents; no `.node`
artifacts). It is therefore the entire native-ABI risk surface for *the shipped
app*.

> A **second** native module, `@parcel/watcher`, exists in the *build toolchain*
> (via `nx` ← `@angular-eslint/*`). It is not shipped in the package but it does
> compile at install time on arm64 unless overridden. That concern is handled
> separately in **ADR-006**; this ADR is about the app-runtime module only.

The module is consumed inside Electron, so the binary must match **Electron's**
ABI, not the system Node's. Resolution flow during install:

```
npm install
  └─ postinstall: electron-builder install-app-deps
        └─ @electron/rebuild
              └─ prebuild-install  (tries to download a matching prebuilt .node)
                    └─ fallback: node-gyp rebuild  (compiles from source)
```

`prebuild-install` constructs a URL of the exact form:

```
.../v<ver>/better-sqlite3-v<ver>-electron-v<ABI>-win32-arm64.tar.gz
```

### Evidence (verified 2026-06-22)

- Pinned version: **`better-sqlite3@12.5.0`**; project Electron: **`^38`**.
- Authoritative `electron/node-abi` registry mapping:
  **E37 → ABI 136, E38 → ABI 139, E39 → ABI 140** (note the non-contiguous
  jump 136→139; an early version of this analysis wrongly assumed 137).
- HEAD probes of the upstream release assets:
  - `better-sqlite3-v12.5.0-electron-v139-win32-arm64.tar.gz` → **HTTP 200, EXISTS**
  - Also present in latest `12.11.1` (ABI 139 **and** 140) → future-proof for E39.
- Build host already ARM64; **VS 2022 BuildTools present but the
  `VC.Tools.ARM64` C++ component is NOT installed**; Python 3.14 present.

**Conclusion:** for the current pinned stack, a win32-arm64 prebuilt binary
exists and will be downloaded. **No source compilation, and therefore no ARM64
MSVC toolchain, is required** in the normal path.

## Decision

1. **Rely on the upstream prebuilt arm64 binary** for `better-sqlite3` at the
   pinned Electron ABI. Do not vendor, fork, or self-host the binary.
2. **Pin Electron to a major that has a published arm64 prebuild.** Electron 38
   (ABI 139) qualifies today. Any Electron bump must be checked against the
   `better-sqlite3` release matrix *before* merging (a one-line HEAD probe of
   the asset URL — see implementation note).
3. **Verify the resolved binary's architecture**, never assume it. The
   installed `better_sqlite3.node` must report machine type **AArch64**
   (`dumpbin /headers`). A binary that loads under emulation but is x64 is a
   defect, not a pass.
4. **Document a contingency compile path** for the case where a prebuilt arm64
   binary is unavailable (e.g. brand-new Electron major, or an offline/proxied
   install). The contingency requires, on the ARM64 host:
   - VS 2022 with **"MSVC v143 — VS 2022 C++ ARM64 build tools"** + Windows 11 SDK,
   - Python (3.x present), then `npm run rebuild-sqlite` (`electron-rebuild -f -o
     better-sqlite3`). Because the host is ARM64 this is a *native* compile.
   This toolchain is **not** installed by default and is only provisioned if the
   prebuilt path fails.

## Consequences

**Easier:**

- Zero-compile install in the normal case; fast, reproducible, no toolchain.
- The native-module risk collapses to a single, automatable pre-merge check.

**Harder / costs:**

- Electron upgrades are now **gated** on prebuilt-binary availability — a small
  standing constraint on dependency currency.
- A contingency toolchain must be documented (and occasionally installed) even
  though it is normally unused.

## Alternatives considered

- **Pin Electron to 37 (ABI 136) to guarantee a prebuild.** Rejected as
  unnecessary — E38 (ABI 139) already has a prebuild; no need to trade away a
  major version of currency.
- **Always compile `better-sqlite3` from source on arm64.** Rejected as the
  default — forces the ARM64 MSVC toolchain on every dev/CI environment for no
  benefit when a vetted prebuilt binary exists. Retained only as contingency.
- **Swap `better-sqlite3` for a pure-JS/WASM SQLite (e.g. sql.js, wa-sqlite).**
  Rejected — large, risky code change to the data layer with performance and
  persistence implications, solving a problem that does not exist here.
- **Vendor/self-host the prebuilt `.node`.** Rejected — maintenance burden and
  drift risk versus simply tracking the upstream release matrix.
