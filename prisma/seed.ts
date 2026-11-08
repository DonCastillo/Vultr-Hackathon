// Seeds the demo database. Run with `pnpm db:seed` (or `npx prisma migrate reset`,
// which re-runs migrations and then this script). It wipes all app data first, so it is
// safe to run repeatedly.

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../server/generated/prisma/client";
import { seedCrew } from "./seed/crew";
import { seedStore, TIMEZONE } from "./seed/store";
import { todayIn, zoned } from "./seed/time";

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

/**
 * Node (bundled ICU) and Postgres (system tzdata) must agree on the store's UTC offset,
 * or every local time the app computes is off. Alberta moved to permanent UTC-6 on
 * 2026-11-01; Node builds with tz data older than that still use UTC-7.
 */
async function checkTimezoneData() {
  const today = todayIn(TIMEZONE);
  const fromNode = zoned(today, "12:00", TIMEZONE);
  const [{ t: fromDb }] = await db.$queryRaw<{ t: Date }[]>`
    SELECT ((${today} || ' 12:00')::timestamp AT TIME ZONE ${TIMEZONE}) AS t`;
  if (fromNode.getTime() !== fromDb.getTime()) {
    throw new Error(
      `Timezone data mismatch for ${TIMEZONE}: Node says noon is ${fromNode.toISOString()}, ` +
        `Postgres says ${fromDb.toISOString()}. Node ${process.version} has tz data ` +
        `${process.versions.tz}; use Node 24.22+ or 26.13+ ("nvm install 24", see .nvmrc).`,
    );
  }
}

async function main() {
  await checkTimezoneData();
  await wipe();
  const { store, stations, counts } = await seedStore(db);
  console.log(`Seeded ${store.name} (${store.timezone}):`, counts);

  const crew = await seedCrew(db, store.id, store.timezone, stations);
  console.log("Seeded crew:", crew.counts);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
