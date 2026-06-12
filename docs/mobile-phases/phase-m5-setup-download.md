# Phase 6.5 (M5): Setup Wizard & Model Download — Cross-Platform

> **Goal:** First-run experience and model download work reliably on both desktop and Android. Android gets mobile-specific additions (Wi-Fi check, wake lock, background resilience). Desktop is not regressed.
> **Depends on:** M2 (ML works on device), M4 (UI responsive layout)

---

## ⚠️ Cross-Platform Constraint

The existing model download manager already works on desktop. This phase:

| Concern | Desktop | Android |
|---------|---------|---------|
| First-run wizard | ✅ Keep existing — add nothing, break nothing | Responsive adaptation from M4 + mobile-specific steps |
| Storage check | ✅ Already works via `std::fs` | Same + Android `StatFs` fallback if `std::fs` free-space is unavailable |
| Download progress | ✅ Already works | Same `reqwest` + Range resume — no changes |
| Wi-Fi detection | ❌ N/A (always on a network) | 🤖 Android-only — `ConnectivityManager` via JNI |
| Wake lock | ❌ N/A (desktop doesn't sleep mid-download) | 🤖 Android-only — foreground service or partial wake lock |
| Background resilience | ✅ App stays alive on desktop | 🤖 Android-only — handle process kill + resume |
| RAM detection | ✅ Already works (`sys-info` crate) | Same — `sys-info` works on Android too |

**Android-specific code is always gated behind `#[cfg(target_os = "android")]`.**

---

## Scope

Extend the download manager for mobile-specific edge cases, add Android-native network/storage checks, and ensure the first-run wizard works on both form factors.

---

## Tasks

### 1. Storage Space Check (Cross-Platform with Android Fallback)
- [ ] Before download, check available free space in the app data directory
- [ ] Primary: `fs2` crate's `available_space()` — works on desktop (macOS/Windows/Linux)
- [ ] Android fallback: if `fs2` reports 0 or fails, use Android `StatFs` via JNI
- [ ] Compare available space against: `model_size_bytes * 1.1` (10% overhead)
- [ ] Show warning if insufficient space with "how to free up space" guidance
- [ ] **Desktop regression**: existing storage check (if any) must still work

### 2. Network Checks & Wi-Fi Awareness (Android-only)
- [ ] `#[cfg(target_os = "android")]` gate on all network-check code
- [ ] Before download, detect if on Wi-Fi via `ConnectivityManager`
  - Implement as a minimal Tauri plugin or JNI bridge
- [ ] On mobile data → dialog: "Downloading [X GB] over mobile data — continue?"
- [ ] "Wi-Fi only" toggle in settings (persisted to disk)
- [ ] On Wi-Fi-only mode + not on Wi-Fi → "Connect to Wi-Fi to download" block
- [ ] **Desktop**: no network check UI — downloads always proceed

### 3. Download Progress — Shared (No Desktop Changes)
- [ ] Reuse existing `reqwest` + Range-request pause/resume downloader — unchanged
- [ ] Progress events already emitted via Tauri events — frontend already handles them
- [ ] Add estimated time remaining: bytes/sec smoothed over last 10 samples (both platforms)
- [ ] Show download speed (MB/s) for feedback (both platforms)
- [ ] Test pause/resume: kill app, reopen, verify download resumes from last byte
  - Desktop: kill process, reopen — verify resume
  - Android: kill via recents, reopen — verify resume

### 4. Background Download Resilience (Android-only)
- [ ] `#[cfg(target_os = "android")]` gate
- [ ] If user switches away from app during download, download continues
  - Use Android foreground service with a persistent notification: "Downloading model... X%"
- [ ] Acquire partial wake lock to prevent device sleep during download
- [ ] If Android kills the app process mid-download, partial file survives → Range resume on next open
- [ ] Consider `Android DownloadManager` as an alternative for very large models (>2 GB)
- [ ] **Desktop**: no changes — desktop process lifecycle handles this natively

### 5. First-Run Wizard — Responsive, Not Replaced
- [ ] **Desktop**: existing wizard/SetupPanel keeps its current layout and flow — no changes
- [ ] **Mobile** (additive, uses M4's responsive SetupPanel):
  - Step 1: "Welcome to ZoloRAG" — brief value prop, "Get Started"
  - Step 2: Model selection — 3 options with size + RAM requirements:
    - "Fast" (Qwen2.5-0.5B, ~400 MB, 4 GB devices)
    - "Balanced" (Qwen2.5-1.5B, ~1 GB, 8 GB devices — recommended)
    - "Powerful" (Llama 3.2-3B, ~1.8 GB, 12 GB+ devices)
  - Step 3: Download confirmation — size, Wi-Fi status (Android) / storage check (both)
  - Step 4: Download progress — animated bar with ETA
  - Step 5: "Ready!" — model loaded, OpenPdfButton
- [ ] Shared state machine between desktop and mobile — only presentation differs
- [ ] After Step 5, skip wizard on subsequent launches (both platforms)
- [ ] **Desktop regression**: existing "model already downloaded" detection must still skip wizard

### 6. Device RAM Detection & Model Recommendation (Both Platforms)
- [ ] Use `sys-info` crate (`mem_info().total`) to read total RAM — works on desktop + Android
- [ ] Auto-select recommended model based on RAM:
  - <5 GB → "Fast" (0.5B)
  - 5–10 GB → "Balanced" (1.5B)
  - >10 GB → "Powerful" (3B)
- [ ] User can override the recommendation
- [ ] Show: "Your device has X GB RAM. We recommend [model]."

### 7. Model Switching (Both Platforms)
- [ ] Allow downloading a different model from Settings (both platforms)
- [ ] When switching: unload current model before loading new one (memory management)
- [ ] Show storage used by current model — manual delete, no auto-delete
- [ ] **Desktop**: same behavior, simpler UI (no Wi-Fi check)

### 8. Error Handling for Downloads (Both Platforms)
- [ ] Network timeout → retry button with exponential backoff suggestion
- [ ] Storage full mid-download → pause + message + resume after space freed
- [ ] Corrupted download → offer re-download (verify with SHA256 checksum if server provides it)
- [ ] Server error (HTTP 4xx/5xx) → clear error, not generic failure
- [ ] **Android-only**: Wi-Fi dropped mid-download → pause + "Reconnect to Wi-Fi to continue"

---

## Feasibility Checklist

| # | Check | Platform | Status |
|---|-------|----------|--------|
| 1 | Existing desktop wizard still works — zero regression | Desktop | ☐ |
| 2 | Existing desktop download still works — zero regression | Desktop | ☐ |
| 3 | Storage check via `fs2` compiles and works | Desktop | ☐ |
| 4 | Storage check fallback via `StatFs` compiles for Android | Android | ☐ |
| 5 | Wi-Fi detection works on Android 12, 13, 14 | Android | ☐ |
| 6 | Wi-Fi-only toggle persisted and respected | Android | ☐ |
| 7 | Foreground service notification shows during download | Android | ☐ |
| 8 | App killed → resume from last byte on reopen | Both | ☐ |
| 9 | `sys-info` RAM detection works on Android | Android | ☐ |
| 10 | Model recommendation matches device RAM | Both | ☐ |
| 11 | Model switching unloads old model without leak | Both | ☐ |
| 12 | All download errors show user-friendly messages | Both | ☐ |

---

## Blockers & Risks

| Risk | Impact | Platform | Mitigation |
|------|--------|----------|------------|
| Wi-Fi / network detection requires Android native code | Medium | Android | Minimal Tauri plugin or JNI — budget 1 day |
| Foreground service requires Play Store policy compliance | Medium | Android | Sideload first; defer Play Store compliance |
| `fs2` free-space returns 0 on some Android filesystem mounts | Low | Android | `StatFs` fallback |
| Desktop wizard accidentally broken by mobile wizard changes | **High** | Desktop | Explicit regression tests; mobile wizard is presentation-only changes |
| `sys-info` RAM detection inaccurate on Android (reports virtual) | Low | Android | Cap at device total RAM from system properties as fallback |

---

## Success Criteria

### Desktop (must not regress)
- [ ] Existing wizard flow unchanged — same steps, same layout
- [ ] Model download works with progress, pause/resume
- [ ] Model switching works without memory leaks

### Android (net new)
- [ ] First-run wizard completes cleanly on 6.3" phone
- [ ] Model download succeeds over Wi-Fi with clean progress UI
- [ ] Mobile data warning fires and respects Wi-Fi-only toggle
- [ ] Download resumes after app kill
- [ ] Storage check fires before download if space is insufficient

### Both
- [ ] RAM-based model recommendation is shown and accurate
- [ ] All error states show user-friendly messages
- [ ] "Balanced" model (1 GB) downloads in ≤10 min on 50 Mbps connection

---

## Exit Criteria

M5 is **complete** when:
1. Desktop first-run wizard + download — zero regression confirmed
2. Android clean install → wizard → download → ready state works end-to-end
3. Download resilience tested: background + kill + resume on both platforms
4. Network and storage edge cases handled gracefully on Android
5. Team reviews first-run flow on a real Android device AND on desktop
