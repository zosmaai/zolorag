#!/usr/bin/env node

/**
 * Copies Tauri build artifacts from src-tauri/target/release/bundle/
 * into builds/, organized by platform.
 *
 * Usage:
 *   node scripts/copy-builds.mjs          # auto-detect platform
 *   node scripts/copy-builds.mjs macos    # force platform
 *   node scripts/copy-builds.mjs windows
 *   node scripts/copy-builds.mjs linux
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const bundleDir = join(root, "src-tauri", "target", "release", "bundle");
const outDir = join(root, "builds");

// Detect platform
const platform = (process.argv[2] || process.platform).toLowerCase();
const platformMap = {
	macos: "macos",
	darwin: "macos",
	win32: "windows",
	windows: "windows",
	linux: "linux",
};
const targetPlatform = platformMap[platform];

if (!targetPlatform) {
	console.error(`Unknown platform: ${platform}`);
	process.exit(1);
}

console.log(`\n  Platform: ${targetPlatform}`);
console.log(`  Bundle dir: ${bundleDir}`);

// Ensure output dir
const platformOut = join(outDir, targetPlatform);
mkdirSync(platformOut, { recursive: true });

let count = 0;

/** Copy a single file */
function copyFile(src, dest) {
	if (!existsSync(src)) return false;
	copyFileSync(src, dest);
	return true;
}

/** Copy all matching files from a subdirectory */
function copyFrom(subDir, extensions) {
	const d = join(bundleDir, subDir);
	if (!existsSync(d)) return;
	const items = readdirSync(d);
	for (const item of items) {
		if (extensions.some((ext) => item.endsWith(ext))) {
			const src = join(d, item);
			if (statSync(src).isFile()) {
				copyFile(src, join(platformOut, item));
				console.log(`  ✓ ${item}`);
				count++;
			}
		}
	}
}

// ── macOS ──
if (targetPlatform === "macos") {
	// Tauri builds .dmg in bundle/dmg/ but also sometimes in bundle/macos/
	copyFrom("dmg", [".dmg"]);
	copyFrom("macos", [".dmg", ".app", ".tar.gz", ".tar.bz2"]);

	// Also check for .app bundle directly
	const appDir = join(bundleDir, "macos", "ZoloRAG.app");
	if (existsSync(appDir)) {
		console.log(`  ✓ ZoloRAG.app/ (bundle)`);
		count++;
	}
}

// ── Windows ──
if (targetPlatform === "windows") {
	copyFrom("nsis", [".exe"]);
	copyFrom("msi", [".msi"]);
}

// ── Linux ──
if (targetPlatform === "linux") {
	copyFrom("deb", [".deb"]);
	copyFrom("appimage", [".AppImage"]);
	copyFrom("rpm", [".rpm"]);
}

// ── Summary ──
if (count > 0) {
	console.log(`\n  ✓ Copied ${count} artifact(s) to builds/${targetPlatform}/\n`);
} else {
	console.log(`\n  ⚠  No build artifacts found at ${bundleDir}\n`);

	// Suggest what to do
	if (process.platform !== platform && !process.argv[2]) {
		console.log(`  You're on ${process.platform}, trying to collect ${targetPlatform} artifacts.`);
	}

	if (!existsSync(join(bundleDir))) {
		console.log(`  The bundle directory doesn't exist. Run 'pnpm tauri build' first.`);
	} else {
		const dirs = readdirSync(bundleDir);
		if (dirs.length === 0) {
			console.log(`  The bundle directory is empty. The build may have failed.`);
		} else {
			console.log(`  Available subdirectories: ${dirs.join(", ")}`);
			console.log(`  No matching files found. Check the build output above.`);
		}
	}
	console.log();
}
