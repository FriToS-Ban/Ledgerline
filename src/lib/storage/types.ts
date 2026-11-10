import type { Readable } from "node:stream";

export interface Storage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** Stream of the object, or null when it does not exist. */
  get(key: string): Promise<Readable | null>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
