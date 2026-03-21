# File Watcher

Configurable file watcher that runs operations on add, change, and unlink events. Supports include-all-with-exceptions and file-specific handlers.

## Usage

```bash
npm run watch
# or with custom config
npx tsx scripts/file-watcher/cli.ts --config ./my-config.json
```

## Configuration

Config is loaded from (first found):

- `./file-watcher.config.json`
- `./.file-watcher.json`
- `./scripts/file-watcher/file-watcher.config.json`

### Watch

- **base**: Root path(s) to watch (default: `"."`)
- **include**: Glob patterns. Use `["**/*"]` for all files, then exclude for exceptions.
- **exclude**: Glob patterns always applied after include.
- **ignoreInitial**: If true, ignore the initial add events on startup.

### Operations

Each operation has:

- **name**: Unique identifier for logging.
- **match**: Glob patterns; file must match at least one.
- **exclude**: Optional exclude patterns for this operation.
- **handler**: `indexToQdrant` or `runNpmTask`.
- **options**: Handler-specific options.

### Handlers

#### `indexToQdrant`

Index docs/source for semantic search in Qdrant.

- **url**: Qdrant server URL (default: `QDRANT_URL` env or `http://localhost:6333`)
- **collection**: Collection name (default: `codebase`)
- **vectorSize**: Embedding dimension (default: 384)
- **embedder**: Custom embedder module path (default: placeholder; set `EMBEDDER_MODULE` env)

For real indexing, set `EMBEDDER_MODULE` to a module that exports:

```ts
export default async (texts: string[]): Promise<number[][]> => { ... }
```

Example: use `@xenova/transformers` for local embeddings, or a thin wrapper around OpenAI.

#### `runNpmTask`

Run an npm script when matched files change.

- **task**: npm script name (e.g. `assets:generate`)
- **debounceMs**: Debounce delay in ms (default: 500)

## Environment

- `QDRANT_URL`: Qdrant server URL for `indexToQdrant`
- `EMBEDDER_MODULE`: Path to embedder module for semantic indexing
