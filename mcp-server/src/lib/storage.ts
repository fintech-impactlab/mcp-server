import { promises as fs } from "node:fs";
import path from "node:path";

import { ToolError, type SourceErrorOptions } from "./errors.js";

const SOURCE = "storage";

export class StorageReadError extends ToolError {
  override readonly name: string = "StorageReadError";
  constructor(message: string, options: SourceErrorOptions = {}) {
    super(message, { ...options, source: SOURCE });
  }
}
export type StorageReadErrorType = InstanceType<typeof StorageReadError>;

export class StorageWriteError extends ToolError {
  override readonly name: string = "StorageWriteError";
  constructor(message: string, options: SourceErrorOptions = {}) {
    super(message, { ...options, source: SOURCE });
  }
}
export type StorageWriteErrorType = InstanceType<typeof StorageWriteError>;

export class StoragePathError extends ToolError {
  override readonly name: string = "StoragePathError";
  constructor(message: string, options: SourceErrorOptions = {}) {
    super(message, { ...options, source: SOURCE });
  }
}
export type StoragePathErrorType = InstanceType<typeof StoragePathError>;

export interface StorageOptions {
  /** Override base directory; defaults to process.env.DATA_DIR or ./data. */
  dataDir?: string;
  /** Override clock for deterministic audit filenames in tests. */
  now?: () => Date;
}

export interface Storage {
  getDataDir(): string;
  readFile(relativePath: string): Promise<Buffer>;
  writeFile(relativePath: string, content: Buffer | string): Promise<void>;
  listFiles(relativeDir: string): Promise<string[]>;
  appendAuditLine(event: Record<string, unknown>): Promise<void>;
}

function defaultDataDir(): string {
  const env = process.env.DATA_DIR;
  if (env !== undefined && env.length > 0) {
    return path.resolve(env);
  }
  return path.resolve(process.cwd(), "data");
}

function resolveSafe(dataDir: string, relativePath: string): string {
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    throw new StoragePathError("relative path must be a non-empty string");
  }
  if (path.isAbsolute(relativePath)) {
    throw new StoragePathError(
      `absolute paths are not allowed: ${relativePath}`,
    );
  }
  const resolved = path.resolve(dataDir, relativePath);
  const root = dataDir.endsWith(path.sep) ? dataDir : dataDir + path.sep;
  if (resolved !== dataDir && !resolved.startsWith(root)) {
    throw new StoragePathError(
      `path escapes data dir: ${relativePath}`,
    );
  }
  return resolved;
}

function utcDateStamp(now: () => Date): string {
  const d = now();
  const yyyy = d.getUTCFullYear().toString().padStart(4, "0");
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = d.getUTCDate().toString().padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function createStorage(options: StorageOptions = {}): Storage {
  const dataDir = path.resolve(options.dataDir ?? defaultDataDir());
  const now = options.now ?? (() => new Date());

  return {
    getDataDir(): string {
      return dataDir;
    },

    async readFile(relativePath: string): Promise<Buffer> {
      const target = resolveSafe(dataDir, relativePath);
      try {
        return await fs.readFile(target);
      } catch (err) {
        throw new StorageReadError(
          `failed to read ${relativePath}`,
          { cause: err },
        );
      }
    },

    async writeFile(
      relativePath: string,
      content: Buffer | string,
    ): Promise<void> {
      const target = resolveSafe(dataDir, relativePath);
      try {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, content);
      } catch (err) {
        throw new StorageWriteError(
          `failed to write ${relativePath}`,
          { cause: err },
        );
      }
    },

    async listFiles(relativeDir: string): Promise<string[]> {
      const target = resolveSafe(dataDir, relativeDir);
      try {
        const entries = await fs.readdir(target, { withFileTypes: true });
        return entries.filter((e) => e.isFile()).map((e) => e.name).sort();
      } catch (err) {
        throw new StorageReadError(
          `failed to list ${relativeDir}`,
          { cause: err },
        );
      }
    },

    async appendAuditLine(event: Record<string, unknown>): Promise<void> {
      const filename = `audit/${utcDateStamp(now)}.jsonl`;
      const target = resolveSafe(dataDir, filename);
      const line = `${JSON.stringify(event)}\n`;
      try {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.appendFile(target, line);
      } catch (err) {
        throw new StorageWriteError(
          `failed to append audit line`,
          { cause: err },
        );
      }
    },
  };
}
