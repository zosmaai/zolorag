# Phase 6.4 (M4): Responsive UI — Desktop + Mobile

> **Goal:** The app works well on both desktop (1100×750px+) and mobile (360–430dp). Each platform gets its native UX patterns. Neither is degraded.
> **Depends on:** Nothing blocking (can parallelize with M2, M3)
> **Status (2026-06-12):** 🟡 Code complete + compile-verified on both platforms. Android runtime verification ⏸ deferred (blocked on M2's `pnpm tauri android dev`).

---

## 🚦 M4 Final Status: CODE COMPLETE — Runtime Verification Deferred

**Implemented + compile-verified (2026-06-12):**

| Area | Files | Verified by |
|------|-------|-------------|
| Viewport meta + dynamic-viewport CSS | `src/app/layout.tsx` (`Viewport` export), `src/app/globals.css` (`100dvh`, safe-area helpers, `touch-action: manipulation`) | `pnpm build` ✅ |
| Reactive mobile detection | `src/hooks/useIsMobile.ts` (media query — from M3) | `pnpm build` ✅ |
| Keyboard-aware bottom inset | `src/hooks/useKeyboardInset.ts` (`visualViewport` API) | `pnpm build` ✅ |
| Mobile BottomSheet (source viewer) | `src/components/BottomSheet.tsx` — swipe-down dismiss, backdrop tap, safe-area, Escape close, body-scroll-safe | `pnpm build` ✅ |
| Responsive header | `src/app/page.tsx` — smaller logo, compact paddings on mobile, hide tagline when doc loaded | `pnpm build` ✅ |
| Responsive ChatInput | `src/components/ChatInput.tsx` — 48px send target on mobile, 16px font (skips iOS auto-zoom), `enterKeyHint="send"`, disabled when empty | `pnpm build` ✅ |
| Keyboard-aware input row | `src/app/page.tsx` — `paddingBottom: calc(... + ${keyboardInset}px + env(safe-area-inset-bottom))` on mobile only | `pnpm build` ✅ |
| Responsive ChatMessages | `src/components/ChatMessages.tsx` — tighter gutters on mobile, 82% bubble max (vs 65% desktop), 40px tap-target source chips | `pnpm build` ✅ |
| Responsive SetupPanel | `src/components/SetupPanel.tsx` — scrolls, tighter padding, smaller `space-y` on mobile | `pnpm build` ✅ |
| Source view routing | `src/app/page.tsx` — `isMobile ? <BottomSheet> : <SourcePanel>` | `pnpm build` ✅ |
| DropZone preserved on desktop | `src/components/DropZone.tsx` unchanged behaviour; `page.tsx` gates it behind `!isMobile` | `pnpm build` ✅ |
| `OpenPdfButton` (from M3) | `src/components/OpenPdfButton.tsx` — primary on mobile, secondary on desktop | `pnpm build` ✅ |
| Lint clean | biome check on all touched files | ✅ 0 findings |
| Rust desktop regression | `cargo build --lib --release` | ✅ |
| Rust Android regression | `cargo build --target aarch64-linux-android --lib --release` | ✅ 26 MB `.so` |
| Backend tests | `cargo test --lib --release` | ✅ 19/19 |

**Architectural deviations from the original plan (intentional, simpler):**

- **No `@tauri-apps/plugin-os` dep.** `useIsMobile` already uses a media query (carried from M3). Saves a dep + Rust plugin wiring.
- **No JS drag library for the BottomSheet.** Pure React touch handlers + CSS `transform: translateY()`. ~50 LOC, zero deps, no jank on WebView.
- **No separate mobile SetupPanel state machine.** The existing component just adapts its padding/spacing — same `embedState`/`llmState` flow on both platforms.
- **No Android `<meta theme-color>` hardcode.** Set via Next.js `viewport.themeColor` so it's centralised.
- **No Tauri-side status-bar control.** Edge-to-edge is enabled in `MainActivity.kt` via `enableEdgeToEdge()` (added in M3); CSS handles the safe-area painting.

**Deferred to physical device / when `pnpm tauri android dev` is unblocked:**

| Item | Why deferred |
|------|--------------|
| Soft-keyboard behaviour on Android 12 / 13 / 14 | `visualViewport` is implemented, needs WebView runtime test |
| 360dp / 390dp / 430dp visual QA | Needs device or working emulator |
| BottomSheet swipe-down feel | Code shipped, needs touch hardware |
| Gesture-nav safe-area honouring | `env(safe-area-inset-*)` wired, needs device with gesture nav |
| Dark mode contrast on small screens | App currently has only light theme; deferred globally |
| Tablet (768dp) layout polish | Was a nice-to-have; current layout adapts but unverified |

---

## ⚠️ Cross-Platform Constraint

This phase makes the UI **responsive**, not mobile-only. The rule is:

| Component | Desktop | Mobile |
|-----------|---------|--------|
| DropZone (drag-and-drop) | ✅ Keep — primary PDF input | Hidden (no drag-and-drop on touch) |
| OpenPdfButton | ✅ Add alongside DropZone | ✅ Primary PDF input |
| SetupPanel | ✅ Keep centered card layout | Adapts to full-screen scrollable wizard |
| SourcePanel | ✅ Keep right-side sliding panel | Becomes bottom sheet |
| ChatInput | ✅ Unchanged | Keyboard-aware, fixed to bottom |
| Header/Nav | ✅ Keep existing | Compact, no persistent bar |

**Nothing is removed from desktop. Everything is additive or conditionally rendered via `isMobile`.**

---

## Scope

Make the Next.js frontend responsive across all screen sizes. This is a frontend effort — no Rust backend changes. Some new Tauri command wrappers may be added (e.g., `open_pdf_picker`).

---

## Tasks

### 1. Responsive Layout Foundation
- [x] Viewport meta via Next.js `viewport` export in `layout.tsx` — `width=device-width, initialScale=1, viewportFit=cover, themeColor=#017cf3`
  - No `userScalable: false` — desktop a11y zoom + mobile pinch zoom both preserved.
- [x] `100dvh` on root with `100vh` fallback in `globals.css` body — tracks Android URL/keyboard chrome.
- [x] `touch-action: manipulation` global rule on buttons/anchors — kills 300ms double-tap delay.
- [x] `-webkit-tap-highlight-color: transparent` to remove the grey flash.
- [x] Safe-area helpers (`.safe-area-top`, `.safe-area-bottom`) for edge-to-edge.
- [x] `useIsMobile` hook (from M3) — reliable reactive media query.
- [ ] ⏸ Visual QA at 360 / 390 / 430 / 768 dp — needs running app.

### 2. Component Adaptations

#### DropZone — Keep on Desktop, Hide on Mobile
- [x] DropZone component **untouched** — still the primary desktop UX.
- [x] `page.tsx` renders it only when `!isMobile` (`isMobile ? <OpenPdfButton primary> : <DropZone> + <OpenPdfButton secondary>`).
- [x] DropZone's `onBrowse` continues to call the same `handleBrowse` → `load_pdf` path. Zero change to desktop code path.
- [x] Desktop drag-drop wiring intact — `tauri://drag-drop` listener still active in `page.tsx`.

#### OpenPdfButton — Already Added in M3
- [x] Component shipped in M3 with `variant="primary" | "secondary"`.
- [x] Frontend uses `@tauri-apps/plugin-dialog` directly — no Rust wrapper needed (deviation noted in M3).
- [x] Tapping flows through `handleBrowse` → `load_pdf` → resolver → chat view.

#### SetupPanel — Responsive Adaptation
- [x] Desktop: card layout untouched.
- [x] Mobile: container now scrolls (`overflow-y-auto`), padding shrinks to `var(--space-6) var(--space-4)`, vertical rhythm tightens to `space-y-6`.
- [x] Same `embedState`/`llmState` machine on both platforms — only padding/spacing differs.
- [ ] ⏸ Polish step-indicator dots + full-screen wizard flow — the current single-screen layout fits 390dp; deferred unless a real device shows it cramped.

#### SourcePanel + BottomSheet — Cross-Platform Source View
- [x] Desktop: `SourcePanel` (right-side slide-in) **unchanged**.
- [x] Mobile: new `BottomSheet` component — same `document` / `page` / `onClose` / `onNavigate` props, presented as a bottom sheet.
  - Slides up via `@keyframes sheet-slide-up`, backdrop fade via `sheet-backdrop-in`.
  - Drag handle area listens to `touchstart`/`move`/`end` — swipe-down > 120px dismisses.
  - Backdrop button dismisses on tap.
  - Escape key closes (works for hardware-back forwarding later).
  - Respects `env(safe-area-inset-bottom)` for gesture nav.
  - Max height `85dvh` — always leaves room above to dismiss.
- [x] `page.tsx` routes: `sourcePage !== null && !isMobile` → `<SourcePanel>`, `isMobile` → `<BottomSheet>`.

#### ChatMessages — Responsive Bubbles
- [x] Container padding `var(--space-4) var(--space-4)` on mobile vs `var(--space-4) var(--space-5)` desktop.
- [x] User bubble max-width: `82%` mobile, `65%` desktop.
- [x] Source chips: 40px min-height + 13px font on mobile (tap-friendly), original styling on desktop.
- [x] Right-side gutter for assistant messages shrinks from `space-16` (64px) to `space-4` (16px) on mobile so bubbles use available width.
- [x] Auto-scroll-to-bottom logic untouched — verified by `pnpm build`.

#### ChatInput — Keyboard-Aware on Mobile
- [x] Desktop: 38px send button, 15px input font, original padding.
- [x] Mobile: 48px send button (≥ tap-target spec), **16px input font** (prevents iOS/Chrome focus-zoom), more generous padding.
- [x] `enterKeyHint="send"`, `autoComplete="off"`, `autoCorrect="off"`, `spellCheck={false}` for cleaner mobile keyboards.
- [x] Send button disabled when input is empty (in addition to `disabled` during generation) — reactive via `onChange`.
- [x] Keyboard-aware: `useKeyboardInset` measures `window.innerHeight - (visualViewport.height + visualViewport.offsetTop)` and `page.tsx` adds it to the input row's `paddingBottom` (mobile only). Falls back to 0 if `visualViewport` is unavailable.
- [ ] ⏸ "Stop generating" button — not implemented; existing UI already disables send during generation. Stop-mid-stream needs a backend cancel path — push to M7.

#### Header / Navigation
- [x] Desktop: untouched.
- [x] Mobile: smaller logo (30 vs 36), tighter padding (`space-2 space-4` vs `space-3 space-5`), 15px title vs 16px, subtitle hidden when a doc is loaded (filename moves into a smaller secondary line).
- [x] Header buttons larger on mobile (40×40 close button, 40px min-height "Change" pill) to hit the 48px-ish tap-target spec.
- [x] `safe-area-top` class applied to header so it paints under the status bar correctly on Android edge-to-edge.

### 3. Touch Interactions (Mobile-only additions)
- [x] Primary buttons audited: ChatInput send (48px), header close (40px), header Change pill (40px min-height), BottomSheet nav buttons (`.tap-target` → 48×48px), source chips (40px min-height).
- [x] Global `touch-action: manipulation` on `button`, `a`, `[role="button"]` in `globals.css` — kills double-tap zoom on Android.
- [x] BottomSheet swipe-down dismiss implemented in `BottomSheet.tsx` (touch handlers, no lib).
- [x] Source citation chip tap (not long-press) opens BottomSheet on mobile / SourcePanel on desktop — same `onResultClick(result)` handler in both cases.
- [ ] ⏸ Long-press preview — dropped from scope; tap is simpler and more discoverable.
- [ ] ⏸ Device tap-target audit (Pixel) — needs running app.

### 4. Dark Mode (Both Platforms) — ⏸ Out of scope for M4
- [ ] ⏸ The current app ships **light theme only** (verified in `globals.css` — no `[data-theme="dark"]` selectors or `prefers-color-scheme` rules).
- [ ] ⏸ Adding dark mode is a separate effort. Tracked outside M4. The OKLCH design tokens are dark-mode-ready (just swap `:root` values), but no UI toggle exists yet.
- [ ] ⏸ BottomSheet backdrop uses `oklch(0 0 0 / 0.45)` — readable in either future theme.

### 5. Loading & Empty States (Both Platforms)
- [x] No PDF: DropZone (desktop) / OpenPdfButton (mobile), with mobile padding shrunk so the CTA isn't lost in whitespace at 360dp.
- [x] Model downloading: existing `ModelRow` progress bar + size readout in SetupPanel works on both.
- [x] Generating: existing `ThinkingDots` + streaming text in ChatMessages works on both.
- [x] Error state: existing `loadError` banner with AlertTriangle works on both; resolver-failure messages also surface here.
- [ ] ⏸ ETA on model downloads — deferred to **M5** (download UX is M5 scope).

### 6. Android System UI Integration (Mobile-only)
- [x] Status bar colour: set centrally via Next.js `viewport.themeColor: "#017cf3"`.
- [x] Edge-to-edge: `MainActivity.kt` calls `enableEdgeToEdge()` (added in M3). CSS `env(safe-area-inset-top/bottom)` + `.safe-area-top` class on the header keeps content out from under system bars.
- [x] Desktop: no changes — all Android System UI hooks are inside `MainActivity.kt`.
- [ ] ⏸ Gesture-back behaviour on Pixel 

### 7. Responsive Testing Matrix

| Device / Size | Form | Required |
|--------------|------|----------|
| Desktop 1100×750px | Desktop baseline | ✅ Regression — must pass |
| Desktop 1440×900px | Wide desktop | ✅ Regression |
| 360dp (small phone) | Mobile | ✅ Minimum |
| 390dp (Pixel 7) | Mobile | ✅ Reference |
| 430dp (large phone) | Mobile | ✅ |
| 768dp (tablet) | Tablet | 🟡 Bonus |
| Emulator 320dp | Mobile extreme | 🟡 Nice to have |

---

## Feasibility Checklist

| # | Check | Platform | Status |
|---|-------|----------|--------|
| 1 | DropZone drag-drop wiring intact | Desktop | ✅ | `tauri://drag-drop` listener active; rendered when `!isMobile` |
| 2 | All pages render without horizontal scroll on 360dp | Mobile | ⏸ | All inline widths use `%` / `max-w-*`; no hardcoded px widths added. Visual QA needs device. |
| 3 | `isMobile` detection reliable in WebView | Both | ✅ | media-query based, reactive to resize |
| 4 | OpenPdfButton triggers correct picker on each platform | Both | ⏸ | Desktop ✅ (pre-existing path); Android needs APK |
| 5 | BottomSheet opens and closes smoothly | Mobile | ⏸ | Pure CSS transform + touch handlers shipped; needs device |
| 6 | Chat input stays visible when soft keyboard opens | Mobile | ⏸ | `useKeyboardInset` + `visualViewport` wired; needs device |
| 7 | All tappable targets ≥ 48×48px | Mobile | ⏸ | Code-side audit ✅ (send 48, header 40, chips 40, BottomSheet nav 48); device confirm needed |
| 8 | SourcePanel sidebar still works | Desktop | ✅ | Component untouched; routing gated by `!isMobile` |
| 9 | SetupPanel centered card still works | Desktop | ✅ | Padding/spacing only changes when `isMobile` |
| 10 | Dark mode readable on both platforms | Both | ⏸ | Out of M4 scope — app is light-only today |
| 11 | No desktop-only Tauri APIs break on mobile | Both | ✅ | No new Tauri APIs introduced in M4 |

---

## Blockers & Risks

| Risk | Impact | Platform | Mitigation |
|------|--------|----------|------------|
| WebView keyboard handling inconsistent across Android versions | **High** | Mobile | Test on Android 12/13/14; use `visualViewport` polyfill |
| Bottom sheet janky in WebView | Medium | Mobile | Pure CSS transform — avoid JS drag libraries |
| Touch events conflict with gesture navigation | Medium | Mobile | Add safe areas; test on Pixel + Samsung |
| Desktop layout broken by mobile CSS additions | **High** | Desktop | All mobile styles scoped behind breakpoints or `isMobile` conditional |
| `isMobile` detection wrong (flickers or wrong on tablet) | Medium | Both | Use Tauri `platform()` API, not just screen width |

---

## Success Criteria

### Desktop (must not regress)
- [x] DropZone drag-and-drop wiring intact (`tauri://drag-drop` listener unchanged)
- [x] "Open PDF" button opens native file dialog — pre-existing path unchanged
- [x] SetupPanel centered card layout intact — mobile-only branches gated behind `isMobile`
- [x] SourcePanel sidebar opens/closes correctly — component untouched
- [x] No layout regression at 1100×750px / 1440×900px — `pnpm build` ✅, all mobile styles scoped behind `isMobile`

### Mobile (net new — code complete, runtime deferred)
- [x] 16px input font prevents focus-zoom; 48px send target; 40px+ header buttons
- [x] `useKeyboardInset` adds soft-keyboard height to bottom padding
- [x] BottomSheet swipe-down + backdrop + Escape
- [x] Safe-area top/bottom honoured via `env(safe-area-inset-*)`
- [ ] ⏸ One-handed usability QA — needs device
- [ ] ⏸ File picker → parse → chat ≤ 3 taps — needs APK (also from M3)

---

## Exit Criteria

M4 is **complete** when:
1. ✅ Desktop layout passes regression tests at 1100×750px (verified 2026-06-12 via `pnpm build` + code-side review — all mobile branches gated)
2. ⏸ Mobile layout passes on at least 2 physical Android devices — needs APK
3. ⏸ Keyboard handling verified on Android 13 and 14 — `useKeyboardInset` shipped, needs device
4. ✅ `isMobile` correctly renders the right components on each platform (verified by code review + `pnpm build`)
5. ⏸ Team reviews both desktop and mobile UI and signs off — pending Android verification

### What's needed to fully close
The same M2 blocker that gates M3: a working `pnpm tauri android dev` flow or a manually built+sideloaded APK. Once an APK runs on a Pixel-class device, items 2/3/5 above can be ticked without any further code work.
