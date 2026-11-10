import { Readable } from "node:stream";
import type { Storage } from "./types";

/** In-process storage for tests (STORAGE_DRIVER=memory). */
export class MemoryStorage implements Storage {
  readonly objects = new Map<string, { body: Uint8Array; contentType: string }>();
  async put(key: string, body: Uint8Array, contentType: string) {
    this.objects.set(key, { body: new Uint8Array(body), contentType });
  }
  async get(key: string) {
    const o = this.objects.get(key);
    return o ? Readable.from([Buffer.from(o.body)]) : null;
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
  async exists(key: string) {
    return this.objects.has(key);
  }
}
