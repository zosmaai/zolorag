#!/usr/bin/env node

/**
 * Checks that the current platform matches the expected target.
 * This project uses llama-cpp-sys (native C++ compiled code), which
 * cannot be cross-compiled reliably. Each platform must build natively.
 *
 * Usage: node scripts/check-platform.mjs <target>
 *   target: macos | windows | linux
 */

const target = process.argv[2]?.toLowerCase();
if (!target) {
	console.error("Usage: node scripts/check-platform.mjs <macos|windows|linux>");
	process.exit(1);
}

const platformMap = {
	macos: ["darwin", "macos"],
	windows: ["win32", "windows"],
	linux: ["linux"],
};

const current = process.platform;
const validTargets = Object.keys(platformMap);

if (!validTargets.includes(target)) {
	console.error(`Unknown target: ${target}. Valid targets: ${validTargets.join(", ")}`);
	process.exit(1);
}

const allowed = platformMap[target];
if (!allowed.includes(current)) {
	console.error(`
  ╔══════════════════════════════════════════════════════════════════╗
  ║  Cannot build for ${target.toUpperCase()} on ${current}.                   ║
  ║                                                                  ║
  ║  This project uses llama-cpp-sys (native C++), which requires    ║
  ║  the full platform SDK and cannot be cross-compiled reliably.    ║
  ║                                                                  ║
  ║  ── Solution: GitHub Actions ──                                  ║
  ║  Push to main (or run manually in Actions tab) and the CI at     ║
  ║  .github/workflows/build.yml builds all 3 platforms natively:    ║
  ║                                                                  ║
  ║    macOS   → ZoloRAG.dmg                                         ║
  ║    Windows → ZoloRAG_x.x.x_x64-setup.exe                         ║
  ║    Linux   → zolo-rag_x.x.x_amd64.deb + .AppImage                ║
  ║                                                                  ║
  ║  ── Local builds (current machine) ──                             ║
  ║    pnpm builds:mac    (macOS only)                                ║
  ║    pnpm builds:win    (Windows only)                              ║
  ║    pnpm builds:linux  (Linux only)                                ║
  ║    pnpm builds        (current platform)                          ║
  ╚══════════════════════════════════════════════════════════════════╝
`);
	process.exit(1);
}

console.log(`  ✓ Building for ${target} on ${current}`);
