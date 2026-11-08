// Background worker (separate process): every 5s, expires offers past their deadline and
// moves outreach on to the next candidate. Run with `npm run worker`.
import "dotenv/config";

import { expireOffers } from "@/server/outreach";

const EVERY_MS = 5000;
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    const n = await expireOffers();
    if (n > 0)
      console.log(`[worker] ${new Date().toISOString()} expired ${n} offer(s)`);
  } catch (err) {
    console.error("[worker] tick failed", err);
  } finally {
    running = false;
  }
}

console.log(`[worker] polling for expired offers every ${EVERY_MS / 1000}s`);
setInterval(tick, EVERY_MS);
void tick();
