import type { CacheEntry, CacheIndex } from "./types";

const CACHE_PREFIX = "paperlens_cache_";
const INDEX_KEY = "paperlens_cache_index";
const MAX_CACHE_BYTES = 10 * 1024 * 1024; // 10 MB
const EVICT_TARGET_BYTES = 8 * 1024 * 1024; // 8 MB

// Simple async mutex for cache operations
let cacheLock: Promise<void> = Promise.resolve();

function withCacheLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = cacheLock;
  let resolve: () => void;
  cacheLock = new Promise<void>((r) => { resolve = r; });
  return prev.then(fn).finally(() => resolve!());
}

export async function hashText(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function getIndex(): Promise<CacheIndex> {
  const raw = await chrome.storage.local.get([INDEX_KEY]);
  return raw[INDEX_KEY] ?? { entries: [] };
}

async function setIndex(index: CacheIndex): Promise<void> {
  await chrome.storage.local.set({ [INDEX_KEY]: index });
}

export async function getCached(hash: string): Promise<CacheEntry | null> {
  return withCacheLock(async () => {
    const key = CACHE_PREFIX + hash;
    const raw = await chrome.storage.local.get([key]);
    const entry = raw[key] as CacheEntry | undefined;
    if (!entry) return null;

    // Touch timestamp (LRU)
    entry.timestamp = Date.now();
    await chrome.storage.local.set({ [key]: entry });

    const index = await getIndex();
    const idx = index.entries.findIndex((e) => e.hash === hash);
    if (idx >= 0) {
      index.entries[idx].timestamp = entry.timestamp;
      await setIndex(index);
    }

    return entry;
  });
}

export async function putCached(entry: CacheEntry): Promise<void> {
  return withCacheLock(async () => {
    const key = CACHE_PREFIX + entry.hash;
    entry.timestamp = Date.now();
    entry.size = new TextEncoder().encode(JSON.stringify(entry)).byteLength;

    await chrome.storage.local.set({ [key]: entry });

    const index = await getIndex();
    const existing = index.entries.findIndex((e) => e.hash === entry.hash);
    if (existing >= 0) {
      index.entries[existing] = { hash: entry.hash, timestamp: entry.timestamp, size: entry.size };
    } else {
      index.entries.push({ hash: entry.hash, timestamp: entry.timestamp, size: entry.size });
    }

    // Evict if over limit
    const totalSize = index.entries.reduce((sum, e) => sum + e.size, 0);
    if (totalSize > MAX_CACHE_BYTES) {
      index.entries.sort((a, b) => a.timestamp - b.timestamp);
      const keysToRemove: string[] = [];
      let running = totalSize;
      while (running > EVICT_TARGET_BYTES && index.entries.length > 0) {
        const evicted = index.entries.shift()!;
        keysToRemove.push(CACHE_PREFIX + evicted.hash);
        running -= evicted.size;
      }
      if (keysToRemove.length > 0) {
        await chrome.storage.local.remove(keysToRemove);
      }
    }

    await setIndex(index);
  });
}

export async function clearCache(): Promise<void> {
  return withCacheLock(async () => {
    const index = await getIndex();
    const keys = index.entries.map((e) => CACHE_PREFIX + e.hash);
    keys.push(INDEX_KEY);
    await chrome.storage.local.remove(keys);
  });
}
