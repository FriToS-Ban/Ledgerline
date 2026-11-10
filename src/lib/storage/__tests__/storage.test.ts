import { describe, expect, it } from "vitest";
import { buildKey, keyBelongsToOrg, sanitizeFilename } from "../keys";
import { getStorage, readAll } from "..";
import { saveUpload, UploadRejected } from "@/lib/extract/save-upload";

describe("storage keys", () => {
  it("builds org/<orgId>/<uuid>-<name>", () => {
    expect(buildKey("org1", "inv.pdf")).toMatch(/^org\/org1\/[0-9a-f-]{36}-inv\.pdf$/);
  });
  it("sanitizes separators, traversal, odd characters and length", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename(String.raw`C:\x\y\bill one.pdf`)).toBe("bill_one.pdf");
    expect(sanitizeFilename("..")).toBe("file");
    expect(sanitizeFilename(undefined)).toBe("file");
    const long = sanitizeFilename("a".repeat(500) + ".pdf");
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith(".pdf")).toBe(true);
    expect(sanitizeFilename("x/y")).not.toContain("/");
  });
  it("checks org ownership of a key", () => {
    expect(keyBelongsToOrg("org/a/u-x.pdf", "a")).toBe(true);
    expect(keyBelongsToOrg("org/a/u-x.pdf", "b")).toBe(false);
    expect(keyBelongsToOrg("org/a/../b/x.pdf", "a")).toBe(false);
    expect(keyBelongsToOrg("org/a/sub/x.pdf", "a")).toBe(false);
    expect(keyBelongsToOrg("/demos/x.pdf", "a")).toBe(false);
  });
});

describe("saveUpload + memory storage", () => {
  const pdf = new TextEncoder().encode("%PDF-1.4 hello");
  it("round-trips through storage under the org prefix", async () => {
    const key = await saveUpload({ orgId: "o1", filename: "My Bill.PDF", bytes: pdf });
    expect(key).toMatch(/^org\/o1\/.+-My_Bill\.pdf$/);
    const s = getStorage();
    expect(await s.exists(key)).toBe(true);
    expect(new TextDecoder().decode(await readAll((await s.get(key))!))).toBe("%PDF-1.4 hello");
    await s.delete(key);
    expect(await s.exists(key)).toBe(false);
    expect(await s.get(key)).toBeNull();
  });
  it("rejects oversized and non-PDF/image uploads", async () => {
    await expect(saveUpload({ orgId: "o1", filename: "a.pdf", bytes: new Uint8Array(15 * 1024 * 1024 + 1) })).rejects.toBeInstanceOf(UploadRejected);
    await expect(saveUpload({ orgId: "o1", filename: "a.html", bytes: new TextEncoder().encode("<script>") })).rejects.toMatchObject({ status: 415 });
  });
});
