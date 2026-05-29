# Phase 6.3 (M3): Android File Handling

> **Goal:** Users can open PDFs from the file picker or via the Android "Share" / "Open with" intent, and the app parses them correctly.
> **Depends on:** M1 (toolchain)

---

## Scope

Replace the desktop drag-and-drop PDF loading with Android-native file access patterns:
1. **File picker** — "Open PDF" button triggers Android's file picker (via `tauri-plugin-dialog`)
2. **Intent handling** — App registers as a PDF viewer so users can "Share" or "Open with" ZoloRAG
3. **Content URI plumbing** — Copy `content://` URIs to app-private storage so `pdf-extract`/`lopdf` can read them

## Tasks

### 1. Content URI to File Copy Utility
- [ ] Create `src-tauri/src/mobile/storage.rs` with a `copy_content_uri_to_app_storage(uri: &str) -> Result<PathBuf>` function
- [ ] Use Tauri's Android API to get `Context` and `ContentResolver`
- [ ] Implement: open InputStream via ContentResolver → read bytes → write to app cache dir
- [ ] Handle edge cases: large PDFs (100+ MB), slow streams, network URIs
- [ ] Return the local `PathBuf` so the existing PDF parser works unchanged

### 2. File Picker Integration
- [ ] Add `tauri-plugin-dialog` to dependencies (already used on desktop)
- [ ] Create a Tauri command: `open_pdf_picker()` → returns file path or content URI
- [ ] On Android, configure file picker filter for `application/pdf` MIME type
- [ ] Wire up a "📄 Open PDF" button in the frontend (replaces DropZone for mobile)
- [ ] Test: pick a PDF from Downloads, Google Drive, and a file manager app

### 3. Android Intent Filter (Open With / Share)
- [ ] Edit `src-tauri/gen/android/app/src/main/AndroidManifest.xml`:
  - Add `<intent-filter>` for `android.intent.action.VIEW` with `scheme="content"` and `mimeType="application/pdf"`
  - Add `<intent-filter>` for `android.intent.action.SEND` with `mimeType="application/pdf"`
- [ ] Add a Tauri event listener for the incoming intent data (Tauri's mobile layer exposes this via `tauri::api::mobile::intent()` or similar)
- [ ] When the app is opened via a PDF intent, auto-load that PDF
- [ ] Handle the case where the app is already running (new intent → `onNewIntent`)

### 4. PDF Parsing Verification on Android
- [ ] Test `pdf-extract` on a 10-page PDF via the content URI pipeline
- [ ] Verify extracted text is identical to desktop extraction
- [ ] Test `lopdf` fallback path (for PDFs where `pdf-extract` returns empty)
- [ ] Test on a large PDF (300+ pages, e.g., a textbook)
- [ ] Test on a scanned PDF (image-only, expect graceful failure/error message)

### 5. Error Handling & User Feedback
- [ ] Show a loading spinner while the PDF is being copied from content URI
- [ ] Show error toast if the PDF is password-protected or corrupted
- [ ] Show error toast if storage is full (checked before copy)
- [ ] Handle the case where the user denies file access permission

### 6. File Cleanup
- [ ] Optionally clean up cached PDFs when the app starts (or after a configurable TTL)
- [ ] Document storage usage pattern

---

## Feasibility Checklist (Blocker Detection)

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 1 | `tauri-plugin-dialog` file picker works on Android with PDF filter | ☐ | Tauri plugin may need Android-specific config |
| 2 | Content URI → local file copy works for files under 10 MB | ☐ | Baseline test |
| 3 | Content URI → local file copy works for files over 100 MB | ☐ | Streaming, memory, timeout test |
| 4 | `pdf-extract` + `lopdf` produce identical text on Android vs desktop | ☐ | |
| 5 | AndroidManifest intent-filter for PDF VIEW works | ☐ | Tapping a PDF in Files app shows ZoloRAG as option |
| 6 | AndroidManifest intent-filter for PDF SEND works | ☐ | Sharing a PDF from another app shows ZoloRAG |
| 7 | Intent data is received and handled by the Rust backend | ☐ | Tauri mobile intent API |
| 8 | App doesn't crash when file access is denied/permission missing | ☐ | |
| 9 | Scanned PDF shows a meaningful error instead of garbled text | ☐ | |
| 10 | Cleanup doesn't delete user-important files | ☐ | Only cache dir files are cleaned |

## Blockers & Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Tauri mobile intent API is immature or undocumented | **High** | May need to write a Tauri plugin or use Android Kotlin bridge directly |
| Content URI stream is slow for network-based file pickers (Google Drive) | Medium | Show progress; consider background download with wake lock |
| `pdf-extract` crashes on certain Android file systems | Low | Add try/catch and fallback to `lopdf` |
| Android 13+ granular media permissions | Low | Only need `READ_EXTERNAL_STORAGE` for older devices; scoped storage handles new ones |

## Success Criteria

- [ ] "Open PDF" button opens the Android file picker filtered to PDFs
- [ ] Selected PDF is parsed and chunked (same result as desktop)
- [ ] App appears in the Android "Share" sheet for PDF files
- [ ] App appears in the Android "Open with" dialog for PDF files
- [ ] Incoming PDF intents are handled (both cold start and warm launch)
- [ ] Error states (permission denied, corrupt PDF, too large) show user-friendly messages
- [ ] No crashes during any file operation

## Exit Criteria

M3 is **complete** when:
1. A user can open a PDF in ZoloRAG via file picker in ≤ 3 taps
2. A user can share a PDF from another app to ZoloRAG and it auto-loads
3. Parsed text matches desktop output
4. All error states have been tested and show meaningful messages
5. Team reviews the file handling UX flow
