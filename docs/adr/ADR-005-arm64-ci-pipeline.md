# ADR-005: ARM64 CI pipeline (`windows-11-arm` runner)

- **Status:** Proposed (pending ADR-001 spike)
- **Date:** 2026-06-22
- **Deciders:** Lead Architect, Senior Developer
- **Depends on:** ADR-002, ADR-003, ADR-004

## Context

The existing workflows (`.github/workflows/nightly.yml` and `merge.yml`) build:

- Linux (ubuntu-22.04) + pacman (archlinux container),
- macOS arm (`macos-15`) and macOS intel (`macos-15-intel`),
- **Windows on `windows-2022` — which is x64 only.**

There is **no Windows ARM64 job**. To deliver and continuously verify a native
ARM64 build, CI must build on ARM64 (per ADR-002, native host over
cross-compile). GitHub now offers **`windows-11-arm` hosted runners**, making a
native ARM64 job possible without self-hosting.

Constraints observed in the current workflows:

- Node is pinned to the **22.x** line via `actions/setup-node`.
- `.npmrc` sets `engine-strict=true`, so the runner's Node/npm must satisfy the
  dependency `engines` constraints or install fails fast.
- Windows job zips `release/Dopamine-*.exe`; with ADR-004 artifact names become
  arch-suffixed and the glob must follow.

## Decision

1. **Add a native `windows-11-arm` job** to both `nightly.yml` and `merge.yml`
   that installs Node 22, runs `npm install`, `npm run test`, then the explicit
   `electron:windows:arm64` build (ADR-004), and uploads the arm64 artifact.
2. **Keep the existing `windows-2022` (x64) job.** The two Windows jobs run in
   parallel, each native to its arch (no cross-compile, per ADR-002).
3. **Assert arch in CI**, not just "it built": add a step that checks the packed
   `better_sqlite3.node` machine type is AArch64 (e.g. `dumpbin /headers`), so a
   regression to an emulated/x64 binary fails the build (ADR-003 §3).
4. **Update artifact globs/names** to the arch-suffixed scheme from ADR-004 so
   arm64 and x64 artifacts upload distinctly.
5. **No code signing in CI initially** (see ADR-003/implementation note); signing
   is deferred until distribution is in scope. Unsigned arm64 artifacts are
   acceptable for nightly/personal use.

## Consequences

**Easier:**

- Every push/merge continuously proves the ARM64 build still works — the port
  does not silently rot.
- Native runner keeps install/build behaviour identical to the local dev box.

**Harder / costs:**

- An additional CI job (build minutes; ARM64 hosted-runner availability/pricing
  applies).
- Two Windows artifact streams to manage in releases.
- CI must track Electron-bump/prebuild-availability (ADR-003) or the arm64 job
  will be the first to fail on a missing prebuilt binary.

## Alternatives considered

- **Cross-compile arm64 inside the existing x64 `windows-2022` job.** Rejected —
  contradicts ADR-002 and reintroduces the cross-toolchain failure surface.
- **Self-hosted ARM64 runner.** Rejected as default — unnecessary maintenance
  now that `windows-11-arm` is a hosted option; revisit only if hosted runners
  are unavailable or too costly.
- **No ARM64 CI; build arm64 locally only.** Rejected — the port would regress
  undetected on dependency or Electron bumps.
