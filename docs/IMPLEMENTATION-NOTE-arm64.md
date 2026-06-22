# Implementation Note — Building Dopamine natively on Windows ARM64

*Author: Senior Developer. Companion to ADR-001…005. This is the "how", in the
order I'd actually do it. ADRs hold the "why".*

> TL;DR — The box is already ARM64. The only native module (`better-sqlite3`)
> has a prebuilt arm64 binary for Electron 38. So in the normal case you
> **install, verify the binary is really AArch64, run, and package** — no C++
> compiler involved. Keep the compile path in your back pocket; you probably
> won't touch it.

---

## 0. What we're dealing with (so nobody panics later)

- Stack: Electron 38 + Angular 16 + TypeScript. CPU-neutral source.
- Native modules: **two** — but only **one ships in the app**.
  - `better-sqlite3@12.5.0` — the only native module in production `dependencies`
    (ships in the package).
  - `@parcel/watcher` — build-toolchain only (via `nx` ← `@angular-eslint/*`).
    The pinned 2.0.4 has no arm64 prebuild; we override it to 2.5.1 (ADR-006).
  `node-taglib-sharp` and `discord-rpc` are pure JS. Don't let the names scare you.
- Host: Windows on ARM64. Target: Windows on ARM64. Host == target. Good.
- Electron 38 → Node-ABI **139** (not 137 — the registry jumps 136→139).
- `better-sqlite3` ships `...electron-v139-win32-arm64.tar.gz`. It exists. We checked.
- **Local Python is 3.14**, which removed `distutils` — so *anything that
  compiles* via the old node-gyp will fail. We sidestep this entirely by using
  prebuilt binaries for both native modules (§1, §2, ADR-006).

> **Spike status (2026-06-22): install + native-binary verification PASSED.**
> `better_sqlite3.node`, `@parcel/watcher` `watcher.node`, and `electron.exe` are
> all **AArch64**; `buildFromSource=false`. Runtime smoke test (§4) and packaging
> (§5) are the next steps.

---

## 1. Environment (do this once)

**Node 22, not whatever's lying around.** The repo sets `engine-strict=true` in
`.npmrc` and CI pins the 22.x line. A different major can hard-fail `npm install`
on an `engines` mismatch. Use nvm-windows:

```powershell
nvm install 22
nvm use 22
node -v   # expect v22.x
```

**Python** — present (3.14). Only matters for the compile contingency (§6); the
normal install doesn't need it.

**No C++ toolchain needed for the normal path.** Do *not* pre-install the ARM64
MSVC workload "just in case" — if the prebuilt binary resolves (it should),
you'll never invoke a compiler. Save the 5+ GB.

---

## 2. Clean install

From the repo root (`C:\Users\arhohens\GitDev\Dopamine-ARM64`):

```powershell
npm install
```

What happens under the hood that you care about:

- `postinstall` runs `electron-builder install-app-deps`, which rebuilds native
  modules against **Electron's** ABI (139), for the **host arch** (arm64).
- For `better-sqlite3`, `prebuild-install` fetches
  `better-sqlite3-v12.5.0-electron-v139-win32-arm64.tar.gz` and drops in the
  `.node`. No `node-gyp`, no `cl.exe`.
- `postinstall` also runs `node patch-discord-rpc.js` (a pure-JS string patch —
  arch-irrelevant).

If you see `prebuild-install` *succeed*, you're done with the scary part.
If you see it fall through to `node-gyp rebuild`, stop and go to §6 — something
about the Electron/ABI assumption changed.

---

## 3. Verify the binary is ACTUALLY arm64 (don't skip this)

A binary can load under x64 emulation and lie to you. Prove the machine type:

```powershell
$node = "node_modules\better-sqlite3\build\Release\better_sqlite3.node"
# Use the VS BuildTools dumpbin (any arch dumpbin can read headers):
& "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\*\bin\Hostarm64\arm64\dumpbin.exe" /headers $node | Select-String "machine"
```

Expect **`AArch64`** (or `ARM64`). If it says `x64`, that's a defect — the build
resolved the wrong arch. Do not proceed to packaging until this is AArch64.

(If `dumpbin` isn't handy, `file` from Git-Bash or a quick Node `process.arch`
check inside the running app also works — but header inspection is the honest test.)

---

## 4. Run it (dev)

```powershell
npm start
```

This serves the Angular renderer and launches Electron with the local main
process. Smoke-test the things that exercise the native + platform paths:

- **Audio playback** — actually play a file end to end.
- **Library scan/indexing** — point it at a folder; let it index.
- **Tag read** (taglib-sharp) and **DB write** (better-sqlite3) — add/rate a
  track, restart, confirm it persisted.

If those four work, the port is real, not theoretical.

---

## 5. Package the arm64 installer

Per ADR-004 we make arch explicit instead of relying on host inference.

Quick one-off (host is arm64, so this already targets arm64):

```powershell
npm run build:prod
npx electron-builder build --windows --arm64 --config electron-builder.config.js
```

Permanent (preferred) — add scripts + arch-suffixed artifact name:

```jsonc
// package.json → scripts
"electron:windows:arm64": "npm run build:prod && electron-builder build --windows --arm64 --config electron-builder.config.js",
"electron:windows:x64":   "npm run build:prod && electron-builder build --windows --x64   --config electron-builder.config.js",
```

```js
// electron-builder.config.js → win
win: {
    target: ['nsis'],
    artifactName: `\${productName}-${getFullVersion()}-\${arch}.\${ext}`,
},
```

Output lands in `release/` as `Dopamine-3.0.7-arm64.exe`. Install it, launch
from the installed app (not the dev server), repeat the §4 smoke test once more.

---

## 6. Contingency ONLY — compile `better-sqlite3` from source

You land here only if §2 fell through to `node-gyp` (e.g. you bumped Electron to
a major with no published prebuild, or you're offline/proxied and the download
was blocked). Because the host is arm64, this is a **native** compile, not a
cross-compile — annoying but straightforward.

1. Install the toolchain (this is the ~5 GB you otherwise skipped):
   - Visual Studio 2022 (or Build Tools) →
     **"MSVC v143 — VS 2022 C++ ARM64 build tools"** + **Windows 11 SDK**.
   - Confirm: `vswhere -requires Microsoft.VisualStudio.Component.VC.Tools.ARM64`
     returns the BuildTools path (currently it returns empty = not installed).
2. Make sure Python is on PATH (have 3.14).
3. Rebuild just the one module against Electron's ABI:
   ```powershell
   npm run rebuild-sqlite   # electron-rebuild -f -o better-sqlite3
   ```
4. Re-run the §3 header check. Must be AArch64.

Then carry on at §4.

> Before ever bumping Electron, do the 10-second check that saves this whole
> detour — confirm a prebuilt arm64 binary exists for the new ABI:
> ```powershell
> # map new Electron major -> ABI via electron/node-abi registry first, then:
> Invoke-WebRequest -Method Head -MaximumRedirection 5 `
>   "https://github.com/WiseLibs/better-sqlite3/releases/download/v<bsq3ver>/better-sqlite3-v<bsq3ver>-electron-v<ABI>-win32-arm64.tar.gz"
> # HTTP 200 = prebuilt path stays free. 404 = you're signing up for §6.
> ```

---

## 7. Gotchas I've already tripped on so you don't

- **`engine-strict=true`** — wrong Node major = install dies before anything
- **Pin 22 first (§1).** Wrong Node major = install dies before anything
  interesting.
- **`@parcel/watcher` + Python 3.14 — the trap the spike actually hit.** `nx`
  (pulled by `@angular-eslint/*`) drags in `@parcel/watcher@2.0.4`, which has **no
  win32-arm64 prebuild** and tries to compile — then dies with
  `ModuleNotFoundError: No module named 'distutils'` because Python 3.14 removed
  it. **Fix is already in `package.json`**: an `overrides` entry pinning
  `@parcel/watcher` to `2.5.1` (first arm64 prebuild = 2.3.0). See ADR-006. If you
  ever bump `nx`, re-check whether the override is still needed.
- **Don't pre-install the ARM64 C++ workload.** It's not needed for the prebuilt
  path and just hides whether prebuild resolution actually worked.
- **Verify arch, don't trust "it ran."** Emulation will happily run an x64
  `.node`. §3 is the gate.
- **Keep the repo OUT of OneDrive.** OneDrive-synced paths cause file-lock/sync
  noise during `node_modules` churn (we saw `EPERM` rollback warnings). This
  clone lives under `C:\Users\arhohens\GitDev\` — good.
- **Antivirus / Controlled Folder Access** can slow or block `node-gyp`/electron
  unpack steps; if install behaves oddly, check Defender first.
- **SmartScreen on the unsigned arm64 .exe** — expected. Fine for personal/
  nightly use. Code signing is a separate decision before any real distribution
  (out of scope here; noted in ADR-003/005).
- **Keep x64 alive.** ARM64 is additive. Don't delete the x64 path while wiring
  up arm64.

---

## 8. Definition of done (mirrors ADR-001 gate)

- [ ] Node 22 active; `npm install` + `postinstall` clean.
- [ ] `better_sqlite3.node` header = **AArch64**.
- [ ] `npm start`: playback, library scan, tag read, DB write all verified.
- [ ] `electron-builder --win --arm64` → `Dopamine-*-arm64.exe`.
- [ ] Installed arm64 artifact launches and passes the smoke test.
- [ ] x64 build path still works (no regression).
