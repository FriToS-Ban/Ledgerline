import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDb, getDb } from "../src/lib/db/client";

export async function runMigrations() {
  await migrate(getDb(), { migrationsFolder: path.join(process.cwd(), "drizzle") });
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/migrate.ts")) {
  runMigrations()
    .then(() => console.log("migrations applied"))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
