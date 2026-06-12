# ZoloRAG — Phase 6 Sub-Phases: Desktop + Mobile

This directory breaks **Phase 6** from the main plan into 7 checkpointable sub-phases. Each phase has a concrete feasibility checklist for early blocker detection.

## ⚠️ Cross-Platform Principle

ZoloRAG runs on **both desktop and Android**. These phases add Android support — they do not migrate away from desktop. The rule is:

> **Every phase must leave desktop working. Android features are additive. Nothing is removed or "replaced" unless it's explicitly non-functional on desktop.**

Android-specific code is always gated behind `#[cfg(target_os = "android")]` (Rust) or `{!isMobile && ...}` (frontend).

---

## Phase Overview

```
M1 ──→ M2 ──→ M3 ──→ M5 ──→ M6 ──→ M7
  │              │       ↑       │
  │              └──→ M4 ────────┘
  │                              │
  └──────────────────────────────┘ (all flow into testing)
```

| Phase | Name | Scope | Dependencies | Status |
|-------|------|-------|--------------|--------|
| [M1](phase-m1-toolchain.md) | Toolchain Setup | Android toolchain, NDK, emulator | None | ✅ Complete |
| [M2](phase-m2-core-ml.md) | Core ML Cross-Compilation | candle + llama.cpp on Android | M1 | 🟡 Core done, dev workflow deferred |
| [M3](phase-m3-file-handling.md) | Cross-Platform File Handling | Android picker + intent; desktop DropZone kept | M1 | ☐ |
| [M4](phase-m4-ui-redesign.md) | Responsive UI | Desktop + mobile layouts; DropZone kept on desktop | None | ☐ |
| [M5](phase-m5-setup-download.md) | Setup Wizard & Download | Android-specific: Wi-Fi check, wake lock; desktop unchanged | M2, M4 | ☐ |
| [M6](phase-m6-ci-pipeline.md) | CI/CD Pipeline | Desktop (.dmg/.exe) + Android (APK) artifacts | M1, M2 | ☐ |
| [M7](phase-m7-testing-tuning.md) | Beta Testing & Tuning | Both platforms tested; both in GitHub Release | All | ☐ |

---

## What Each Platform Gets

| Feature | Desktop | Android |
|---------|---------|---------|
| PDF drag-and-drop (DropZone) | ✅ Primary input | Hidden (no drag on touch) |
| PDF file dialog button | ✅ Secondary input | ✅ Primary input |
| PDF Share/Open-with intent | ❌ N/A | ✅ Via AndroidManifest |
| Content URI → local path copy | ❌ N/A (real path) | ✅ ContentResolver |
| Wi-Fi-only download toggle | ❌ N/A | ✅ |
| Wake lock during download | ❌ N/A | ✅ Foreground service |
| CI artifact | `.dmg` / `.exe` / `.AppImage` | Signed `.apk` |

---

## High-Risk Decision Points

1. **End of M2**: If tok/s is below 2 on a real device, need re-think (smaller model, GPU, or abandon mobile)
2. **End of M3**: If Tauri's intent API doesn't support PDF share, mobile UX will be significantly worse
3. **End of M4**: If WebView keyboard handling is unfixable, chat UX is broken on mobile
4. **End of M7**: If 6 GB Android devices crash, must choose: drop support / use 0.5B model / aggressive memory management

---

## Feasibility Checklist Convention

Each phase uses:

```
| # | Check | Platform | Status | Notes |
|---|-------|----------|--------|-------|
| 1 | Check description | Desktop / Android / Both | ☐ | Why it matters |
```

- **☐** = Not yet verified
- **✅** = Verified, no issue
- **❌** = Blocked / failed — needs discussion
- **🟡** = Partially done or deferred
- **⚠️** = Verified with caveat (documented in Notes)
