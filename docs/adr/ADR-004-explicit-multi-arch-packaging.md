# ADR-004: Explicit multi-arch packaging in electron-builder

- **Status:** Proposed (pending ADR-001 spike)
- **Date:** 2026-06-22
- **Deciders:** Lead Architect, Senior Developer
- **Depends on:** ADR-002, ADR-003

## Context

`electron-builder.config.js` currently declares the Windows target without an
architecture:

```js
win: {
    target: ['nsis'],
    artifactName: `${productName}-${getFullVersion()}.${ext}`,
},
```

With no `arch` specified, `electron-builder` builds for the **host
architecture**. On an x64 host that silently yields an x64 installer; on the
ARM64 host it yields arm64. This *implicit* behaviour is a latent trap: the same
config produces different artifacts depending on where it runs, and an x64
installer handed to a Windows-on-ARM user runs under emulation — the exact
outcome the port exists to avoid.

The artifact name also does not encode architecture, so an arm64 and an x64
installer would collide on filename (`Dopamine-3.0.7.exe`).

## Decision

Make architecture **explicit and self-documenting** in packaging:

1. **Declare target arch explicitly** for Windows builds rather than relying on
   host inference. Drive it from an `--arm64` / `--x64` invocation (or an
   `arch` field) so the produced arch is intentional, not incidental.
2. **Encode arch in the artifact name**, e.g.
   `${productName}-${getFullVersion()}-${arch}.${ext}`, so arm64 and x64
   installers are distinguishable and never overwrite each other.
3. **Add explicit build scripts** in `package.json` for each Windows arch (e.g.
   `electron:windows:arm64`, `electron:windows:x64`) wrapping
   `electron-builder build --windows --<arch>`. The existing `electron:windows`
   remains for host-arch convenience.
4. **Keep x64 a first-class output.** The port adds arm64; it does not remove
   x64. Both must remain buildable from their respective native hosts (ADR-002).
5. NSIS specifics (per-machine vs per-user, install dir) are unchanged for now;
   side-by-side install of both arches on one machine is out of scope unless a
   testing need arises.

## Consequences

**Easier:**

- Build output is deterministic and legible — the filename states the arch.
- No accidental x64-on-ARM emulation shipments.
- CI (ADR-005) can fan out cleanly per arch with predictable artifact names.

**Harder / costs:**

- Two artifacts to produce and track instead of one.
- A small config/scripts change that must be kept in sync with CI.

## Alternatives considered

- **Leave arch implicit (host-inferred).** Rejected — non-deterministic output
  and the emulation-shipment trap.
- **Single universal/fat Windows installer.** Rejected — Windows has no
  universal-binary equivalent to macOS; per-arch installers are the norm.
- **arm64 only, drop x64.** Rejected — needlessly abandons the large existing
  x64 user base and upstream parity.
