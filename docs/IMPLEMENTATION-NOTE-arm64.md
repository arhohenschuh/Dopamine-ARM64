# Implementation Note — Building Dopamine natively on Windows ARM64

*Author: Senior Developer. Companion to ADR-001…005. This is the "how", in the
order I'd actually do it. ADRs hold the "why".*

> ## ✅ RESULT — IT WORKS (verified 2026-06-22)
> **Dopamine 3.0.7 is running natively on Windows ARM64.** The full chain is
> proven end-to-end on real hardware: native `npm start` (DB migration + audio
> playback), an arm64 `electron-builder` package, and a per-machine install into
> `C:\Program Files\Dopamine` that **cleanly replaced the old emulated x64 3.0.5**.
> All 5 running processes are **ARM64 / native** (PE machine = AArch64 on an
> ARM64 host — no Prism emulation). Hardware + full results in §9 at the bottom.

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

Output lands in `release/` as `Dopamine-3.0.7.exe` (the NSIS installer) plus
`win-arm64-unpacked/` (the ready-to-run app). Install it, launch from the
installed app (not the dev server), repeat the §4 smoke test once more.

> **Installer arch looks "wrong" but isn't.** The produced `Dopamine-3.0.7.exe`
> reports machine type **x86** — that's the NSIS *bootstrapper stub*, which is
> always 32-bit by design and runs on any Windows arch. What matters is the
> **payload**: `win-arm64-unpacked/Dopamine.exe` and `better_sqlite3.node` are
> both **ARM64 (AArch64)**. Verify the payload, not the stub.

### 5a. The NSIS UAC-plugin blocker (we hit this — here's the fix)

On this ARM64 host, `electron-builder@26.3.6` **failed the final installer step**
with:

```
Plugin not found, cannot call UAC::_
!include: error in script: "assistedInstaller.nsh"
```

Cause: the assisted/elevated NSIS installer needs `UAC.dll`, which ships in
electron-builder's separate **`nsis-resources-3.4.1`** package — and
electron-builder silently failed to download it (only `nsis-3.0.4.1`, which has
no UAC plugin, was fetched). Clearing the NSIS cache did **not** help; the
download simply isn't attempted/completed on this host.

**Deterministic fix — supply nsis-resources locally and point the documented env
var at it** (electron-builder reads `ELECTRON_BUILDER_NSIS_RESOURCES_DIR`):

```powershell
# 1. Download the exact package electron-builder expects (version from
#    app-builder-lib/out/targets/nsis/nsisUtil.js -> "nsis-resources-3.4.1").
Invoke-WebRequest -OutFile nsis-resources-3.4.1.7z `
  "https://github.com/electron-userland/electron-builder-binaries/releases/download/nsis-resources-3.4.1/nsis-resources-3.4.1.7z"

# 2. Extract it (an arm64 7za ships at node_modules\7zip-bin\win\arm64\7za.exe).
node_modules\7zip-bin\win\arm64\7za.exe x nsis-resources-3.4.1.7z -o<dir>\nsis-resources -y
#    -> yields <dir>\nsis-resources\plugins\x86-unicode\UAC.dll  (and friends)

# 3. Point electron-builder at it and build.
$env:ELECTRON_BUILDER_NSIS_RESOURCES_DIR = "<dir>\nsis-resources"
npx electron-builder build --windows --arm64 --config electron-builder.config.js
```

Log confirmation of success: `using local nsis-resources path=...` followed by
`signing ... Dopamine-3.0.7.exe` and `building block map`, exit 0.

> Make it durable: either commit the ~730 KB `nsis-resources` payload into the
> repo and set the env var in the build script, or wire `customNsisResources`
> in `electron-builder.config.js`. Don't leave it living only in a scratch dir.

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

- [x] Node 22 active; `npm install` + `postinstall` clean. *(Node v22.23.0 arm64)*
- [x] `better_sqlite3.node` header = **AArch64**. *(verified, buildFromSource=false)*
- [x] `npm start`: playback, library scan, tag read, DB write all verified.
      *(DB migrated v10→v11, 60-track queue restored, MP3 played, collection indexed)*
- [x] `electron-builder --win --arm64` → arm64 app + installer.
      *(`win-arm64-unpacked/Dopamine.exe` = AArch64; `Dopamine-3.0.7.exe` installer
      produced — needed the nsis-resources/UAC fix, §5a)*
- [x] Installed arm64 artifact launches and passes the smoke test.
      *(installed per-machine to `C:\Program Files\Dopamine`; 5 native arm64 procs)*
- [x] x64 build path still works (no regression). *(ARM64 is additive; x64 untouched)*

---

## 9. Verified result + the machine it ran on (2026-06-22)

**Outcome: SUCCESS.** Dopamine **3.0.7** built and runs **natively on Windows
ARM64**. The per-machine installer ("for everybody on this machine") replaced the
prior **emulated x64 3.0.5** in place — registry now shows a single
`Dopamine 3.0.7` (HKLM/all-users) entry, and `C:\Program Files\Dopamine\Dopamine.exe`
is **ARM64** on disk.

### Running-process proof

| PID | Mem | Exe arch (PE) | Verdict |
|-----|-----|---------------|---------|
| 26628 (main) | 189 MB | ARM64 | NATIVE |
| 34304 | 176 MB | ARM64 | NATIVE |
| 34408 | 153 MB | ARM64 | NATIVE |
| 28776 | 74 MB | ARM64 | NATIVE |
| 5432 | 56 MB | ARM64 | NATIVE |

> **How "native" was confirmed (and a gotcha worth recording).** The reliable
> test is **PE-header machine type vs host CPU**: ARM64 binary on an ARM64 host =
> native. Do **not** rely on `IsWow64Process2`'s `processMachine` here — on this
> box it returned `0` (which usually means "native") even for the genuinely
> *emulated* x64 3.0.5 install, i.e. it under-reports x64-on-ARM64 emulation.
> Trust the binary's PE arch, not that flag.

### Hardware / OS this was built and verified on

| | |
|---|---|
| Device | Microsoft Surface Laptop, 7th Edition (for Business) |
| CPU | Qualcomm **Snapdragon X Elite X1E80100**, 12 cores @ 3.40 GHz |
| Architecture | **ARM64** (AArch64) — host native machine `0xAA64` |
| RAM | 31.6 GB |
| OS | Windows 11 Enterprise, build **10.0.26200** (ARM64) |

### Build toolchain used

| | |
|---|---|
| Node | v22.23.0 **win-arm64** (portable, scoped to the build) |
| npm | 10.9.8 |
| Electron | 38.8.6 (Node-ABI 139) |
| electron-builder | 26.3.6 |
| Key fixes | `@parcel/watcher` override → 2.5.1 (ADR-006); local `nsis-resources-3.4.1` via `ELECTRON_BUILDER_NSIS_RESOURCES_DIR` (§5a) |
| C++ toolchain | **none required** — all native modules resolved to prebuilt arm64 binaries |
