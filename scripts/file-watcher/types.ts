/**
 * File watcher configuration types.
 * Supports include-all-with-exceptions and file-specific operations.
 */

/** Glob pattern (e.g. "**/*.ts", "docs/**", "src/**/*.tsx") */
export type GlobPattern = string;

/** Base watch configuration - what to watch */
export interface WatchConfig {
  /** Root paths to watch (default: ["."]) */
  base?: string | string[];
  /**
   * Include patterns. Use ["**/*"] for all files, then use exclude for exceptions.
   * Default: ["**/*"] (all files)
   */
  include?: GlobPattern[];
  /** Exclude patterns (always applied after include) */
  exclude?: GlobPattern[];
  /** Ignore initial add events (only react to changes after startup) */
  ignoreInitial?: boolean;
}

/** Event type from chokidar */
export type FileEventType = 'add' | 'change' | 'unlink';

/** Handler for a file event */
export type FileEventHandler = (event: {
  type: FileEventType;
  path: string;
  relativePath: string;
}) => void | Promise<void>;

/** Operation that runs when matched files change */
export interface FileOperation {
  /** Unique name for logging */
  name: string;
  /** Glob patterns - file must match at least one */
  match: GlobPattern[];
  /** Exclude patterns for this operation (optional) */
  exclude?: GlobPattern[];
  /** Operation type - determines handler */
  handler: 'indexToQdrant' | 'runNpmTask' | string;
  /** Handler-specific options */
  options?: Record<string, unknown>;
}

/** Options for indexToQdrant handler */
export interface IndexToQdrantOptions {
  /** Qdrant server URL (default: from QDRANT_URL env or http://localhost:6333) */
  url?: string;
  /** Collection name (default: "codebase") */
  collection?: string;
  /** Embedding dimension (required if creating collection) */
  vectorSize?: number;
  /** Custom embedding function - path to module or "default" for placeholder */
  embedder?: string;
}

/** Options for runNpmTask handler */
export interface RunNpmTaskOptions {
  /** npm script name (e.g. "assets:generate") */
  task: string;
  /** Debounce delay in ms (default: 500) */
  debounceMs?: number;
}

/** Full watcher configuration */
export interface FileWatcherConfig {
  watch: WatchConfig;
  operations: FileOperation[];
}
