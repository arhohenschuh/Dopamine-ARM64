# ADR-002: Native ARM64 build host vs x64 cross-compile

- **Status:** Proposed (pending ADR-001 spike)
- **Date:** 2026-06-22
- **Deciders:** Lead Architect, Senior Developer
- **Depends on:** ADR-001

## Context

A Windows ARM64 artifact can be produced two ways:

1. **Native build** — build on a Windows-on-ARM64 machine; host arch == target
   arch, so `node-gyp` / prebuild resolution and `electron-builder` "just work".
2. **Cross-compile** — build on an x64 Windows machine and target arm64
   (`electron-builder --arm64`). Native modules must then be produced for arm64
   on an x64 host, which requires the cross ARM64 MSVC toolchain and careful
   `--arch`/`--target` propagation through `@electron/rebuild`.

Relevant facts:

- The developer's machine **is already ARM64** (`PROCESSOR_ARCHITECTURE = ARM64`).
- The only native module, `better-sqlite3`, **has a prebuilt arm64 binary** for
  the project's Electron ABI (see ADR-003), so neither path needs to *compile*
  it in the normal case.
- Cross-compiling native addons on x64→arm64 is the historically fiddly path
  (toolchain selection, wrong-arch binaries that link but fail at load).

## Decision

**Use a native ARM64 build host** as the primary and canonical way to produce
ARM64 artifacts — both for local developer builds and for CI (the CI runner
choice is ADR-005).

- Local: build on the existing ARM64 notebook.
- CI: use a native `windows-11-arm` runner (ratified in ADR-005).
- Cross-compilation from x64 is **explicitly not** the supported path and is
  not maintained, to avoid a second, divergent toolchain story.

## Consequences

**Easier:**

- Host==target removes the entire class of cross-compile arch-mismatch bugs.
- Prebuilt-binary resolution and `install-app-deps` behave normally.
- The contingency compile path (ADR-003) becomes a *native* compile (simple),
  not a cross compile (fiddly).

**Harder / costs:**

- Requires access to ARM64 hardware (have it locally) and an ARM64 CI runner
  (now available as a GitHub-hosted option — ADR-005).
- Producing x64 and arm64 in one place means either two runners (one per arch)
  or one matrix; addressed in ADR-004/005.

## Alternatives considered

- **x64 host cross-compiling to arm64.** Rejected as primary: more moving parts,
  higher failure surface, and it would *force* the ARM64 cross toolchain even
  though the native path needs no compiler at all. May be revisited only if
  ARM64 runners become unavailable.
- **Build x64 only + emulate.** Rejected — contradicts the native-port goal.
