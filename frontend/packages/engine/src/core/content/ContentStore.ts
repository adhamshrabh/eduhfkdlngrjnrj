/**
 * core/content/ContentStore.ts
 *
 * Browser-resident content storage — the layer that lets EduStudio work
 * without a dev server behind it.
 *
 * WHY IndexedDB AND NOT LocalOverrides:
 * LocalOverrides (same folder) already established the rule this file
 * extends — "the browser's copy wins over the file on disk" — and both
 * loaders already honour it. What it cannot do is be the PRIMARY store:
 * it is localStorage, so it is string-only and capped around 5 MB, while
 * a single background image in this project is 1.4 MB. IndexedDB has no
 * practical size limit and stores Blobs natively, which is what makes it
 * viable for real authored content including assets.
 *
 * Relationship to the two existing sources, highest priority first:
 *
 *   1. ContentStore  (here)          — what the author saved in THIS browser
 *   2. LocalOverrides                — legacy fallback, kept for content
 *                                      saved before this existed
 *   3. /content/stories/… on disk    — shipped content, and whatever the
 *                                      dev server wrote
 *
 * FAILURE POLICY, matching SchemaValidator and LocalOverrides: never
 * throw. A browser in private mode, with storage disabled, or out of
 * quota must degrade to "no stored content" rather than take the app
 * down — the disk copy is still there.
 */

const DB_NAME = "edustudio";
const DB_VERSION = 1;

/** story.json / layout.json, keyed `${storyId}/${fileName}`. */
const DOCUMENTS = "documents";
/** Binary assets, keyed `${storyId}/${path}`. Written by a later step;
 *  the store is created now so adding it needs no version migration. */
const ASSETS = "assets";

interface DocumentRecord {
  key: string;
  storyId: string;
  fileName: string;
  data: unknown;
  savedAt: number;
}

interface AssetRecord {
  key: string;
  storyId: string;
  path: string;
  blob: Blob;
  savedAt: number;
}

function docKey(storyId: string, fileName: string): string {
  return `${storyId}/${fileName}`;
}

/** Wraps an IDBRequest as a promise. */
function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export class ContentStore {
  private static dbPromise: Promise<IDBDatabase> | null = null;

  /** True when this browser can store content at all. Checked before the
   *  UI promises persistence, so a private-mode session is told the
   *  truth instead of silently losing work. */
  static isAvailable(): boolean {
    try {
      return typeof indexedDB !== "undefined";
    } catch {
      return false;
    }
  }

  /** Opens (and on first use creates) the database. Cached — repeated
   *  calls share one connection. */
  private static open(): Promise<IDBDatabase> {
    if (ContentStore.dbPromise) return ContentStore.dbPromise;

    ContentStore.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(DOCUMENTS)) {
          const store = db.createObjectStore(DOCUMENTS, { keyPath: "key" });
          // Lets listStories()/deleteStory() work on one story without
          // scanning every document in the database.
          store.createIndex("storyId", "storyId", { unique: false });
        }
        if (!db.objectStoreNames.contains(ASSETS)) {
          const store = db.createObjectStore(ASSETS, { keyPath: "key" });
          store.createIndex("storyId", "storyId", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    // A failed open must not poison every later call with the same
    // rejected promise — drop it so the next attempt can retry.
    ContentStore.dbPromise.catch(() => {
      ContentStore.dbPromise = null;
    });

    return ContentStore.dbPromise;
  }

  private static async tx<T>(
    storeName: string,
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => Promise<T>
  ): Promise<T | null> {
    if (!ContentStore.isAvailable()) return null;
    try {
      const db = await ContentStore.open();
      const transaction = db.transaction(storeName, mode);
      const result = await run(transaction.objectStore(storeName));
      // Wait for the transaction itself, not just the request: a write
      // is only durable once the transaction completes.
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      return result;
    } catch (err) {
      console.warn(`[ContentStore] ${mode} on "${storeName}" failed:`, err);
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Documents
  // -------------------------------------------------------------------------

  /** Persist story.json / layout.json for a story. */
  static async saveDocument(storyId: string, fileName: string, data: unknown): Promise<boolean> {
    const record: DocumentRecord = {
      key: docKey(storyId, fileName),
      storyId,
      fileName,
      data,
      savedAt: Date.now()
    };
    const result = await ContentStore.tx(DOCUMENTS, "readwrite", (store) =>
      promisify(store.put(record))
    );
    return result !== null;
  }

  /** Read a stored document, or null when this browser has none. */
  static async getDocument<T = unknown>(storyId: string, fileName: string): Promise<T | null> {
    const record = await ContentStore.tx(DOCUMENTS, "readonly", (store) =>
      promisify<DocumentRecord | undefined>(store.get(docKey(storyId, fileName)))
    );
    return (record?.data as T) ?? null;
  }

  /** When a document was last saved here — used to spot a stale browser
   *  copy shadowing a newer file on disk, the same problem
   *  LocalOverrides.savedAt() exists to diagnose. */
  static async savedAt(storyId: string, fileName: string): Promise<Date | null> {
    const record = await ContentStore.tx(DOCUMENTS, "readonly", (store) =>
      promisify<DocumentRecord | undefined>(store.get(docKey(storyId, fileName)))
    );
    return record ? new Date(record.savedAt) : null;
  }

  /**
   * Every story id held in this browser. This is what makes a story
   * created here discoverable at all — the disk index.json cannot list
   * it, because nothing ever wrote it to disk.
   */
  static async listStories(): Promise<string[]> {
    // getAll() on the index, NOT getAllKeys(): the latter returns each
    // record's PRIMARY key ("idb_test/story.json"), which would surface
    // every document as if it were its own story. The index values are
    // what carry the story id.
    const records = await ContentStore.tx(DOCUMENTS, "readonly", (store) =>
      promisify<DocumentRecord[]>(store.index("storyId").getAll())
    );
    if (!records) return [];
    return Array.from(new Set(records.map((r) => r.storyId)));
  }

  /** Remove a story's documents and assets from this browser. Mirrors
   *  the dev server's delete-story route so both stay in step. */
  static async deleteStory(storyId: string): Promise<void> {
    for (const storeName of [DOCUMENTS, ASSETS]) {
      await ContentStore.tx(storeName, "readwrite", async (store) => {
        const keys = await promisify<IDBValidKey[]>(store.index("storyId").getAllKeys(storyId));
        for (const key of keys) store.delete(key);
      });
    }
  }

  // -------------------------------------------------------------------------
  // Assets (store created now; wired into loading in the next step)
  // -------------------------------------------------------------------------

  /** Persist one binary asset under its story-relative path. */
  static async saveAsset(storyId: string, path: string, blob: Blob): Promise<boolean> {
    const record: AssetRecord = { key: `${storyId}/${path}`, storyId, path, blob, savedAt: Date.now() };
    const result = await ContentStore.tx(ASSETS, "readwrite", (store) => promisify(store.put(record)));
    return result !== null;
  }

  /** Drop one asset from this browser. A path that was never stored is
   *  not an error — the caller's goal is "it is gone", and it already is. */
  static async deleteAsset(storyId: string, path: string): Promise<void> {
    await ContentStore.tx(ASSETS, "readwrite", (store) => promisify(store.delete(`${storyId}/${path}`)));
  }

  static async getAsset(storyId: string, path: string): Promise<Blob | null> {
    const record = await ContentStore.tx(ASSETS, "readonly", (store) =>
      promisify<AssetRecord | undefined>(store.get(`${storyId}/${path}`))
    );
    return record?.blob ?? null;
  }

  /** How much this browser is holding, for a storage indicator in the UI. */
  static async usage(): Promise<{ quota: number; usage: number } | null> {
    try {
      if (!navigator.storage?.estimate) return null;
      const { quota = 0, usage = 0 } = await navigator.storage.estimate();
      return { quota, usage };
    } catch {
      return null;
    }
  }

  /** Test seam — drops the cached connection so a suite can start clean. */
  static resetConnection(): void {
    ContentStore.dbPromise = null;
  }
}
