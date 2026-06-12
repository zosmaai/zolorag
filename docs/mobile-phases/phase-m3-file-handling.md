# Phase 6.3 (M3): Cross-Platform File Handling

> **Goal:** PDF loading works natively on both Android (file picker + Share intent) AND desktop (drag-and-drop + native file dialog). Neither platform's experience is degraded.
> **Depends on:** M1 (toolchain)

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

### 1. Platform-Aware Path Resolution (Android-only code, shared interface)
- [ ] Create `src-tauri/src/mobile/storage.rs` with `copy_content_uri_to_app_storage(uri: &str) -> Result<PathBuf>`
  - `#[cfg(target_os = "android")]` gate — does NOT compile on desktop
  - Uses Tauri Android `Context` + `ContentResolver` to open InputStream
  - Streams bytes to `app_cache_dir()/pdfs/<filename>`
  - Handles: large PDFs (100+ MB), slow streams (Google Drive), network URIs
- [ ] Create `src-tauri/src/commands/file.rs` with a `resolve_to_local_path(raw: &str) -> Result<PathBuf>` helper:
  ```rust
  #[cfg(target_os = "android")]
  fn resolve_to_local_path(raw: &str) -> Result<PathBuf> {
      if raw.starts_with("content://") {
          copy_content_uri_to_app_storage(raw)
      } else {
          Ok(PathBuf::from(raw))
      }
  }

  #[cfg(not(target_os = "android"))]
  fn resolve_to_local_path(raw: &str) -> Result<PathBuf> {
      Ok(PathBuf::from(raw)) // desktop: path is already real
  }
  ```
- [ ] All downstream PDF commands call `resolve_to_local_path()` — existing desktop flow untouched

### 2. File Picker (Cross-Platform)
- [ ] Confirm `tauri-plugin-dialog` is in dependencies (already used on desktop)
- [ ] Expose `open_pdf_picker()` Tauri command:
  - Calls `dialog::FileDialogBuilder::new().add_filter("PDF", &["pdf"]).pick_file()`
  - Returns the raw path string (may be `content://` on Android, real path on desktop)
  - Passes result through `resolve_to_local_path()` before handing to the PDF pipeline
- [ ] **Desktop**: verify native file dialog still opens (macOS/Windows/Linux)
- [ ] **Android**: verify Android file picker opens with PDF filter
- [ ] Test sources on Android: Downloads folder, Google Drive, a file manager app

### 3. Frontend: Additive UI — Do Not Remove DropZone
- [ ] **Keep `<DropZone>` component** on desktop — this is the primary desktop UX, do not remove or hide it on desktop
- [ ] Add `<OpenPdfButton>` component (or confirm it already exists):
  - Shown on **both** platforms
  - On desktop: sits alongside DropZone as a secondary option
  - On mobile: primary (only) file input method
- [ ] Use Tauri's `platform()` helper or a `isMobile` flag to conditionally render:
  ```tsx
  {!isMobile && <DropZone onDrop={handleDrop} />}
  <OpenPdfButton onClick={openPicker} />
  ```
- [ ] Confirm DropZone's existing `onDrop` handler still calls the same `load_pdf` command — no changes needed to the desktop code path

### 4. Android Intent Filter (Open With / Share)
- [ ] Edit `src-tauri/gen/android/app/src/main/AndroidManifest.xml`:
  - Add `<intent-filter>` for `android.intent.action.VIEW`, `scheme="content"`, `mimeType="application/pdf"`
  - Add `<intent-filter>` for `android.intent.action.SEND`, `mimeType="application/pdf"`
- [ ] Handle incoming intent in Rust: emit a Tauri event `pdf://intent` with the URI
- [ ] Frontend listens for `pdf://intent` → calls `resolve_to_local_path` → loads PDF
- [ ] Handle `onNewIntent` (app already running when intent arrives)
- [ ] **Desktop**: no changes — intent handling is Android-only

### 5. PDF Parsing Verification (Both Platforms)
- [ ] **Desktop** (regression): drag-drop a 10-page PDF → extracted text unchanged from pre-M3
- [ ] **Android** (new): pick same PDF via file picker → extracted text matches desktop output exactly
- [ ] Test `pdf-extract` + `lopdf` fallback on both platforms
- [ ] Large PDF (300+ pages): desktop vs Android output match
- [ ] Scanned PDF: graceful error on both platforms

### 6. Error Handling & User Feedback (Both Platforms)
- [ ] Loading spinner during content URI copy (Android) and large file parse (both)
- [ ] Error toast: password-protected PDF (both)
- [ ] Error toast: corrupted PDF (both)
- [ ] Error toast: storage full — checked before copy (Android) / before parse (desktop)
- [ ] Permission denied: Android shows re-request prompt, desktop shows "file not accessible" error

### 7. File Cleanup (Android only)
- [ ] Clean up `app_cache_dir()/pdfs/` on app start (TTL-based or on new PDF load)
- [ ] Desktop: no cache dir used — files are read in-place, nothing to clean

---

## Feasibility Checklist

| # | Check | Platform | Status | Notes |
|---|-------|----------|--------|-------|
| 1 | DropZone drag-drop still works after M3 | Desktop | ☐ | Regression test — must pass |
| 2 | `tauri-plugin-dialog` native dialog works | Desktop | ☐ | Already used, should be no-op |
| 3 | `tauri-plugin-dialog` file picker works | Android | ☐ | PDF MIME filter |
| 4 | `resolve_to_local_path` is a no-op on desktop | Desktop | ☐ | Compile + unit test |
| 5 | Content URI → local file copy < 10 MB | Android | ☐ | Baseline |
| 6 | Content URI → local file copy > 100 MB | Android | ☐ | Streaming / timeout |
| 7 | `pdf-extract` output identical desktop vs Android | Both | ☐ | Byte-level diff |
| 8 | Intent VIEW filter shows ZoloRAG in Files app | Android | ☐ | |
| 9 | Intent SEND filter shows ZoloRAG in Share sheet | Android | ☐ | |
| 10 | Intent data received and handled in Rust | Android | ☐ | |
| 11 | App doesn't crash on permission denied | Both | ☐ | |
| 12 | Scanned PDF shows meaningful error | Both | ☐ | |
| 13 | Cache cleanup doesn't delete unexpected files | Android | ☐ | Only `app_cache_dir()/pdfs/` |

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
- [ ] DropZone drag-and-drop still works exactly as before M3
- [ ] "Open PDF" button opens native file dialog (macOS/Windows/Linux)
- [ ] PDF parses and chunks identically to pre-M3

### Android (net new)
- [ ] "Open PDF" button opens Android file picker filtered to PDFs
- [ ] Selected PDF parses and chunks (same result as desktop)
- [ ] ZoloRAG appears in Android "Share" sheet for PDF files
- [ ] ZoloRAG appears in Android "Open with" dialog for PDF files
- [ ] Incoming PDF intents handled (cold start and warm launch)

### Both
- [ ] Error states (permission denied, corrupt PDF, too large) show user-friendly messages
- [ ] No crashes during any file operation on either platform

---

## Exit Criteria

M3 is **complete** when:
1. Desktop DropZone still works — zero regression
2. Desktop "Open PDF" button works (native dialog)
3. Android file picker works (≤ 3 taps to load a PDF)
4. Android Share/Open-with intent auto-loads the PDF
5. Parsed text matches between platforms for the same PDF
6. All error states tested on both platforms
7. Team signs off on the cross-platform UX
