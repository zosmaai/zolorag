# Phase 6.5 (M5): Setup Wizard & Model Download for Mobile

> **Goal:** First-run experience guides the user through model download with mobile-specific considerations (Wi-Fi check, storage check, pause/resume).
> **Depends on:** M2 (ML works on device), M4 (UI has mobile layout)

---

## Scope

Adapt the existing model download manager to work well on mobile:
- Storage space checks before download
- Wi-Fi-only download with override option
- Progress tracking with estimated time
- Graceful handling of app going to background during download
- First-run wizard flow tailored to mobile form factor

## Tasks

### 1. Storage Space Checks
- [ ] Before download, check available free space in app data directory
- [ ] Compare against model size + 10% overhead (for temporary files)
- [ ] Show warning if insufficient space (with "Free up space" guidance)
- [ ] Check is done in Rust via `std::fs::metadata` + `fs2` crate (or similar free-space API)
- [ ] If Tauri's `path` API doesn't expose free space, use Android-specific `StatFs` via JNI

### 2. Network Checks & Wi-Fi Awareness
- [ ] Before starting download, check if on Wi-Fi
- [ ] If on mobile data → show dialog: "Downloading [size] over mobile data may use your data plan. Continue?"
- [ ] Provide "Download over Wi-Fi only" toggle in settings (persisted)
- [ ] If on Wi-Fi-only mode and not on Wi-Fi → show "Connect to Wi-Fi to download" message
- [ ] Implementation: use `ConnectivityManager` on Android via Tauri plugin or JNI bridge

### 3. Download Progress (Mobile-Optimized)
- [ ] Reuse existing `reqwest` + Range-request downloader (pause/resume works)
- [ ] Progress events are already emitted via Tauri events — frontend already handles this
- [ ] Add estimated time remaining calculation (bytes/sec smoothed over last 10 samples)
- [ ] Show download speed (MB/s) for user feedback
- [ ] Test pause/resume: kill app, reopen, verify download resumes from last byte

### 4. Background Download Resilience
- [ ] If user switches away from app during download, download continues (file write continues)
- [ ] If Android kills the app process, partial download is recoverable (Range header)
- [ ] Acquire a partial wake lock during download to prevent device sleep
- [ ] Consider using Android `DownloadManager` for very large models (alternative path)

### 5. First-Run Wizard (Mobile Version)
- [ ] Modify SetupPanel (from M4) to show model selection flow:
  - Step 1: "Welcome to ZoloRAG" — brief value prop, "Get Started" button
  - Step 2: Model selection — show 2–3 model options with size/RAM requirements:
    - "Fast" (Qwen2.5-0.5B, ~400 MB, runs on 4 GB devices)
    - "Balanced" (Qwen2.5-1.5B, ~1 GB, recommended for 8 GB devices)
    - "Powerful" (Llama 3.2-3B, ~1.8 GB, flagship 12+ GB devices only)
  - Step 3: Download confirmation — show size, Wi-Fi status, storage check
  - Step 4: Download progress — animated progress bar with ETA
  - Step 5: "Ready!" — model loaded, "Open a PDF to start" with OpenPdfButton
- [ ] Model selection should show RAM estimate vs device RAM (detect via Tauri API)
- [ ] After Step 5, skip wizard on subsequent launches

### 6. Model Switching
- [ ] Allow user to download a different model later (from settings page)
- [ ] Show storage saved by keeping only one model (no auto-delete, manual switch)
- [ ] When switching models, unload current before loading new one (memory management)

### 7. Error Handling for Downloads
- [ ] Network timeout → show retry button with exponential backoff suggestion
- [ ] Storage full mid-download → pause, show message, resume after space freed
- [ ] Corrupted download → offer to re-download (verify with checksum if available)
- [ ] Server error (HTTP 4xx/5xx) → show clear error, not a generic failure

---

## Feasibility Checklist (Blocker Detection)

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 1 | Free storage check works before download starts | ☐ | May need JNI for `StatFs` |
| 2 | Wi-Fi status detection works on Android | ☐ | May need Tauri plugin or JNI |
| 3 | Wi-Fi-only toggle is persisted and respected | ☐ | |
| 4 | Download progress with ETA shows correctly in mobile UI | ☐ | |
| 5 | App going to background → download continues | ☐ | Wake lock or foreground service |
| 6 | App killed → resume download from byte N works | ☐ | |
| 7 | First-run wizard is intuitive on a 6.3" screen | ☐ | |
| 8 | Model selection correctly shows RAM estimate vs device RAM | ☐ | Need device RAM detection API |
| 9 | Switching models unloads old model before loading new | ☐ | |
| 10 | All download errors show user-friendly messages | ☐ | |

## Blockers & Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Wi-Fi / network detection requires Android native code | Medium | Write a minimal Tauri plugin or use `tauri-plugin-http` with connectivity check |
| Wake lock requires Android foreground service | **High** | Large downloads need persistent notification; may require Kotlin plugin |
| `fs2` crate for free space may not compile for Android | Low | Fall back to Android `StatFs` via JNI |
| Users on slow/metered connections have bad experience | Medium | Offer smaller model as default; show clear size warnings |
| Google Play may reject wake lock without foreground service | Low | We're sideloading initially; defer Play Store compliance |

## Success Criteria

- [ ] First-run wizard completes without confusion on device
- [ ] Model download succeeds over Wi-Fi with clean progress UI
- [ ] Model download warns on mobile data and respects Wi-Fi-only setting
- [ ] Pause/resume works across app restarts
- [ ] Storage space is checked before download starts
- [ ] Model switching works without memory leaks
- [ ] Total download time for the "Balanced" model (1 GB) ≤ 10 minutes on a 50 Mbps connection

## Exit Criteria

M5 is **complete** when:
1. A clean install of the app → first-run wizard → model download → ready state works end-to-end
2. Download resilience is tested (background, kill, resume)
3. Network and storage edge cases are handled gracefully
4. Team reviews the first-run flow on a real device
