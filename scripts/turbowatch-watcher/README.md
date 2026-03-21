# Turbowatch Watcher

Alternative file watcher built with [Turbowatch](https://github.com/gajus/turbowatch). Uses Turbowatch expressions and triggers instead of chokidar + config JSON.

## Setup

### 1. Prerequisites

- **Node.js** and **npm** (project dependencies installed)
- **Qdrant** running (for `index-docs-src` trigger)

### 2. Qdrant

Start Qdrant locally or use a remote instance. Default: `http://localhost:6333`.

To use a different URL (e.g. from `.continue/rules/system.md`):

```bash
export QDRANT_URL=http://192.168.8.199:6333
```

Or add to `.env` in the project root (dotenv is loaded automatically).

### 3. File descriptor limit (macOS)

Turbowatch watches the project tree and can hit `EMFILE: too many open files` on macOS. Increase the limit before running:

```bash
ulimit -n 10240
```

To make it persistent, add to `~/.zshrc`:

```bash
ulimit -n 10240
```

### 4. Optional: Embedder for semantic search

The `index-docs-src` trigger uses a placeholder embedder (zero vectors) unless `EMBEDDER_MODULE` is set. For useful semantic search, configure a module that exports `(texts: string[]) => Promise<number[][]>`:

```bash
export EMBEDDER_MODULE=/path/to/your/embedder.ts
```

## Usage

```bash
npm run watch:turbo
```

## Triggers

1. **index-docs-src** – Index `src/**/*.ts`, `src/**/*.tsx`, `docs/**/*.md` to Qdrant (excludes test/spec).
2. **regenerate-wardrobe-assets** – Run `npm run assets:generate` when wardrobe skins or preview configs change.

## Comparison with file-watcher (chokidar)

| Feature          | file-watcher              | turbowatch-watcher     |
|------------------|---------------------------|------------------------|
| Config           | JSON (`file-watcher.config.json`) | TypeScript (turbowatch.config.ts) |
| Patterns         | Glob include/exclude      | Turbowatch expressions |
| Extensibility    | Add operations in config  | Edit triggers in TS    |
| Debounce         | Per-operation             | Global (500ms)         |
| Index to Qdrant  | Yes                       | Yes (shared logic)     |
| Run npm tasks    | Yes                       | Yes                    |

## Environment

Same as file-watcher: `QDRANT_URL`, `EMBEDDER_MODULE`, `.env` (via dotenv).
