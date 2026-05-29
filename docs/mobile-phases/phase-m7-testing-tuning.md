# Phase 6.7 (M7): Beta Testing & Performance Tuning

> **Goal:** Ship a stable beta APK, gather real-world feedback, and optimize performance for the 80% use case.
> **Depends on:** M1–M6 (all previous phases integrated)

---

## Scope

This is the stabilization phase. Everything should be working end-to-end. Now we:
1. Fix the inevitable bugs found on real devices
2. Performance-tune the critical paths
3. Gather beta tester feedback
4. Decide on release readiness

## Tasks

### 1. End-to-End Integration Test (Manual)
Run the full flow on a physical device and document results:

| Test Case | Expected | Actual |
|-----------|----------|--------|
| Fresh install → wizard → download model | ≤ 1 tap per step, clear progress | ☐ |
| Open PDF from Downloads folder | Parses correctly in ≤ 5 seconds | ☐ |
| Open PDF from Google Drive (content URI) | Copies, parses correctly | ☐ |
| Share PDF from WhatsApp → ZoloRAG | App opens, auto-loads PDF | ☐ |
| Ask a question about loaded PDF | Generates answer with source citations | ☐ |
| Ask a follow-up question | Context is maintained | ☐ |
| Ask about something NOT in the PDF | Model says "not found in document" | ☐ |
| Switch apps mid-generation, come back | Generation still continues | ☐ |
| Kill app, reopen, load same PDF | App recovers gracefully | ☐ |
| Try to open a password-protected PDF | Shows error message | ☐ |
| Try to open a corrupt PDF | Shows error message | ☐ |
| Run on low-storage device (<2 GB free) | Shows storage warning | ☐ |
| Run on 6 GB RAM device (Pixel 7) | No OOM, smooth operation | ☐ |
| Run on 4 GB RAM device (Galaxy A14) | Graceful degradation or clear "unsupported" msg | ☐ |
| Rotate device during chat | Layout adapts, no crash | ☐ |
| Dark mode on device | All text readable | ☐ |
| Download over mobile data | Shows warning dialog | ☐ |

### 2. Performance Benchmarking

#### LLM Inference Speed
- [ ] Measure generation speed (tok/s) on 3+ physical devices across tiers:
  - Pixel 7 (Tensor G2, 8 GB)
  - Galaxy S24 (Snapdragon 8 Gen 3, 8 GB)
  - Galaxy A54 (Exynos 1380, 6 GB)
  - Pixel Tablet (Tensor G2, 8 GB)
- [ ] Test with Qwen2.5-0.5B, Qwen2.5-1.5B, Llama 3.2-3B
- [ ] Test at different context lengths: 512, 1024, 2048 tokens
- [ ] Report mean and P95 tok/s for each combination

#### PDF Parsing
- [ ] Measure time to parse + chunk for: 10 pg, 50 pg, 300 pg PDFs
- [ ] Compare against desktop for parity

#### App Launch Time
- [ ] Cold start → WebView visible
- [ ] Cold start → model loaded and ready (if model already downloaded)
- [ ] Warm start (app in background) → ready

#### Memory Usage
- [ ] Peak RSS with no model loaded
- [ ] Peak RSS with model loaded, idle
- [ ] Peak RSS during generation
- [ ] Peak RSS with large PDF + long chat history (100+ messages)

### 3. Known Issues & Bug Fixes
- [ ] Create a shared bug tracker (GitHub Issues)
- [ ] Tag bugs by area: UI, ML, File handling, Build
- [ ] Prioritize:
  - **P0**: App crashes, ANR, data loss, can't open PDF
  - **P1**: Generation broken, incorrect answers, major UI breakage
  - **P2**: Performance issues, minor UI glitches
  - **P3**: Polish, animations, edge cases

### 4. Battery & Thermal Testing
- [ ] Measure battery drain: 10 minutes of continuous chat
- [ ] Note device temperature after 10 min chat (warm? hot? throttling?)
- [ ] Compare against baseline (phone idle battery draw)
- [ ] Document findings for release notes

### 5. Beta Distribution Setup
- [ ] Set up a TestFlight-like distribution:
  - Option A: GitHub Releases with APK download (simplest)
  - Option B: Firebase App Distribution
  - Option C: Google Play Internal Testing Track (requires Play Console account)
- [ ] Create a `#beta` channel or group for feedback collection
- [ ] Write a beta tester onboarding doc:
  - How to install (enable "Install from unknown sources")
  - How to report bugs (screenshots + device info)
  - Known limitations
  - What's being tested

### 6. Performance Optimization (As Needed)
Based on benchmark data, decide which optimizations to pursue:

| Optimization | Impact | Decision |
|-------------|--------|----------|
| Vulkan GPU offload for LLM | 2-3x tok/s on flagship | ⏸ Post-MVP |
| Smaller default model (0.5B) | Faster, less accurate | ☐ Decide |
| Model quantization (Q3_K_M) | 25% smaller, minimal quality loss | ☐ Try |
| PDF text extraction caching | Faster re-parse of same PDF | ☐ If needed |
| Trim old chat history to save RAM | Memory savings | ☐ If needed |
| Lazy model loading (deferred init) | Faster app startup | ☐ If needed |

### 7. Release Readiness Decision
After beta feedback, decide:

- **Go**: Ship as v1.0.0-android — stable, usable, meets success criteria
- **Iterate**: Fix critical bugs found in beta, then re-evaluate
- **Hold**: Feasibility blocker found (e.g., memory issues on 6 GB devices)

---

## Feasibility Checklist (Blocker Detection)

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 1 | End-to-end flow works on Pixel 7 (8 GB reference device) | ☐ | |
| 2 | End-to-end flow works on Galaxy A54 (6 GB budget device) | ☐ | If fails, adjust min specs |
| 3 | Generation speed ≥3 tok/s on reference device (Qwen2.5-1.5B) | ☐ | |
| 4 | App doesn't crash after 30 minutes of usage | ☐ | |
| 5 | No ANR during any operation | ☐ | |
| 6 | Battery drain ≤ 15% per 10 min of continuous chat | ☐ | |
| 7 | Device doesn't overheat (no throttling) during normal use | ☐ | |
| 8 | PDFs of 300+ pages are parsed without timeout | ☐ | |
| 9 | Sharing PDFs from 3 different apps (Files, Google Drive, WhatsApp) works | ☐ | |
| 10 | Beta testers can install and report bugs without confusion | ☐ | |

## Blockers & Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Memory crash on 6 GB devices during LLM inference | **High** | Default to 0.5B model for 6 GB; detect RAM and recommend model |
| Thermal throttling after 5 minutes of chat | Medium | Show "device warming" indicator; auto-pause after N minutes |
| PDF parsing fails on obscure PDFs | Medium | Catch errors, show "unsupported PDF format" with fallback to lopdf |
| Beta testers don't report bugs | Low | Keep group small (5-10) and engaged; offer incentive |
| Google Play doesn't approve (if submitting) | Medium | Start with sideload APK; defer Play Store |

## Success Criteria

- [ ] App runs stably on Pixel 7 (8 GB) and Galaxy A54 (6 GB)
- [ ] Generation speed ≥3 tok/s on reference device
- [ ] No P0 or P1 bugs outstanding
- [ ] Battery drain acceptable (≤ 15% per 10 min chat)
- [ ] At least 5 beta testers have installed and used the app for 1+ hour
- [ ] Performance benchmarks documented and acceptable to the team

## Exit Criteria

M7 is **complete** and Phase 6 is **done** when:
1. All test cases in the integration test matrix pass on at least 2 physical devices
2. Performance benchmarks meet minimum thresholds
3. No known P0/P1 bugs
4. Beta feedback has been reviewed and critical issues resolved
5. A signed release APK is published (as a GitHub Release)
6. `README.md` is updated with Android build/install instructions
7. The team declares the MVP ready
