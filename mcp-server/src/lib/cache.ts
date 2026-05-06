import type { ContainerClient } from "@azure/storage-blob";

export interface CacheStore {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
}

export interface GetOrSetOptions {
  staleOnError?: boolean;
}

export interface Cache {
  getOrSet<T>(
    key: string,
    ttlSeconds: number,
    fetcher: () => Promise<T>,
    options?: GetOrSetOptions,
  ): Promise<T>;
}

interface Stored<T> {
  value: T;
  fetchedAt: number;
}

export interface CreateCacheOptions {
  store: CacheStore;
  now?: () => number;
}

export function createCache(opts: CreateCacheOptions): Cache {
  const now = opts.now ?? Date.now;
  return {
    async getOrSet<T>(
      key: string,
      ttlSeconds: number,
      fetcher: () => Promise<T>,
      options?: GetOrSetOptions,
    ): Promise<T> {
      const raw = await opts.store.read(key);
      let cached: Stored<T> | null = null;
      if (raw !== null) {
        try {
          const parsed = JSON.parse(raw) as Stored<T>;
          if (
            typeof parsed === "object" &&
            parsed !== null &&
            typeof parsed.fetchedAt === "number"
          ) {
            cached = parsed;
          }
        } catch {
          cached = null;
        }
      }
      if (cached !== null && now() - cached.fetchedAt < ttlSeconds * 1000) {
        return cached.value;
      }
      try {
        const fresh = await fetcher();
        const payload: Stored<T> = { value: fresh, fetchedAt: now() };
        await opts.store.write(key, JSON.stringify(payload));
        return fresh;
      } catch (err) {
        if (cached !== null && options?.staleOnError === true) {
          return cached.value;
        }
        throw err;
      }
    },
  };
}

export function createInMemoryStore(): CacheStore {
  const data = new Map<string, string>();
  return {
    async read(key: string): Promise<string | null> {
      return data.get(key) ?? null;
    },
    async write(key: string, value: string): Promise<void> {
      data.set(key, value);
    },
  };
}

export function createBlobStore(client: ContainerClient): CacheStore {
  return {
    async read(key: string): Promise<string | null> {
      const blob = client.getBlobClient(key);
      try {
        const buf = await blob.downloadToBuffer();
        return buf.toString("utf-8");
      } catch {
        return null;
      }
    },
    async write(key: string, value: string): Promise<void> {
      const block = client.getBlockBlobClient(key);
      const buf = Buffer.from(value, "utf-8");
      await block.upload(buf, buf.byteLength);
    },
  };
}
