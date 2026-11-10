import { describe, expect, it } from "vitest";
import { safeNext } from "../safe-next";

describe("safeNext", () => {
  it("allows local paths", () => {
    expect(safeNext("/queue?x=1")).toBe("/queue?x=1");
  });
  it("rejects external and protocol-relative targets", () => {
    for (const bad of ["//evil.com", "/\\evil.com", "https://evil.com", "evil", "", null, undefined, "/a\\b", "/\nfoo"]) {
      expect(safeNext(bad as string | null)).toBe("/");
    }
  });
});
