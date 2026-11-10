import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";
import { closeDb } from "@/lib/db/client";

describe("GET /api/health", () => {
  it("returns ok when the database answers, and nothing else", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
  it("returns 503 when the database is unreachable", async () => {
    const saved = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgres://x:x@127.0.0.1:1/none";
    try {
      const res = await GET();
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ status: "unavailable" });
    } finally {
      process.env.DATABASE_URL = saved;
      await closeDb();
    }
  });
});
