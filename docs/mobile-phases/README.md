# ZoloRAG Mobile — Phase 6 Sub-Phases

This directory breaks **Phase 6 (Android Mobile)** from the main plan into 7 checkpointable sub-phases. Each phase has a concrete feasibility checklist for early blocker detection.

## Phase Overview

```
M1 ──→ M2 ──→ M3 ──→ M5 ──→ M6 ──→ M7
  │              │       ↑       │
  │              └──→ M4 ────────┘
  │                              │
  └──────────────────────────────┘ (all flow into testing)
```

| Phase | Name | Dependencies | Risk Level |
|-------|------|--------------|:----------:|
| [M1](phase-m1-toolchain.md) | Toolchain Setup | None (foundation) | Medium |
| [M2](phase-m2-core-ml.md) | Core ML Cross-Compilation | M1 | **High** |
| [M3](phase-m3-file-handling.md) | Android File Handling | M1 | Medium |
| [M4](phase-m4-ui-redesign.md) | Mobile UI Redesign | None (parallel with M2/M3) | Medium |
| [M5](phase-m5-setup-download.md) | Setup Wizard & Model Download | M2, M4 | Medium |
| [M6](phase-m6-ci-pipeline.md) | CI Pipeline & Distribution | M1, M2 | Medium |
| [M7](phase-m7-testing-tuning.md) | Beta Testing & Tuning | All previous | Low |

## High-Risk Decision Points

These are the moments where we might discover a blocker that kills the project:

1. **End of M2**: If llama.cpp won't cross-compile or if tok/s is below 2 on a real device, we need a fundamental re-think (smaller model, GPU offload, or abandon mobile).
2. **End of M3**: If Tauri's intent API doesn't support the PDF share pattern, the mobile UX will be significantly worse.
3. **End of M4**: If WebView keyboard handling is unfixable on Android, the chat UX will be broken.
4. **End of M7**: If 6 GB devices can't run the app without crashes, we must either (a) drop support, (b) use 0.5B model, or (c) add aggressive memory management.

## How to Use These Phases

1. **Start with M1** — everything depends on the toolchain
2. **Parallelize M2 and M4** (separate concerns: ML vs Frontend)
3. **After each phase**, review the feasibility checklist with the team
4. **If any checklist item is ❌**, stop and decide: fix, work around, or abort
5. **After M7**, you have a production Android MVP

## Feasibility Checklist Convention

Each phase uses this pattern:

```
| # | Check | Status | Notes |
|---|-------|--------|-------|
| 1 | Check description | ☐ | Why it matters |
```

- **☐** = Not yet verified
- **✅** = Verified, no issue
- **❌** = Blocked, needs discussion
- **⚠️** = Verified with caveat (document in Notes)
