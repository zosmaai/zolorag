# Phase 6: Android Mobile

> **Status:** Planned
> **Scope:** Port the existing ZoloRAG desktop app (Tauri 2 + Rust + candle + llama.cpp) to run as a native Android app.
> **Context:** The core ML stack (candle + llama.cpp) already cross-compiles for `aarch64-linux-android`, and Tauri 2 provides native Android WebView support. This document is the implementation plan.

---

## Table of Contents

- [Executive Summary](#executive-summary)
- [Project Overview - What We've Built](#project-overview--what-weve-built)
- [Tauri Mobile - Platform Support](#tauri-mobile--platform-support)
- [Anatomy of a Tauri Android App](#anatomy-of-a-tauri-android-app)
- [Feasibility by Component](#feasibility-by-component)
  - [1. Tauri Shell + Frontend](#1-tauri-shell--frontend)
  - [2. PDF Parsing & Chunking](#2-pdf-parsing--chunking)
  - [3. Embedding Model (candle)](#3-embedding-model-candle)
  - [4. LLM Inference (llama.cpp)](#4-llm-inference-llamacpp)
  - [5. Model Download Manager](#5-model-download-manager)
  - [6. Index Persistence (bincode)](#6-index-persistence-bincode)
  - [7. Chat History & Source Citations](#7-chat-history--source-citations)
- [Key Challenges](#key-challenges)
- [Architecture Changes Required](#architecture-changes-required)
- [Build & CI Changes](#build--ci-changes)
- [Success Criteria](#success-criteria)
- [Implementation Order](#implementation-order-sub-phases)
- [Estimated Effort](#estimated-effort)
- [Conclusion](#conclusion)

---

## Executive Summary

| Question | Answer |
|----------|--------|
| **Can it be done?** | Yes - technically feasible, but requires significant rework in three areas: UI responsiveness, PDF file handling, and build toolchain. |
| **Core ML (candle + llama.cpp)?** | Likely feasible. Both have been compiled for Android targets (aarch64-linux-android). llama.cpp has existing Android production deployments. |
| **What's the hardest part?** | The frontend UI was designed for a 1100×750 desktop window. A mobile-native experience requires a ground-up UX redesign, not just responsive CSS. |
| **Estimated effort?** | **8–12 weeks** for a production-quality MVP on Android, assuming one full-time Rust + Android developer. |

---

## Project Overview - What We've Built

ZoloRAG is a fully self-contained desktop application with this architecture:

```
┌──────────────────────────────────────────────────────────────┐
│                    ZoloRAG (Single Process)                   │
│                                                              │
│  ┌──────────────────┐  ┌──────────────────────────────────┐  │
│  │  Next.js Frontend │  │  Rust Backend                    │  │
│  │  (Tailwind CSS,   │  │                                  │  │
│  │   TypeScript)     │  │  ┌────────────┬───────────────┐  │  │
│  │                   │  │  │  candle     │  llama.cpp    │  │  │
│  │  ┌──────────────┐ │  │  │  (embed)    │  (LLM)       │  │  │
│  │  │ SetupPanel   │ │  │  └────────────┴───────────────┘  │  │
│  │  │ ChatInput    │ │  │  ┌────────────┬───────────────┐  │  │
│  │  │ ChatMessages │ │  │  │ pdf-extract│  BitIndex     │  │  │
│  │  │ SourcePanel  │ │  │  │ lopdf      │  (bincode)    │  │  │
│  │  └──────────────┘ │  │  └────────────┴───────────────┘  │  │
│  └──────────────────┘  └──────────────────────────────────┘  │
│                                                              │
│  Single binary. No Python. No Ollama. No external services.   │
└──────────────────────────────────────────────────────────────┘
```

### Completed Phases (Desktop)

| Phase | What | Key Rust Crates |
|-------|------|-----------------|
| 1 | PDF extraction + chunking | `pdf-extract`, `lopdf`, `unicode-segmentation` |
| 2 | Semantic search (hybrid Hamming + cosine + keyword) | `bincode` |
| 3 | RAG generation with streaming + source citations | `reqwest` (was Ollama, now removed) |
| 4 | In-process embeddings via `candle` | `candle-core`, `candle-nn`, `candle-transformers`, `tokenizers` |
| 5 | In-process LLM via `llama.cpp` | `llama-cpp-2` (llama.cpp Rust bindings) |

---

## Tauri Mobile - Platform Support

Tauri 2 supports building for **Android** (and iOS) as first-class targets.

### What Tauri Provides on Mobile

| Feature | Desktop | Android |
|---------|---------|---------|
| Rust backend via Tauri commands | ✅ | ✅ (via JNI bridge) |
| WebView frontend (Next.js) | ✅ | ✅ (Android System WebView) |
| File system access | ✅ (native paths) | ⚠️ Scoped storage / SAF |
| Drag-and-drop | ✅ (Tauri event) | ❌ (not a mobile pattern) |
| Native file dialogs | ✅ (`tauri-plugin-dialog`) | ✅ (Android file picker) |
| System tray | ✅ | ❌ |
| Window management | ✅ | ❌ (single full-screen activity) |
| Keyboard shortcuts | ✅ | ❌ (software keyboard) |
| Touch events | ❌ (mouse-only) | ✅ (touch support via WebView) |

### Target Architecture

```
Desktop:  x86_64-unknown-linux-gnu, x86_64-pc-windows-msvc,
          aarch64-apple-darwin, x86_64-apple-darwin

Android:  aarch64-linux-android (arm64-v8a)
          armv7-linux-androideabi (armeabi-v7a)
          x86_64-linux-android (emulator)
```

**Primary target:** `aarch64-linux-android` (99% of modern Android devices).

---

## Anatomy of a Tauri Android App

A Tauri Android app is structured as:

```
src-tauri/
├── src/                          # Rust code (shared with desktop)
├── Cargo.toml
├── tauri.conf.json               # Shared config
├── capabilities/                 # Permissions
├── gen/
│   └── android/                  # Generated Android project
│       ├── app/src/main/
│       │   ├── java/..           # Kotlin glue (Tauri plugin bindings)
│       │   ├── AndroidManifest.xml
│       │   └── res/              # Android resources
│       ├── build.gradle.kts
│       └── settings.gradle.kts
└── icons/
```

The Rust code compiles as a shared library (`.so`) loaded by the Android app. Tauri's mobile layer handles:
- WebView initialization
- Tauri command IPC (bridge between JavaScript and Rust)
- Plugin initialization
- App lifecycle events

**Key constraint:** The Rust code runs on the Android main thread by default. Heavy computation (LLM inference) must be offloaded to a background thread or the app will ANR (Application Not Responding).

---

## Feasibility by Component

### 1. Tauri Shell + Frontend

**Desktop:** Next.js 16 + Tailwind CSS → static export → Tauri WebView.

**Mobile:** Same static export can serve as the Android WebView content.

#### What Just Works
- Tailwind CSS utility classes → responsive breakpoints (`sm:`, `md:`, `lg:`) can adapt layouts
- Next.js static export produces HTML/JS/CSS that works in Android WebView
- Tauri commands (`invoke()`) work identically on Android - the IPC bridge is transparent
- Tauri events (`listen()`, `emit()`) work identically

#### What Needs to Change

| Aspect | Desktop | Mobile | Effort |
|--------|---------|--------|--------|
| **Layout** | Fixed wide window (1100×750) | Variable portrait (360-450dp width) | **High** - ground-up responsive redesign |
| **Input** | Keyboard + mouse | Touch + software keyboard | Medium - form factor adaptation |
| **DropZone** | Drag-and-drop a PDF file | Share sheet / file picker intent | **High** - entirely different interaction |
| **SourcePanel** | Slide-out from right | Bottom sheet / modal | Medium |
| **SetupPanel** | Centered card, wide | Full-screen wizard, scrollable | Low |
| **ChatMessages** | Scrollable list | Scrollable list (works) | Low |
| **ChatInput** | Text field + button | Text field + send (works) | Low |
| **Navigation** | Single page, no routing | Single page (works on mobile) | None |

**The biggest change is the DropZone.** On mobile, users don't "drop" PDFs. Instead:
- A "Open PDF" button triggers the Android file picker (via `tauri-plugin-dialog`)
- Or the app registers as a PDF viewer/handler via Android's `Intent` system (manifest intent-filter)
- Or both

**Verdict:** Feasible. The Tauri shell handles the hard part (Rust ↔ JS bridge). Most of the effort is in responsive CSS and interaction redesign.

---

### 2. PDF Parsing & Chunking

**Desktop:** `pdf-extract` + `lopdf` - pure Rust crates, no system dependencies.

**On Android:** Pure Rust crates can be cross-compiled for `aarch64-linux-android` with no issues. Both crates use only `std` and Rust-native dependencies.

| Sub-component | Android Feasibility | Notes |
|---------------|--------------------|-------|
| `pdf-extract` (text extraction) | ✅ Feasible | Pure Rust, no FFI |
| `lopdf` (hidden layer fallback) | ✅ Feasible | Pure Rust, no FFI |
| Chunking (`unicode-segmentation`) | ✅ Feasible | Pure Rust |
| File I/O | ⚠️ Needs SAF integration | See below |

#### The Android File Access Problem

Desktop Rust code accesses files via `PathBuf` - a native filesystem path. On Android, files are accessed through **content URIs** (`content://...`) or **scoped storage** (app-private directory).

**What works:**
- PDFs in the app's private storage (`Context.getFilesDir()` → mapped to a path)
- PDFs downloaded to the app's cache directory

**What's harder:**
- PDFs shared from other apps (WhatsApp, email, Google Drive) arrive as content URIs
- Content URIs can't be opened with `std::fs::File` directly - need to copy to app storage first

**Solution:** Tauri's Rust side can access the Android `Context` through Tauri's mobile API. The `load_pdf` command would:
1. Accept either a file path or content URI string
2. If content URI, copy the file to app-private storage via Android's `ContentResolver`
3. Then parse via `pdf-extract`/`lopdf` as usual

**Verdict:** Feasible - requires ~1 day of Android file I/O plumbing.

---

### 3. Embedding Model (candle)

**Desktop:** `candle-core` + `candle-nn` + `candle-transformers` + `tokenizers` → BERT forward pass on CPU.

**On Android:**

| Concern | Assessment |
|---------|------------|
| **Compilation** | ✅ `candle` is pure Rust with `std` feature. Cross-compiles for `aarch64-linux-android`. |
| **Performance** | ✅ all-MiniLM-L6-v2 is tiny (22M params, 384-dim). Inference takes ~30-50ms on a modern phone CPU. |
| **Model format** | ✅ Uses safetensors/GGUF format. Same file, same code. |
| **Memory** | ✅ Model is ~85 MB. Phones have 6-12 GB RAM. No issue. |
| **Device support** | ⚠️ Candle's CUDA/Metal backends don't apply on Android. CPU-only is fine - the model is small. |

**Potential issue:** `tokenizers` crate uses a `tokenizer.json` file loaded at runtime. This is fine - same as desktop.

**Verdict:** ✅ Low risk. This is the easiest component to port.

---

### 4. LLM Inference (llama.cpp)

**Desktop:** `llama-cpp-2` crate → compiles llama.cpp C++ source → Rust FFI bindings → GGUF model.

**On Android:**

| Concern | Assessment |
|---------|------------|
| **llama.cpp on Android** | ✅ Well-established. Many Android apps use llama.cpp (Termux, MLCEngine, LLM Farm, LocalAI). |
| **Rust FFI bindings** | ⚠️ `llama-cpp-2` needs the llama.cpp shared library compiled for `aarch64-linux-android`. This requires Android NDK + CMake. |
| **GGUF model** | ✅ Same GGUF file works on Android. Llama 3.2-3B Q4_K_M (~1.8 GB) fits on modern phones (64-256 GB storage). |
| **Performance** | ⚠️ CPU-only on most Android devices. Llama 3.2-3B Q4_K_M on a modern phone CPU (Cortex-X4/A720) averages **3-6 tok/s** - usable but slow. |
| **GPU acceleration** | ✅ llama.cpp supports Vulkan for GPU offload. Many flagship phones have Vulkan-capable GPUs (Adreno 7xx, Mali-G7xx). Could reach **8-15 tok/s** with GPU. |
| **Memory** | ⚠️ Model weights: ~1.8 GB. Runtime memory: ~2.5 GB total. This is viable on 8+ GB phones but will cause swap/ANR on 6 GB devices. |
| **Thermals** | ⚠️ LLM inference is CPU-intensive. Extended chat sessions will heat the phone and throttle performance. |
| **Battery** | ⚠️ Significant drain. Estimated 5-10 minutes of chat uses 5-10% battery. |

#### Memory Constraints by Phone Tier

| Phone Tier | RAM | Llama 3.2-3B Q4_K_M | Suggested Model |
|------------|:---:|:--------------------:|-----------------|
| Flagship (2024+) | 12-16 GB | ✅ Runs well | Llama 3.2-3B |
| Mid-range (2023+) | 8 GB | ⚠️ Works, may swap | Llama 3.2-3B **or** Qwen2.5-1.5B |
| Budget (2022) | 4-6 GB | ❌ Will crash | Qwen2.5-1.5B (~1 GB) or TinyLlama (~0.7 GB) |

#### Background Thread Requirement

Desktop llama.cpp blocks the calling thread during generation. On Android, this **must** run on a background thread or the app will ANR after 5 seconds of UI freeze.

**Solution:** Wrap `LlamaCppEngine::generate()` in a `tokio::spawn_blocking()` or use a dedicated `std::thread`. The frontend already handles async streaming via events - no change needed on the JS side.

**Verdict:** ✅ Feasible with caveats. GPU acceleration via Vulkan would make this genuinely usable on flagship phones. CPU-only on mid-range phones is borderline.

---

### 5. Model Download Manager

**Desktop:** `reqwest` + HTTP Range requests → progress callbacks → Tauri events → frontend progress bars.

**On Android:**

| Aspect | Assessment |
|--------|------------|
| **HTTP downloads** | ✅ `reqwest` works on Android. Same code. |
| **Range requests** | ✅ HTTP Range headers work on Android. Pause/resume works. |
| **Progress events** | ✅ Tauri events work identically. |
| **Storage** | ⚠️ Must download to app-private storage, not external. Use `app.path().app_data_dir()` (Tauri's API handles this per-platform). |
| **Space check** | ✅ `std::fs::metadata` and `free_space` checks work. |
| **Background downloads** | ⚠️ Large downloads should survive app going to background. Need to hold a wake lock or use Android `DownloadManager`. |

**Concern:** ~1.9 GB download over mobile data is expensive. Must:
- Show clear size warning before starting
- Default to Wi-Fi only (option to allow mobile data)
- Check available storage before download (phones have less free space than PCs)

**Verdict:** ✅ Feasible - mostly the same code, plus some Android-specific storage handling.

---

### 6. Index Persistence (bincode)

**Desktop:** `BitIndex` + `TermIndex` serialized to a binary file via `bincode`.

**On Android:** `bincode` is pure Rust - works identically. Same serialize/deserialize code. Store the index in app-private directory via Tauri's `app.path().app_data_dir()`.

**Verdict:** ✅ Trivial.

---

### 7. Chat History & Source Citations

**Desktop:** In-memory `Vec<ChatMessage>`, not persisted across restarts.

**On Android:** Same code works. Source citations (page numbers) are data - no UI changes needed beyond the source panel being mobile-friendly.

**Verdict:** ✅ Trivial.

---

## Key Challenges

Ranked by difficulty:

### 🔴 Hard: Mobile-Native UI Redesign

The current frontend was designed for a 1100×750 desktop window:

```
┌──────────────────────────────────────────────────┐
│  🧠 ZoloRAG    [📄 doc1.pdf]    [🧠 Model Ready] │
├──────────────────────────────────────────────────┤
│  Chat Messages (wide, spacious)                   │
│  SourcePanel slides from right                    │
│  DropZone is a large centered area                │
│  Input bar at bottom                              │
└──────────────────────────────────────────────────┘
```

A mobile layout needs to rethink:

- **No persistent header** - title bar takes vertical space on mobile
- **DropZone** → "Open PDF" button + register as PDF viewer
- **SourcePanel** → bottom sheet or inline accordion
- **Setup wizard** → full-screen vertical flow
- **Model status** → compressed indicator (icon-only)
- **PDF loading** → needs loading states for network-shared files

**Effort estimate:** 2-3 weeks for a solid mobile-responsive design.

### 🟡 Medium: LLM Performance on Mobile

Llama 3.2-3B at Q4_K_M on CPU gives ~3-6 tok/s on modern phones. This is **usable** (comparable to slow human typing) but not smooth. Options:

1. **Accept CPU performance** - 3-6 tok/s, show "generating..." indicator
2. **Smaller model** - Qwen2.5-1.5B (~1 GB) gives 8-15 tok/s, good enough
3. **Vulkan GPU offload** - 8-15 tok/s on flagship GPUs, adds build complexity
4. **Speculative decoding** - draft model + target model, complex to implement

**Recommendation:** Ship with CPU-only + smaller default model (Qwen2.5-1.5B). Add Vulkan support as an optimization for flagship devices.

### 🟡 Medium: Build Toolchain

Building for Android requires:

```
1. Android NDK (r27+)
2. Rust targets: rustup target add aarch64-linux-android
3. cargo-ndk: cargo install cargo-ndk
4. Android SDK + build tools (via Android Studio)
5. Gradle + Tauri CLI (already have)
6. Java 17+ (for Gradle)
```

The CI pipeline (GitHub Actions) would need:
- An Android build runner with SDK + NDK preinstalled (`ubuntu-latest` with `setup-android` action)
- Cross-compilation of all Rust crates for `aarch64-linux-android`
- Cross-compilation of llama.cpp C++ for `aarch64-linux-android`
- APK packaging and signing

**llama.cpp compilation for Android** is the hardest part:
- Needs Android NDK's `aarch64-linux-android21-clang` as the C++ compiler
- llama.cpp build system uses CMake - must find the NDK toolchain
- `llama-cpp-2` crate's build script may need patches to detect Android

**Mitigation:** Pre-compile llama.cpp for Android using GitHub Actions CI, cache the `.so` as a CI artifact, and link it statically in the Rust build. Document this in `BUILDING.md`.

### 🟢 Easy: PDF File Handling on Android

- Copy content URI → app-private storage → parse as usual
- Register intent-filter for PDF MIME type
- Add "Open from..." button in the UI

---

## Architecture Changes Required

### New or Modified Files

```
src-tauri/
├── src/
│   ├── lib.rs                    # Add Android-specific command wrappers
│   ├── ml/
│   │   ├── llm.rs                # Add spawn_blocking for background generation
│   │   └── download.rs           # Add Android storage check + wake lock hint
│   ├── pdf/
│   │   └── extract.rs            # Add content-URI copy helper
│   └── mobile/
│       ├── mod.rs                # Android-specific utilities (new)
│       └── storage.rs            # SAF / content URI helpers (new)
├── Cargo.toml                    # No new deps needed
├── tauri.conf.json               # Add allowlist for Android plugins
├── capabilities/
│   └── default.json              # Add Android-specific permissions
└── gen/android/                  # Generated - Tauri handles this
    └── app/src/main/AndroidManifest.xml  # Add intent-filter for PDF MIME type

src/
├── app/
│   ├── page.tsx                  # Responsive layout (major refactor)
│   └── globals.css               # Mobile breakpoints + touch styles
├── components/
│   ├── DropZone.tsx              # → OpenPdfButton.tsx (touch + share sheet)
│   ├── SourcePanel.tsx           # → BottomSheet.tsx (slide-up instead of slide-in)
│   ├── ChatMessages.tsx          # Responsive (minor)
│   ├── ChatInput.tsx             # Responsive + keyboard-aware
│   └── SetupPanel.tsx            # Scrollable full-screen wizard
└── hooks/
    └── useTauriEvent.ts          # Unchanged
```

No changes needed to:
- `index/index.rs` (search logic)
- `index/manager.rs` (model status)
- `rag/context.rs` (prompt builder)
- `rag/chat.rs` (history)
- `src/types/index.ts` (shared types)

---

## Build & CI Changes

### Desktop → Android: What Changes

| Step | Desktop | Android |
|------|---------|---------|
| Rust target | Native host target | `aarch64-linux-android` |
| C++ compiler | System clang/gcc/msvc | Android NDK clang |
| Build command | `pnpm tauri build` | `pnpm tauri android build` |
| Output | `.dmg` / `.exe` / `.deb` / `.AppImage` | `.apk` / `.aab` |
| Signing | Ad-hoc / certificate | Android keystore |
| Distribution | GitHub releases | Google Play Store / sideload |
| CI runner | `macos-latest`, `windows-latest`, `ubuntu-latest` | `ubuntu-latest` (with Android SDK + NDK) |

### New CI Job

```yaml
build-android:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: "22"
    - uses: pnpm/action-setup@v2
      with:
        version: 10
    - uses: dtolnay/rust-toolchain@stable
      with:
        targets: aarch64-linux-android
    - uses: actions/setup-java@v4
      with:
        distribution: "zulu"
        java-version: 17
    - name: Install cargo-ndk
      run: cargo install cargo-ndk
    - name: Install system deps
      run: |
        sudo apt-get update
        sudo apt-get install -y libwebkit2gtk-4.1-dev
    - name: Build Tauri Android
      run: pnpm tauri android build
```

**Note:** The llama.cpp compilation step is the wildcard. If `llama-cpp-2`'s build script doesn't detect the Android NDK automatically, the build job needs to set environment variables (`CC_aarch64_linux_android`, `AR_aarch64_linux_android`, etc.) or use a custom build script.

---

## Success Criteria

### Technical Readiness
- [ ] llama.cpp compiles for `aarch64-linux-android` in CI
- [ ] candle embedding produces identical vectors on Android CPU
- [ ] LLM inference achieves ≥5 tok/s on a representative mid-range phone (e.g., Pixel 7 / Galaxy A54)
- [ ] Total APK size ≤ 25 MB (excluding models, which download on first launch)
- [ ] Tauri Android build pipeline runs in < 20 minutes on GitHub Actions

### User Experience
- [ ] "Open PDF" → parse → chat in ≤ 3 taps
- [ ] First-run model download completes without frustration (progress, pause/resume, Wi-Fi check)
- [ ] Answer generation doesn't freeze the UI (background thread)
- [ ] App doesn't ANR during any operation

---

## Implementation Order (Sub-Phases)

| Sub-phase | What | Effort | Dependencies |
|-----------|------|:------:|-------------|
| **M1** | Android toolchain + first successful `cargo build` for `aarch64-linux-android` | 1 week | NDK, Rust target, cargo-ndk |
| **M2** | LLM + embedding cross-compilation & testing on device/emulator | 2 weeks | M1, llama.cpp Android build |
| **M3** | File handling (content URIs, intent-filter, share sheet) | 1 week | M1 |
| **M4** | Mobile UI redesign (responsive layout, touch interactions, bottom sheet) | 2–3 weeks | — |
| **M5** | Setup wizard + model download for mobile | 1 week | M2 |
| **M6** | Android CI pipeline + APK signing + Play Store prep | 1 week | M1–M5 |
| **M7** | Beta testing + bug fixes + performance tuning | 2 weeks | M6 |

**Total:** 10–12 weeks. Optimistic estimate (parallel work): 8 weeks with 2 developers (1 frontend, 1 Rust/Android).

---

## Conclusion

**Technically feasible.** The core ML pipeline (candle + llama.cpp) is the least risky part — both have existing Android deployments. The hard work is:

1. **Mobile UI redesign** — the chat interface, PDF selection, and source panel must feel native to Android, not like a shrunken desktop app.
2. **Build toolchain** — getting llama.cpp to cross-compile for Android in CI is fiddly, but has been done by many projects before.
3. **Performance tuning** — Llama 3.2-3B at 3–6 tok/s on CPU is usable but not delightful. GPU offload or a smaller model is recommended.

### Recommended Approach

1. Start with a **smaller LLM** (Qwen2.5-1.5B, ~1 GB) to minimize memory pressure
2. **CPU-only** first — add Vulkan support as a follow-up optimization
3. Use the **existing Rust code** for all ML and search — only change the UI and file handling
4. Ship as a **sideload APK** initially (no Play Store review delays during iteration)
5. Register for PDF intents so users can "Share" PDFs to ZoloRAG from any app

### Groundwork (Do Now)

Even while working on the desktop, keep mobile in mind with these low-effort changes:

- **[Low effort] Abstract file input** — `load_pdf` already takes a `String` path. Make it also accept content URI strings when the mobile build is active.
- **[Low effort] Responsive layout** — Use Tailwind breakpoints in new UI components. Avoid fixed-width layouts.
- **[Low effort] Background thread pattern** — Wrap LLM inference in `spawn_blocking` now (it doesn't hurt desktop, and makes the mobile port easier).
- **[Document] Build notes** — If you compile llama.cpp for an unusual target, document the flags so the Android build doesn't need trial-and-error.

### Final Verdict

```
├── Technical feasibility:  ✅  4/5 (llama.cpp on Android is proven)
├── UX feasibility:         ⚠️  3/5 (desktop→mobile redesign is real work)
├── Build complexity:       ⚠️  3/5 (NDK + cross-compilation + CI)
├── Performance:            ⚠️  3/5 (CPU-only is borderline; Vulkan helps)
└── Overall readiness:      ✅  Go — Phase 6 is the plan
```
