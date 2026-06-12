# Phase 6.7 (M7): Beta Testing & Performance Tuning — Desktop + Mobile

> **Goal:** Ship a stable beta for both desktop and Android. Gather real-world feedback. Fix critical bugs. Document performance baselines for both platforms.
> **Depends on:** M1–M6 (all previous phases integrated)

---

## ⚠️ Cross-Platform Constraint

Beta is not Android-only. Both platforms must be tested and must have releasable artifacts.

| Concern | Desktop | Android |
|---------|---------|---------|
| Integration test matrix | ✅ Full pass required | ✅ Full pass required |
| Performance benchmarks | ✅ Baseline docs | ✅ tok/s target ≥3 |
| Beta distribution | `.dmg` / `.exe` / `.AppImage` | `.apk` sideload |
| P0 bug bar | Same — app must not crash | Same |
| Release artifact | ✅ GitHub Release | ✅ GitHub Release |

---

## Scope

End-to-end stabilization across both platforms. Fix inevitable bugs, document performance baselines, gather beta feedback, decide on release readiness.

---

## Tasks

### 1. End-to-End Integration Test Matrix

Run on: macOS desktop + Pixel 7 (8 GB) minimum. Document results per platform.

| Test Case | Desktop | Android |
|-----------|---------|---------|
| Fresh install → wizard → download model | ☐ | ☐ |
| Open PDF from file system | ☐ | ☐ (file picker) |
| Open PDF from Google Drive / cloud | ☐ N/A (native path) | ☐ (content URI) |
| Share PDF from another app → ZoloRAG | ☐ N/A | ☐ (intent) |
| Ask a question about loaded PDF | ☐ | ☐ |
| Ask a follow-up (context maintained) | ☐ | ☐ |
| Ask about something NOT in PDF | ☐ | ☐ |
| Switch apps mid-generation, come back | ☐ N/A | ☐ |
| Kill app, reopen, load same PDF | ☐ | ☐ |
| Password-protected PDF → error | ☐ | ☐ |
| Corrupt PDF → error | ☐ | ☐ |
| Low storage warning (<2 GB free) | ☐ | ☐ |
| DropZone drag-and-drop works | ☐ | N/A |
| Dark mode — all text readable | ☐ | ☐ |
| Large PDF (300+ pages) — no timeout | ☐ | ☐ |
| Window resize / device rotation | ☐ | ☐ |
| Download over mobile data → warning | N/A | ☐ |
| Run on low-RAM device (6 GB) | N/A | ☐ |

### 2. Performance Benchmarking

#### LLM Inference Speed — Android Devices
Measure tok/s on physical devices. Target: ≥3 tok/s on reference device (Pixel 7).

| Device | RAM | Qwen2.5-0.5B | Qwen2.5-1.5B | Llama 3.2-3B |
|--------|-----|-------------|-------------|-------------|
| Pixel 7 (Tensor G2) | 8 GB | ☐ | ☐ | ☐ |
| Galaxy S24 (SD 8 Gen 3) | 8 GB | ☐ | ☐ | ☐ |
| Galaxy A54 (Exynos 1380) | 6 GB | ☐ | ☐ | ☐ |

#### LLM Inference Speed — Desktop
Document baseline (not a gating criterion, but tracked).

| Machine | RAM | Qwen2.5-1.5B | Llama 3.2-3B |
|---------|-----|-------------|-------------|
| MacBook Pro M-series | 16+ GB | ☐ | ☐ |
| MacBook Air M-series | 8 GB | ☐ | ☐ |
| Windows (Intel/AMD) | 16 GB | ☐ | ☐ |

#### PDF Parsing Speed (Both Platforms)
| PDF Size | Desktop | Android |
|----------|---------|---------|
| 10 pages | ☐ | ☐ |
| 50 pages | ☐ | ☐ |
| 300 pages | ☐ | ☐ |

#### App Launch Time
| Scenario | Desktop | Android |
|----------|---------|---------|
| Cold start → WebView visible | ☐ | ☐ |
| Cold start → model ready (already downloaded) | ☐ | ☐ |
| Warm start (app in background) | N/A | ☐ |

#### Memory Usage (Both Platforms)
| State | Desktop | Android |
|-------|---------|---------|
| App idle, no model | ☐ | ☐ |
| Model loaded, idle | ☐ | ☐ |
| During generation | ☐ | ☐ |
| Large PDF + 100 messages | ☐ | ☐ |

### 3. Bug Tracking

- [ ] Create GitHub Issues with labels: `platform:desktop`, `platform:android`, `area:ml`, `area:ui`, `area:files`, `area:build`
- [ ] Priority ladder:
  - **P0**: Crash, ANR, data loss, can't open any PDF, generation broken
  - **P1**: Wrong answers, major UI breakage, install fails
  - **P2**: Performance issues, minor UI glitches, intermittent failures
  - **P3**: Polish, animations, edge cases
- [ ] Ship criteria: zero open P0s, zero open P1s on both platforms

### 4. Battery & Thermal Testing (Android)

- [ ] Measure battery drain: 10 minutes of continuous chat on Pixel 7
- [ ] Device temperature after 10 min (warm / hot / throttling?)
- [ ] Compare against idle baseline
- [ ] Document findings — include in release notes if notable
- [ ] **Desktop**: no battery test (plugged in during typical use)

### 5. Beta Distribution

#### Android
- [ ] **Primary**: GitHub Releases — APK download, sideload
  - Instructions: "Settings → Security → Install unknown apps"
- [ ] **Optional**: Firebase App Distribution (if group is >10 testers)
- [ ] **Deferred**: Google Play Internal Testing Track (requires Play Console account)

#### Desktop
- [ ] **Primary**: GitHub Releases — `.dmg` (macOS), `.exe` installer (Windows), `.AppImage` (Linux)
- [ ] No code signing required for internal beta (Gatekeeper warning acceptable with right-click → Open)
- [ ] Notarization deferred to public release

#### Both
- [ ] Create a beta tester onboarding doc:
  - Install instructions per platform
  - How to report bugs (screenshots + platform + device/OS info)
  - Known limitations and what's being tested
- [ ] Set up a `#beta` channel for feedback

### 6. Performance Optimizations (As Needed)

After benchmark data, decide per optimization:

| Optimization | Impact | Platform | Decision |
|-------------|--------|----------|---------|
| Vulkan GPU offload for LLM | 2–3× tok/s | Android flagship | ⏸ Post-MVP |
| CoreML / Metal acceleration | 5–10× tok/s | macOS Apple Silicon | ⏸ Post-MVP |
| Smaller default model (0.5B) | Faster, less accurate | Both | ☐ Decide after benchmarks |
| Q3_K_M quantization | 25% smaller, minimal quality loss | Both | ☐ Try |
| PDF text extraction caching | Faster re-parse | Both | ☐ If needed |
| Trim old chat history | RAM savings | Both | ☐ If needed |
| Lazy model loading | Faster startup | Both | ☐ If needed |

### 7. Release Readiness Decision

After beta, decide:
- **Go**: Ship v1.0.0 — stable on both platforms, meets all success criteria
- **Iterate**: Fix critical bugs found in beta, re-evaluate in 1 week
- **Hold**: Feasibility blocker found (e.g., memory crash on 6 GB Android devices)

---

## Feasibility Checklist

| # | Check | Platform | Status |
|---|-------|----------|--------|
| 1 | Full integration test matrix passes on macOS | Desktop | ☐ |
| 2 | Full integration test matrix passes on Pixel 7 | Android | ☐ |
| 3 | Generation speed ≥3 tok/s on Pixel 7 (Qwen2.5-1.5B) | Android | ☐ |
| 4 | No crash after 30 minutes of usage | Both | ☐ |
| 5 | No ANR during any operation | Android | ☐ |
| 6 | Battery drain ≤15% per 10 min of continuous chat | Android | ☐ |
| 7 | No thermal throttling during normal use | Android | ☐ |
| 8 | PDFs of 300+ pages parsed without timeout | Both | ☐ |
| 9 | Share from 3 apps (Files, Google Drive, WhatsApp) | Android | ☐ |
| 10 | DropZone drag-and-drop works after all M4 changes | Desktop | ☐ |
| 11 | Beta testers can install without help | Both | ☐ |

---

## Blockers & Risks

| Risk | Impact | Platform | Mitigation |
|------|--------|----------|------------|
| Memory crash on 6 GB Android devices | **High** | Android | Default to 0.5B for ≤6 GB; detect RAM and gate model selection |
| Thermal throttling after 5 min chat | Medium | Android | Show "device warming" indicator; auto-pause after N minutes |
| PDF parsing fails on obscure PDFs | Medium | Both | Catch errors; fallback to `lopdf`; show "unsupported format" |
| Desktop regression discovered late (M4/M5 changes) | **High** | Desktop | Integration test matrix on desktop is mandatory, not optional |
| Beta testers don't report bugs | Low | Both | Keep group small (5–10 per platform); structured feedback form |

---

## Success Criteria

### Desktop
- [ ] Full integration test matrix passes
- [ ] DropZone and file dialog both work
- [ ] No P0/P1 bugs
- [ ] `.dmg` / `.exe` installable by a non-developer

### Android
- [ ] Full integration test matrix passes on Pixel 7 + one budget device (6 GB)
- [ ] Generation speed ≥3 tok/s on reference device
- [ ] No P0/P1 bugs
- [ ] Battery drain acceptable (≤15% per 10 min)
- [ ] At least 5 beta testers used the app for 1+ hour

### Both
- [ ] Performance benchmarks documented
- [ ] Beta feedback reviewed — critical issues resolved

---

## Exit Criteria

Phase 6 (all of M1–M7) is **done** when:
1. Integration test matrix passes on macOS desktop **and** Pixel 7
2. Performance benchmarks meet minimums on both platforms
3. Zero P0/P1 bugs on both platforms
4. Beta feedback reviewed and critical issues resolved
5. GitHub Release published with: signed APK, macOS .dmg, Windows .exe
6. `README.md` updated with install instructions for all platforms
7. Team declares MVP ready on both platforms
