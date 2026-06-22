# Architecture Decision Records — Dopamine ARM64 Port

This folder records the architectural decisions for porting **Dopamine v3**
(`digimezzo/dopamine`, Electron + Angular + TypeScript) to a **native Windows
on ARM64** build, tracked in this fork (`Dopamine-ARM64`).

## Why these ADRs exist

Dopamine v3 is already a cross-platform Electron app, so the ARM64 effort is a
**build/packaging/CI migration, not a code re-architecture**. The decisions
below capture the few choices that genuinely matter, the evidence behind them,
and the trade-offs — so they are not re-litigated later.

## Decision log

| ADR | Title | Status |
|-----|-------|--------|
| [ADR-001](ADR-001-arm64-port-strategy-and-spike.md) | ARM64 port strategy & de-risking spike (the gate) | Accepted |
| [ADR-002](ADR-002-native-arm64-build-host.md) | Native ARM64 build host vs x64 cross-compile | Proposed |
| [ADR-003](ADR-003-better-sqlite3-native-module-strategy.md) | `better-sqlite3` native-module ABI strategy | Proposed |
| [ADR-004](ADR-004-explicit-multi-arch-packaging.md) | Explicit multi-arch packaging in electron-builder | Proposed |
| [ADR-005](ADR-005-arm64-ci-pipeline.md) | ARM64 CI pipeline (`windows-11-arm` runner) | Proposed |
| [ADR-006](ADR-006-parcel-watcher-arm64-override.md) | Override transitive `@parcel/watcher` to an arm64-prebuilt version | Accepted |

A companion, non-ADR engineering walkthrough lives in
[`../IMPLEMENTATION-NOTE-arm64.md`](../IMPLEMENTATION-NOTE-arm64.md) — the
senior developer's step-by-step build/compile guide.

## Key evidence (captured 2026-06-22)

All decisions are grounded in facts verified against the live repo, the build
host, and upstream release artifacts:

- **Build host is already ARM64** — `PROCESSOR_ARCHITECTURE = ARM64`
  (Win32_Processor architecture code `12`). The native target *is* the dev box.
- **Two compiled native modules exist — but only one ships in the app.**
  - *App runtime:* `better-sqlite3@12.5.0` — the only native module in
    production `dependencies`. (`@digimezzo/node-taglib-sharp` and `discord-rpc`
    are pure JavaScript — verified by inspecting their package contents, no
    `.node` bindings.)
  - *Build toolchain only:* `@parcel/watcher` (via `nx` ← `@angular-eslint/*`),
    a second native module the **spike** surfaced. The pinned `2.0.4` has no
    arm64 prebuild; addressed by an override in **ADR-006**. Not shipped in the
    packaged app.
- **Electron is `^38`** (resolved 38.8.6), which maps to Node-ABI **139** (per
  the upstream `electron/node-abi` registry: E37→136, **E38→139**, E39→140).
- **A `better-sqlite3` win32-arm64 prebuild exists for Electron 38 (ABI 139)**
  in the pinned version 12.5.0 *and* in the latest 12.11.1 — so the module is
  delivered as a prebuilt binary, **no source compilation required**.
  *Spike-confirmed:* the installed `better_sqlite3.node` is **AArch64**,
  `buildFromSource=false`.
- **No ARM64 MSVC toolchain is currently installed** (VS 2022 BuildTools is
  present, but the `VC.Tools.ARM64` component is not). Per ADR-003/ADR-006 this
  is acceptable because **both** native modules now resolve to prebuilt arm64
  binaries; the toolchain is a documented contingency only.
- **Local Python is 3.14**, which **removed `distutils`** — this breaks the old
  bundled `node-gyp@9.4.1` used by any module that *compiles*. Another reason
  the port deliberately avoids source compilation (ADR-006).

## Status legend

- **Proposed** — under consideration, not yet ratified.
- **Accepted** — ratified; implementation may proceed.
- **Superseded** — replaced by a later ADR (linked).
