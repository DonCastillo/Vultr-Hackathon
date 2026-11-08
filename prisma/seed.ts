// Seeds the demo database. Run with `pnpm db:seed` (or `npx prisma migrate reset`,
// which re-runs migrations and then this script). It wipes all app data first, so it is
// safe to run repeatedly.

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../server/generated/prisma/client";
import { seedStore } from "./seed/store";

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

/** Empties every app table (keeps Prisma's migration history). */
async function wipe() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"${t.tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE`);
}

async function main() {
  await wipe();
  const { store, counts } = await seedStore(db);
  console.log(`Seeded ${store.name} (${store.timezone}):`, counts);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
