# Phase 6.4 (M4): Responsive UI — Desktop + Mobile

> **Goal:** The app works well on both desktop (1100×750px+) and mobile (360–430dp). Each platform gets its native UX patterns. Neither is degraded.
> **Depends on:** Nothing blocking (can parallelize with M2, M3)

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
- [ ] Audit all components for hardcoded pixel widths → convert to `w-full`, `max-w-*`, `min-h-screen` Tailwind classes
- [ ] Add viewport meta tag: `<meta name="viewport" content="width=device-width, initial-scale=1.0">`
  - Do NOT add `user-scalable=no` — breaks desktop accessibility zoom
- [ ] Define mobile breakpoints: `sm: 640px`, `md: 768px`, `lg: 1024px` (check existing config)
- [ ] Add a reliable `isMobile` / `platform` detection — use Tauri's `platform()` API (`@tauri-apps/plugin-os`) rather than `window.innerWidth` alone
- [ ] Test layout at: 360dp, 390dp (Pixel 7), 430dp, 768dp (tablet), 1100px (desktop baseline)

### 2. Component Adaptations

#### DropZone — Keep on Desktop, Hide on Mobile
- [ ] **Do NOT remove DropZone** — it is the primary desktop UX
- [ ] Add `{!isMobile && <DropZone onDrop={handleDrop} />}` conditional render
- [ ] DropZone's `onDrop` handler continues to call the existing `load_pdf` command — no changes
- [ ] Regression test: drag-drop a PDF on desktop still works after M4

#### OpenPdfButton — Add Alongside DropZone (Desktop) / Primary (Mobile)
- [ ] Add `<OpenPdfButton>` component that calls `open_pdf_picker()` Tauri command (from M3)
- [ ] **Desktop**: button sits alongside DropZone (secondary option — "or click to browse")
- [ ] **Mobile**: button is the only PDF input; placed prominently on the home/empty state
- [ ] On tap/click → invokes `open_pdf_picker()` → uses native dialog (desktop) or Android file picker (mobile)
- [ ] When PDF loads → transitions to chat view on both platforms

#### SetupPanel — Responsive Adaptation
- [ ] **Desktop**: keep current centered card layout — no changes
- [ ] **Mobile**: convert to full-screen scrollable flow:
  - Each step takes full viewport height
  - Step indicator (dots or numbers) at top
  - "Next" / "Back" buttons at bottom, ≥48px height
  - Compact model info cards (model size, RAM needed)
- [ ] Use same state machine / data — only the presentation layer differs

#### SourcePanel — Keep Sidebar on Desktop, Bottom Sheet on Mobile
- [ ] **Desktop**: keep existing right-side sliding panel — no changes
- [ ] **Mobile**: add bottom sheet variant:
  - Triggered by tapping a source citation chip on a message
  - Shows: page number, file name, snippet preview
  - Dismissed by swipe-down or backdrop tap
  - Implement with pure CSS `transform: translateY()` (no JS drag library required)
- [ ] Use `isMobile` to decide which variant to render

#### ChatMessages — Responsive Bubbles
- [ ] Messages should be full-width with `max-w-prose` constraint — works on both
- [ ] User messages: right-aligned colored bubble (already may be close to this)
- [ ] Assistant messages: left-aligned subtle background
- [ ] Source citation chips inline in assistant messages:
  - **Desktop**: hover shows tooltip preview; click opens SourcePanel
  - **Mobile**: tap opens BottomSheet
- [ ] Auto-scroll to bottom on new message (verify still works after layout changes)

#### ChatInput — Keyboard-Aware on Mobile, Unchanged on Desktop
- [ ] **Desktop**: no changes to current input behavior
- [ ] **Mobile**: ensure input is not hidden when soft keyboard opens:
  - Use `visualViewport` API to detect keyboard height and adjust scroll
  - Input must be `position: sticky; bottom: 0` within the chat container
  - Test on Android 12, 13, 14 (WebView keyboard behavior differs per version)
- [ ] Disable send button when empty or during generation (both platforms)
- [ ] Show "Stop generating" button during LLM output (both platforms)

#### Header / Navigation
- [ ] **Desktop**: keep existing header/nav — no changes
- [ ] **Mobile**: minimal status bar only (model status dot + settings icon)
  - Show PDF filename as a small title that scrolls away with content
  - No persistent header bar (saves vertical space)

### 3. Touch Interactions (Mobile-only additions)
- [ ] All interactive elements: verify ≥ 48×48px touch targets on mobile
- [ ] Add `touch-action: manipulation` to buttons to prevent double-tap zoom on mobile
- [ ] Swipe to dismiss bottom sheet (mobile only)
- [ ] Long-press on source citations → open bottom sheet (mobile)

### 4. Dark Mode (Both Platforms)
- [ ] Verify current dark mode CSS works on mobile — should be unchanged Tailwind classes
- [ ] Test contrast ratios on small screen in different lighting
- [ ] Bottom sheet overlay has proper backdrop opacity in dark mode
- [ ] Regression: dark mode on desktop still works

### 5. Loading & Empty States (Both Platforms)
- [ ] **No PDF loaded**: "Open a PDF to get started" + DropZone (desktop) / OpenPdfButton (mobile)
- [ ] **Model downloading**: progress bar + estimated time (from M5) — both platforms
- [ ] **Generating**: streaming text + pulse indicator — both platforms
- [ ] **Error state**: error message + retry — both platforms

### 6. Android System UI Integration (Mobile-only)
- [ ] Set status bar color via `AndroidManifest.xml` or Tauri config
- [ ] Edge-to-edge display: ensure content doesn't overlap system bars
- [ ] Test with gesture navigation (swipe-back gesture) on Pixel
- [ ] **Desktop**: no changes

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
| 1 | DropZone drag-drop still works after M4 | Desktop | ☐ |
| 2 | All pages render without horizontal scroll on 360dp | Mobile | ☐ |
| 3 | `isMobile` detection is reliable in Tauri WebView | Both | ☐ |
| 4 | OpenPdfButton triggers correct picker on each platform | Both | ☐ |
| 5 | BottomSheet opens and closes smoothly | Mobile | ☐ |
| 6 | Chat input stays visible when soft keyboard opens | Mobile | ☐ |
| 7 | All tappable targets ≥ 48×48px | Mobile | ☐ |
| 8 | SourcePanel sidebar still works | Desktop | ☐ |
| 9 | SetupPanel centered card still works | Desktop | ☐ |
| 10 | Dark mode readable on both platforms | Both | ☐ |
| 11 | No hardcoded desktop-only Tauri APIs break on mobile | Both | ☐ |

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
- [ ] DropZone drag-and-drop still works
- [ ] "Open PDF" button opens native file dialog
- [ ] SetupPanel centered card layout intact
- [ ] SourcePanel sidebar opens/closes correctly
- [ ] Layout holds at 1100×750px and 1440×900px

### Mobile (net new)
- [ ] App usable one-handed on a 6.3" phone
- [ ] All text readable without zooming
- [ ] Keyboard doesn't cover the input field
- [ ] BottomSheet for sources feels native
- [ ] File picker → parse → chat flow ≤ 3 taps

---

## Exit Criteria

M4 is **complete** when:
1. Desktop layout passes regression tests at 1100×750px — zero regressions
2. Mobile layout passes on at least 2 physical Android devices
3. Keyboard handling verified on Android 13 and 14
4. `isMobile` correctly renders the right components on each platform
5. Team reviews both desktop and mobile UI and signs off
