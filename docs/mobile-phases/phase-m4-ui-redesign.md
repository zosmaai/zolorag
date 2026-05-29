# Phase 6.4 (M4): Mobile UI Redesign

> **Goal:** The app feels native on mobile — touch-friendly, responsive layout, bottom sheets, and keyboard-aware input.
> **Depends on:** Nothing blocking (can parallelize with M2, M3)

---

## Scope

Transform the desktop-centric Next.js frontend (designed for 1100×750px) into a mobile-native experience. This is primarily a frontend effort — no Rust backend changes needed (though some new Tauri command wrappers may be added).

## Tasks

### 1. Responsive Layout Foundation
- [ ] Audit all components for hardcoded pixel widths → convert to `w-full`, `max-w-*`, `min-h-screen` Tailwind classes
- [ ] Add viewport meta tag: `<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">`
- [ ] Define mobile breakpoints: `sm: 640px`, `md: 768px`, `lg: 1024px` (check existing config)
- [ ] Test layout on 360dp (small phone), 390dp (Pixel 7), 430dp (iPhone 14 Pro Max in Android terms)

### 2. Component Redesigns

#### DropZone → OpenPdfButton
- [ ] Replace full-page drag-and-drop zone with a button: "📄 Open PDF"
- [ ] Button should be prominent on the home/empty state
- [ ] On tap → invokes `open_pdf_picker()` Tauri command
- [ ] When PDF is loaded → transition to chat view (no separate "loaded" state needed)

#### SetupPanel → Full-Screen Wizard
- [ ] Convert SetupPanel from centered card to full-screen scrollable flow
- [ ] Each step takes full viewport height vertically
- [ ] Step indicator (dots or numbers) at top
- [ ] "Next" / "Back" buttons at bottom, thumb-friendly (≥ 48px height)
- [ ] Compact model info cards (model size, RAM needed)

#### SourcePanel → BottomSheet
- [ ] Replace right-side sliding panel with a mobile bottom sheet
- [ ] Bottom sheet triggered by tapping a chip/badge on the chat message
- [ ] Sheet shows: page number, file name, snippet preview
- [ ] Sheet can be dismissed by swiping down
- [ ] Consider using `tauri-plugin-dialog` or a custom CSS `transform: translateY()` approach
- [ ] If using pure CSS, ensure backdrop click closes the sheet

#### ChatMessages
- [ ] Messages should be full-width with max-width constraint (like iMessage/WhatsApp)
- [ ] User messages: right-aligned, colored bubble
- [ ] Assistant messages: left-aligned, subtle background
- [ ] Source citation chips inline in assistant messages → tapping opens BottomSheet
- [ ] Auto-scroll to bottom on new message (already working)

#### ChatInput
- [ ] Fixed at bottom of screen (position: sticky or fixed)
- [ ] Input field + send button
- [ ] **Keyboard-aware**: When soft keyboard opens, the input must not be hidden
- [ ] Use `visualViewport` API or `window.addEventListener('resize')` to adjust
- [ ] Disable send button when empty or during generation
- [ ] Show "Stop generating" button during LLM output (replaces send button)

#### Header / Navigation
- [ ] No persistent header bar (saves vertical space)
- [ ] Show a thin status bar only: model indicator (icon + status dot), settings gear
- [ ] On chat screen: show PDF filename as a small title that scrolls away
- [ ] Pull down to go back to file picker (or use back button/hamburger)

### 3. Touch Interactions
- [ ] Ensure all interactive elements are ≥ 48×48px (Android accessibility guideline)
- [ ] Add `touch-action: manipulation` to prevent double-tap zoom
- [ ] Test long-press on source citations → should show context menu (or just open sheet)
- [ ] Swipe to dismiss bottom sheet
- [ ] Pull-to-refresh not needed (not a data-fetching scenario)

### 4. Dark Mode
- [ ] Verify current dark mode CSS works on mobile (it should, same Tailwind classes)
- [ ] Test contrast ratios on a small screen in bright sunlight (outdoor test)
- [ ] Ensure bottom sheet overlay has proper backdrop opacity in dark mode

### 5. Loading & Empty States
- [ ] **No PDF loaded**: Show "Open a PDF to get started" with the Open PDF button
- [ ] **Model downloading**: Show progress bar + estimated time + Wi-Fi indicator
- [ ] **Model loaded, no PDF**: Same as no-PDF state
- [ ] **Generating**: Show streaming text as it arrives (already works) + subtle pulse indicator
- [ ] **Error state**: Show error message with retry button

### 6. Android System UI Integration
- [ ] Set status bar color via `AndroidManifest.xml` (or Tauri config)
- [ ] Use edge-to-edge display: `window.setDecorFitsSystemWindows(false)`
- [ ] Ensure content doesn't overlap with system bars (nav bar + status bar)
- [ ] Test on devices with gesture navigation (swipe back gesture interferes?)

### 7. Responsive Testing Matrix

Test on these form factors at minimum:

| Device | Screen | Status |
|--------|--------|--------|
| Pixel 7 / 7a | 6.3", 390dp | ☐ |
| Galaxy S24 | 6.2", 393dp | ☐ |
| Galaxy A54 (mid-range) | 6.4", 393dp | ☐ |
| Pixel Tablet / foldable | 10.5", 600dp+ | ☐ (bonus) |
| Emulator (small) | 4.0", 320dp | ☐ |

---

## Feasibility Checklist (Blocker Detection)

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 1 | All pages render without horizontal scroll on 360dp width | ☐ | |
| 2 | OpenPdfButton triggers file picker (or share intent) | ☐ | Depends on M3 |
| 3 | BottomSheet opens and closes smoothly (no judder) | ☐ | |
| 4 | Chat input stays visible when soft keyboard opens | ☐ | This is often broken in WebViews |
| 5 | All tappable targets ≥ 48×48px | ☐ | |
| 6 | Source citation chips → tap → bottom sheet with details | ☐ | |
| 7 | Setup wizard is fully scrollable without cutting off content | ☐ | |
| 8 | Dark mode is readable outdoors (good contrast) | ☐ | |
| 9 | No hardcoded desktop-only Tauri API usage (e.g., window management) | ☐ | |
| 10 | App doesn't flicker or flash during device rotation | ☐ | |

## Blockers & Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| WebView keyboard handling is inconsistent across Android versions | **High** | Test on Android 12, 13, 14; use `visualViewport` polyfill if needed |
| Bottom sheet implementation is janky in WebView | Medium | Use native Tauri plugin if available; otherwise use well-tested CSS (no JS drag) |
| Touch events conflict with gesture navigation | Medium | Add safe areas; test with gesture nav on Pixel and Samsung |
| `maximum-scale=1.0` may break accessibility zoom | Low | Acceptable trade-off; users can use system font size instead |

## Success Criteria

- [ ] App is usable one-handed on a 6.3" phone
- [ ] All text is readable without zooming
- [ ] Keyboard doesn't cover the input field
- [ ] Bottom sheet for sources feels native (slide up, dismiss by swipe down or backdrop tap)
- [ ] File picker → parse → chat flow takes ≤ 3 taps
- [ ] No regressions on desktop layout (must still work at 1100×750)

## Exit Criteria

M4 is **complete** when:
1. All components have mobile-optimized layouts
2. The app passes the responsive testing matrix on at least 2 physical devices
3. Keyboard handling is verified on Android 13 and 14
4. Desktop layout is verified to have no regressions
5. Team reviews the mobile UI and signs off on the UX direction
