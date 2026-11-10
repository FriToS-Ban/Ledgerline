import { afterAll } from "vitest";
import { closeDb } from "@/lib/db/client";
import { createTestDatabase } from "./pg";

// Every test file gets its own migrated Postgres database; the app client reads DATABASE_URL lazily.
process.env.STORAGE_DRIVER = "memory"; // no MinIO needed in unit tests
const db = await createTestDatabase();
process.env.DATABASE_URL = db.url;

afterAll(async () => {
  await closeDb();
  await db.drop();
});
