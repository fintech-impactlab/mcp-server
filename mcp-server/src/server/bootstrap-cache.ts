import { DefaultAzureCredential } from "@azure/identity";
import { ContainerClient } from "@azure/storage-blob";

import { createBlobStore, createCache, createInMemoryStore, type Cache } from "../lib/cache.js";
import { logger } from "../lib/logging.js";

export type BootstrapCacheEnv = Record<string, string | undefined>;

const DEFAULT_CACHE_CONTAINER = "audit";

export function bootstrapCache(env: BootstrapCacheEnv = process.env): Cache {
  const accountName = env["AZURE_STORAGE_ACCOUNT_NAME"];
  const containerName = env["AZURE_STORAGE_CACHE_CONTAINER"] ?? DEFAULT_CACHE_CONTAINER;

  if (typeof accountName !== "string" || accountName.length === 0) {
    logger.event(
      "server.cache_using_in_memory",
      { reason: "AZURE_STORAGE_ACCOUNT_NAME unset" },
      "warn",
    );
    return createCache({ store: createInMemoryStore() });
  }

  const url = `https://${accountName}.blob.core.windows.net/${containerName}`;
  const containerClient = new ContainerClient(url, new DefaultAzureCredential());
  logger.event("server.cache_using_blob", { account: accountName, container: containerName });
  return createCache({ store: createBlobStore(containerClient) });
}
