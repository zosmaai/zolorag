# Contributing to ZoloRAG

Thank you for considering contributing to ZoloRAG! We welcome contributions of all kinds — bug reports, feature suggestions, documentation improvements, and code changes.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Environment](#development-environment)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Coding Guidelines](#coding-guidelines)
- [Commit Conventions](#commit-conventions)
- [Pull Request Process](#pull-request-process)
- [Testing](#testing)
- [Reporting Issues](#reporting-issues)

## Code of Conduct

This project is committed to providing a welcoming, inclusive, and harassment-free experience for everyone. We expect all contributors to treat others with respect and professionalism.

## Getting Started

1. **Fork** the repository on GitHub.
2. **Clone** your fork locally:

   ```bash
   git clone https://github.com/<your-username>/zolo-rag.git
   cd zolo-rag
   ```

3. **Set up the development environment** (see [Development Environment](#development-environment)).
4. **Create a new branch** for your work:

   ```bash
   git checkout -b feat/my-feature
   ```

5. **Make your changes** following the guidelines below.
6. **Test and lint** your changes.
7. **Commit** using the [conventional commit format](#commit-conventions).
8. **Push** to your fork and open a **Pull Request**.

## Development Environment

### Prerequisites

- **Rust toolchain** (1.80+) — [rustup.rs](https://rustup.rs)
- **Node.js 20+** — [nodejs.org](https://nodejs.org)
- **pnpm** — `npm install -g pnpm`
- **Platform-specific system libraries** for Tauri:
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`)
  - **Linux**: WebKit2GTK, GTK3, and other deps (see [Tauri docs](https://v2.tauri.app/start/prerequisites/))
  - **Windows**: Microsoft Visual Studio C++ Build Tools, WebView2

### Setup

```bash
# Install frontend dependencies
pnpm install

# Run in development mode
npx tauri dev
```

The app will start and, on first launch, guide you through downloading the required ML models (~1.9 GB total).

### Model Cache

Models are cached in the system's app data directory and persist across restarts. To force a re-download of models, delete the cached files:

- **macOS**: `~/Library/Application Support/com.zosmaai.zolorag/`
- **Linux**: `~/.local/share/com.zosmaai.zolorag/`
- **Windows**: `%APPDATA%/com.zosmaai.zolorag/`

## Project Structure

```
zolo-rag/
├── src/                          # Frontend (Next.js + TypeScript)
│   ├── app/
│   │   ├── page.tsx              # Main chat UI + setup flow
│   │   ├── layout.tsx            # Root layout
│   │   └── globals.css           # CSS variables, themes, animations
│   ├── components/
│   │   ├── SetupPanel.tsx        # First-launch model download UI
│   │   ├── ChatInput.tsx         # Text input + send button
│   │   ├── ChatMessages.tsx      # Message timeline
│   │   ├── DropZone.tsx          # PDF upload area
│   │   ├── ModelBanner.tsx       # Model status indicator
│   │   └── SourcePanel.tsx       # Slide-out PDF page viewer
│   ├── hooks/
│   │   └── useTauriEvent.ts      # Event listener helper
│   └── types/
│       └── index.ts              # Shared TypeScript types
├── src-tauri/                    # Backend (Rust)
│   ├── src/
│   │   ├── main.rs               # Entry point
│   │   ├── lib.rs                # Tauri commands + app state
│   │   ├── ml/                   # ML inference (candle, llama.cpp)
│   │   ├── index/                # Semantic search index
│   │   ├── pdf/                  # PDF extraction & chunking
│   │   └── rag/                  # RAG context building & chat
│   ├── Cargo.toml
│   └── tauri.conf.json
├── docs/                         # Technical documentation
│   ├── plan.md
│   └── phases/                   # Development phase notes
├── scripts/                      # Build automation scripts
└── .github/workflows/            # CI/CD pipelines
```

## Development Workflow

### Rust Backend

The Rust backend handles PDF processing, embedding, search, and LLM inference. To iterate quickly:

```bash
cd src-tauri
cargo check      # Fast compilation check
cargo clippy     # Lint
cargo test       # Run unit tests
```

### Frontend

The frontend is a Next.js app embedded in Tauri. To develop the UI standalone:

```bash
pnpm dev         # Starts Next.js at http://localhost:3000
```

> **Note**: Some features (PDF drop, model downloads, LLM streaming) require the Tauri backend. Use `npx tauri dev` for full-stack development.

### Full-Stack

```bash
npx tauri dev    # Starts both Next.js and Tauri in one command
```

## Coding Guidelines

### Rust

- Follow the [Rust API Guidelines](https://rust-lang.github.io/api-guidelines/).
- Use `cargo clippy` before committing and address all warnings.
- Run `cargo fmt` to format code (use `rustfmt` with default settings).
- Write documentation comments (`///`) for all public items.
- Prefer `thiserror` for library error types and `anyhow` for application-level error handling.
- Use `Result<T, String>` for Tauri command return types (Tauri requires `Send + Sync`).
- Avoid `unwrap()`/`expect()` in production code — propagate errors instead.

### TypeScript / React

- Use strict TypeScript (`strict: true` in tsconfig is enabled).
- Run `pnpm lint` before committing (uses Biome).
- Run `pnpm format` to format code.
- Use functional components and hooks; avoid class components.
- Export types from `src/types/index.ts`.
- CSS uses Tailwind v4 with CSS custom properties for theming.

### General

- Keep changes focused. Prefer small, single-purpose PRs over large monolithic ones.
- Add comments for non-obvious logic, especially around performance-critical paths.
- Update documentation when changing public APIs or user-facing behavior.

## Commit Conventions

We use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

| Type       | Usage                                    |
|------------|------------------------------------------|
| `feat`     | A new feature                            |
| `fix`      | A bug fix                                |
| `docs`     | Documentation changes                    |
| `style`    | Formatting, missing semicolons, etc.     |
| `refactor` | Code restructuring without behavior change |
| `perf`     | Performance improvements                 |
| `test`     | Adding or updating tests                 |
| `chore`    | Build, CI, dependencies, tooling         |
| `ci`       | CI/CD configuration changes              |

### Examples

```
feat(rag): add multi-document support

fix(embed): handle OOM during large PDF embedding

docs(readme): add hardware requirements section

refactor(index): extract hamming search into standalone fn
```

## Pull Request Process

1. **Create an issue** first for significant changes — discuss before implementing.
2. **Keep PRs small** — ideally under 400 lines changed. Split large features into multiple PRs.
3. **Rebase** onto the latest `main` before opening your PR.
4. **Ensure CI passes** — all lint, format, and build checks must be green.
5. **Request review** from a maintainer.
6. **Address review feedback** with additional commits. Squash if needed before merge.
7. **Wait for merge** — maintainers will squash-merge your PR.

### PR Title

Use the conventional commit format as the PR title. Example: `feat(pdf): add OCR fallback for scanned documents`

### Checklist for PR Authors

- [ ] Code compiles without errors (`cargo check`, `pnpm lint`)
- [ ] Code is formatted (`cargo fmt`, `pnpm format`)
- [ ] No new Clippy warnings (`cargo clippy`)
- [ ] Existing tests pass
- [ ] New functionality includes tests where applicable
- [ ] Documentation updated (README, doc comments, etc.)

## Testing

- **Rust unit tests**: `cargo test` in `src-tauri/`
- **Lint checks**: `pnpm lint` and `cargo clippy`
- **Build verification**: `npx tauri build` (creates production bundle)

Currently the test suite is minimal. Contributions that add test coverage are especially welcome!

## Reporting Issues

When reporting a bug, please include:

- **Environment**: OS version, Rust version (`rustc --version`), Node version (`node --version`)
- **App version**: The version you're using (from `Cargo.toml` or `About` panel)
- **Steps to reproduce**: Clear, numbered steps
- **Expected vs actual behavior**: What you expected to happen and what actually happened
- **Logs**: Check the terminal output for Rust panics or errors
- **PDF sample**: If the bug is PDF-specific, try to include a minimal PDF that reproduces the issue

### Feature Requests

When suggesting a feature, explain:

- The problem you're trying to solve
- How you imagine the feature working
- Any alternatives you've considered

---

Thank you for contributing to ZoloRAG! 🚀
