/**
 * Index file content to Qdrant for semantic search.
 *
 * Environment variables (see .continue/rules/system.md for service endpoints):
 *   QDRANT_URL      - Qdrant server URL (default: http://localhost:6333)
 *                     e.g. http://192.168.8.199:6333
 *   EMBEDDER_MODULE - Path to embedder module; placeholder used if unset.
 *                     Module must export: async (texts: string[]) => number[][]
 *
 * Example embedders: OpenAI, Ollama, @xenova/transformers, etc.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { QdrantClient } from '@qdrant/js-client-rest';
import type { IndexToQdrantOptions } from '../types';

const DEFAULT_VECTOR_SIZE = 384; // common for smaller models e.g. all-MiniLM-L6-v2
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 100;

/** Placeholder embedder when none configured - returns zero vectors. Logs warning. */
async function placeholderEmbed(texts: string[]): Promise<number[][]> {
  console.warn(
    '[file-watcher] No embedder configured. Set EMBEDDER_MODULE env to a module path that exports: async (texts: string[]) => number[][]'
  );
  return texts.map(() => Array(DEFAULT_VECTOR_SIZE).fill(0));
}

let embedderFn: ((texts: string[]) => Promise<number[][]>) | null = null;

async function getEmbedder(): Promise<(texts: string[]) => Promise<number[][]>> {
  if (embedderFn) return embedderFn;
  const modulePath = process.env.EMBEDDER_MODULE;
  if (modulePath) {
    try {
      const mod = await import(modulePath);
      embedderFn = mod.default ?? mod.embed;
      if (typeof embedderFn !== 'function') throw new Error('Embedder must export default or embed function');
      return embedderFn;
    } catch (e) {
      console.error('[file-watcher] Failed to load embedder module:', e);
    }
  }
  return placeholderEmbed;
}

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    chunks.push(text.slice(start, end));
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks.length ? chunks : [''];
}

function hashId(seed: string): string {
  return crypto.createHash('sha256').update(seed).digest('hex').slice(0, 36);
}

export async function indexToQdrant(
  paths: string[],
  eventType: 'add' | 'change' | 'unlink',
  options: IndexToQdrantOptions,
  projectRoot: string
): Promise<void> {
  const url = options.url || process.env.QDRANT_URL || 'http://localhost:6333';
  const collection = options.collection || 'codebase';
  const vectorSize = options.vectorSize ?? DEFAULT_VECTOR_SIZE;

  const client = new QdrantClient({ url });

  for (const p of paths) {
    const absolutePath = path.isAbsolute(p) ? p : path.join(projectRoot, p);
    const relativePath = path.relative(projectRoot, absolutePath).split(path.sep).join('/');

    if (eventType === 'unlink') {
      try {
        await client.delete(collection, {
          filter: {
            must: [{ key: 'source', match: { value: relativePath } }],
          },
        });
        console.log(`[file-watcher] Deleted from index: ${relativePath}`);
      } catch (e) {
        console.error(`[file-watcher] Failed to delete ${relativePath} from Qdrant:`, e);
      }
      continue;
    }

    let content: string;
    try {
      content = fs.readFileSync(absolutePath, 'utf-8');
    } catch (e) {
      console.error(`[file-watcher] Failed to read ${relativePath}:`, e);
      continue;
    }

    const chunks = chunkText(content);
    const embedder = await getEmbedder();
    const vectors = await embedder(chunks);

    if (vectors.some((v) => v.length !== vectorSize)) {
      console.warn(`[file-watcher] Embedder returned wrong vector size for ${relativePath}, expected ${vectorSize}`);
      continue;
    }

    const points = chunks.map((chunk, i) => ({
      id: hashId(`${relativePath}:${i}`),
      vector: vectors[i],
      payload: {
        source: relativePath,
        content: chunk,
        chunk_index: i,
      },
    }));

    try {
      const exists = await client.collectionExists(collection);
      if (!exists.exists) {
        await client.createCollection(collection, {
          vectors: { size: vectorSize, distance: 'Cosine' },
        });
      }

      await client.upsert(collection, {
        wait: true,
        points,
      });
      console.log(`[file-watcher] Indexed ${relativePath} (${chunks.length} chunks)`);
    } catch (e) {
      console.error(`[file-watcher] Failed to index ${relativePath}:`, e);
    }
  }
}
