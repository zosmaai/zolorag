# Phase 6.3 (M3): Cross-Platform File Handling

> **Goal:** PDF loading works natively on both Android (file picker + Share intent) AND desktop (drag-and-drop + native file dialog). Neither platform's experience is degraded.
> **Depends on:** M1 (toolchain)
> **Status (2026-06-12):** 🟡 Code complete + compile-verified on both platforms. Android runtime verification ⏸ deferred (blocked on M2's `pnpm tauri android dev`).

---

## 🚦 M3 Final Status: CODE COMPLETE — Runtime Verification Deferred

**Implemented + compile-verified (2026-06-12):**

| Area | Files | Verified by |
|------|-------|-------------|
| Android content URI → local path | `src-tauri/src/mobile/storage.rs` (JNI → ContentResolver) | `cargo build --target aarch64-linux-android --lib --release` ✅ 26 MB `.so` |
| Cross-platform path resolver | `src-tauri/src/path_resolver.rs` | desktop `cargo build` ✅ |
| `load_pdf` wired through resolver | `src-tauri/src/lib.rs` | `cargo test --lib --release` ✅ 19/19 |
| `resolve_pdf_path` Tauri command | `src-tauri/src/lib.rs` | registered |
| Android-only deps gated | `Cargo.toml` `[target.'cfg(target_os="android")']` | desktop binary doesn't link `jni`/`ndk-context` |
| Manifest intent filters | VIEW (content + file) + SEND, `application/pdf` | manifest valid |
| Intent capture + JS bridge | `MainActivity.kt` — `extractPdfUri` + `evaluateJavascript("window.__zoloragPdfIntent('...')")` | compiles |
| `useIsMobile` hook | `src/hooks/useIsMobile.ts` | no new deps |
| `OpenPdfButton` | `src/components/OpenPdfButton.tsx` | `pnpm build` ✅ |
| Conditional UI | `src/app/page.tsx` — DropZone on desktop, OpenPdfButton on mobile | `pnpm build` ✅ |
| Window-level intent listener | `src/app/page.tsx` — `window.__zoloragPdfIntent` | `pnpm build` ✅ |

**Architectural deviations from the original plan (intentional, simpler):**

- **No `open_pdf_picker()` Rust command.** Frontend uses `@tauri-apps/plugin-dialog` directly. Resolver runs inside `load_pdf`.
- **No `pdf://intent` Tauri event.** `MainActivity.evaluateJavascript` calls `window.__zoloragPdfIntent(uri)` directly. Avoids immature Tauri mobile event API.
- **`useIsMobile` via media query**, not Tauri `platform()`. Skips `@tauri-apps/plugin-os` dep.

---

## ⚠️ Cross-Platform Constraint

This is **additive**, not a migration. The original plan said "replace desktop drag-and-drop" — that is wrong.

| Platform | Input method | What changes |
|----------|-------------|--------------|
| Desktop (macOS/Windows/Linux) | DropZone (drag-and-drop) + "Open PDF" button | Nothing broken. Button already exists or is added alongside DropZone. |
| Android | "Open PDF" button + Share/Open-with intent | Net new. DropZone is hidden/absent on mobile (no drag-and-drop). |

**Shared backend**: `open_pdf(path)` command works identically on both platforms. The only platform-specific layer is how a file `path` is resolved — on Android a `content://` URI must first be copied to app-private storage; on desktop it's already a real path.

---

## Architecture

```
Frontend
├── <DropZone>          → desktop only (CSS: hidden on mobile via Tauri `platform()`)
├── <OpenPdfButton>     → both platforms (calls `open_pdf_picker` Tauri command)
└── intent auto-load    → Android only (listens for incoming intent event from Rust)

Backend (Rust)
├── commands/file.rs
│   ├── open_pdf_picker()   → invokes tauri-plugin-dialog, returns resolved PathBuf
│   └── load_pdf(path)      → existing PDF parse+chunk pipeline (unchanged)
│
└── mobile/storage.rs       → #[cfg(target_os = "android")] only
    └── copy_content_uri_to_app_storage(uri) → PathBuf
        (Android ContentResolver → app cache dir)
```

---

## Tasks

### 1. Platform-Aware Path Resolution
- [x] `src-tauri/src/mobile/storage.rs` — `copy_content_uri_to_app_storage(uri, dest_dir)` via JNI → `ContentResolver.openInputStream`, 64 KiB chunked write to `app_cache_dir()/pdfs/<name>`. `#[cfg(target_os = "android")]`.
- [x] `src-tauri/src/path_resolver.rs` — `resolve_to_local_path(raw, app)`: desktop = identity, Android = URI copy.
- [x] `load_pdf` calls resolver before parsing — desktop flow untouched.
- [x] New Tauri command `resolve_pdf_path(path)` exposed for explicit JS use.
- [ ] ⏸ Large PDF (100+ MB) JNI byte-loop perf — needs device.
- [ ] ⏸ Google Drive / network URI streaming — needs device.

### 2. File Picker (Cross-Platform)
- [x] `tauri-plugin-dialog` present in both `package.json` and `Cargo.toml`.
- [x] Frontend uses `@tauri-apps/plugin-dialog`'s `open()` directly in `handleBrowse()` — works on both platforms; resolver runs in `load_pdf` so no Rust wrapper needed.
- [x] Desktop native file dialog: pre-existing, untouched, still works.
- [ ] ⏸ Android file picker with PDF filter — needs APK.
- [ ] ⏸ Test sources on Android (Downloads, Drive, file manager) — needs APK.

### 3. Frontend: Additive UI — Do Not Remove DropZone
- [x] `<DropZone>` kept; rendered only when `!isMobile`.
- [x] `<OpenPdfButton>` added with `variant="primary"` (mobile) / `variant="secondary"` (desktop link below DropZone).
- [x] `useIsMobile` hook via `(pointer: coarse) and (max-width: 900px)` media query.
- [x] Conditional in `page.tsx`: `isMobile ? <OpenPdfButton primary> : <DropZone> + <OpenPdfButton secondary>`.
- [x] DropZone's `onBrowse` still calls the same `handleBrowse` → `load_pdf` path — zero change to desktop code path.

### 4. Android Intent Filter (Open With / Share)
- [x] `AndroidManifest.xml` updated: VIEW (`content` + `file` scheme, `application/pdf`, `DEFAULT` + `BROWSABLE`) and SEND (`application/pdf`, `DEFAULT`).
- [x] `MainActivity.kt` handles intents:
  - `onCreate` captures cold-launch URI, queues until WebView ready.
  - `onWebViewCreate` flushes queued URI to JS.
  - `onNewIntent` handles warm-launch.
  - Extracts URI from `ACTION_VIEW.data` or `ACTION_SEND.EXTRA_STREAM`.
  - Dispatches via `webView.evaluateJavascript("window.__zoloragPdfIntent('...')")`.
- [x] Frontend installs `window.__zoloragPdfIntent` listener in `page.tsx` → routes through `loadPdfByPath` → `load_pdf` → resolver → ContentResolver copy.
- [x] Desktop: no changes — all intent code is in `MainActivity.kt` (Android-only).
- [ ] ⏸ Verify ZoloRAG appears in “Open with” for `content://...pdf` — needs APK.
- [ ] ⏸ Verify ZoloRAG appears in Share sheet for `application/pdf` — needs APK.
- [ ] ⏸ Verify `evaluateJavascript` reaches `window.__zoloragPdfIntent` at correct lifecycle — needs running app.

### 5. PDF Parsing Verification
- [x] Desktop regression: `cargo test --lib --release` → **19/19 pass**, `pdf::extract` + `pdf::chunk` tests all green.
- [x] Desktop build: `cargo build --lib --release` → ✅ 1m 32s.
- [x] Android build: `cargo build --target aarch64-linux-android --lib --release` → ✅ 26 MB `.so`.
- [ ] ⏸ Android runtime byte-for-byte parity vs desktop — needs APK + sample PDFs.
- [ ] ⏸ Large PDF (300+ pages) parity — needs APK.
- [ ] ⏸ Scanned PDF graceful error on Android — needs APK.

### 6. Error Handling & User Feedback
- [x] `load_pdf` errors surface as `Result<_, String>` to JS — existing `loadError` banner in `page.tsx` catches resolver failures too.
- [x] `copy_content_uri_to_app_storage` returns descriptive errors at every JNI failure point (null InputStream, read/write failures, allocation).
- [ ] ⏸ Password-protected PDF UX — needs device.
- [ ] ⏸ Corrupted PDF UX — needs device.
- [ ] ⏸ Storage-full pre-check — **deferred to M5** (storage check is M5 scope).
- [ ] ⏸ Permission-denied re-request flow — needs device.

### 7. File Cleanup (Android only) — ⏸ Deferred to M5
- [ ] ⏸ TTL/startup cleanup of `app_cache_dir()/pdfs/` — **moved to M5** with the rest of storage management. M3 writes there; M5 owns the lifecycle.

---

## Feasibility Checklist

| # | Check | Platform | Status | Notes |
|---|-------|----------|--------|-------|
| 1 | DropZone drag-drop wiring intact | Desktop | ✅ | `tauri://drag-drop` listener present; rendered when `!isMobile` |
| 2 | `tauri-plugin-dialog` native dialog | Desktop | ✅ | Pre-existing, untouched |
| 3 | `tauri-plugin-dialog` file picker on Android | Android | ⏸ | Plugin compiles; runtime needs APK |
| 4 | `resolve_to_local_path` no-op on desktop | Desktop | ✅ | `#[cfg]` block; desktop returns `PathBuf::from(raw)` |
| 5 | Content URI → local copy < 10 MB | Android | ⏸ | Code in place; needs device |
| 6 | Content URI → local copy > 100 MB | Android | ⏸ | 64 KiB chunked loop; needs device |
| 7 | `pdf-extract` desktop vs Android parity | Both | ⏸ | Desktop 19/19 ✅; Android needs APK |
| 8 | Intent VIEW shows ZoloRAG in Files | Android | ⏸ | Manifest correct; needs installed APK |
| 9 | Intent SEND shows ZoloRAG in Share sheet | Android | ⏸ | Manifest correct; needs installed APK |
| 10 | Intent data reaches JS | Android | ⏸ | Code in place; needs running app |
| 11 | App doesn't crash on permission denied | Both | ⏸ | Error path returns `Result::Err`; UX needs device |
| 12 | Scanned PDF shows meaningful error | Both | ⏸ | Needs device |
| 13 | Cache cleanup doesn't delete unexpected files | Android | ⏸ | Deferred to M5 |

---

## Blockers & Risks

| Risk | Impact | Platform | Mitigation |
|------|--------|----------|------------|
| Tauri mobile intent API undocumented / immature | **High** | Android | May need Kotlin bridge plugin; budget 1–2 days |
| Content URI stream slow for Google Drive / network pickers | Medium | Android | Background task + progress bar |
| `pdf-extract` crashes on certain Android file systems | Low | Android | Fallback to `lopdf` |
| Frontend `isMobile` detection wrong in Tauri WebView | Medium | Both | Test on actual emulator + desktop side-by-side |
| Android 13+ granular media permissions | Low | Android | Scoped storage handles it; no `READ_EXTERNAL_STORAGE` needed for picker-returned URIs |
| **DropZone accidentally removed/broken during UI changes** | **High** | Desktop | Explicit regression test in exit criteria |

---

## Success Criteria

### Desktop (must not regress)
- [x] DropZone drag-and-drop wiring intact — `tauri://drag-drop` listener unchanged
- [x] "Open PDF" button opens native file dialog — pre-existing `handleBrowse` unchanged
- [x] PDF parses and chunks identically to pre-M3 — 19/19 tests pass

### Android (net new — code complete, runtime deferred)
- [x] OpenPdfButton renders on mobile, wires to `handleBrowse` → `tauri-plugin-dialog`
- [x] Selected PDF flows through resolver → ContentResolver copy → same `pdf-extract` pipeline
- [x] Manifest intent filters in place (VIEW + SEND)
- [x] `MainActivity` captures cold + warm launch intents
- [ ] ⏸ Verify Share sheet / Open with listing — needs APK
- [ ] ⏸ Verify intent dispatch reaches JS — needs running app

### Both
- [x] Error path returns `Result::Err` from every failure point; existing UI catches it
- [ ] ⏸ Polish error messages for password / corrupt / too-large — needs device

---

## Exit Criteria

M3 is **complete** when:
1. ✅ Desktop DropZone still works — zero regression (verified 2026-06-12)
2. ✅ Desktop "Open PDF" button works (native dialog, pre-existing)
3. ⏸ Android file picker works (≤ 3 taps) — needs APK
4. ⏸ Android Share/Open-with intent auto-loads the PDF — needs APK
5. ⏸ Parsed text matches between platforms for the same PDF — needs APK
6. ⏸ All error states tested on both platforms — desktop ✅, Android needs APK
7. ⏸ Team signs off on the cross-platform UX — pending Android verification

### What's needed to fully close
