import type { Readable } from "node:stream";
import { MemoryStorage } from "./memory";
import { S3Storage } from "./s3";
import type { Storage } from "./types";

export type { Storage } from "./types";
export { buildKey, keyBelongsToOrg, sanitizeFilename } from "./keys";

const g = globalThis as unknown as { __storage?: Storage };

/** STORAGE_DRIVER=memory selects the in-memory fake (tests); anything else is S3/MinIO. */
export function getStorage(): Storage {
  return (g.__storage ??= process.env.STORAGE_DRIVER === "memory" ? new MemoryStorage() : new S3Storage());
}

export async function readAll(stream: Readable): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return new Uint8Array(Buffer.concat(chunks));
}
