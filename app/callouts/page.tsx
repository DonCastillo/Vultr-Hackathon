import type { Metadata } from "next";
import Link from "next/link";

import { StatusPill } from "@/components/callouts/status-pill";
import { LiveRefresh } from "@/components/live-refresh";
import { humanizeTimes } from "@/lib/time-format";
import { getCallOutList } from "@/server/callout-views";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Call-outs · CrewShift" };

export default async function CallOutsPage() {
  const list = await getCallOutList();
  return (
    <div className="space-y-4">
      <LiveRefresh everyMs={4000} />
      <div>
        <h1 className="text-xl font-semibold">Call-outs</h1>
        <p className="text-sm text-muted-foreground">
          A crew member texts in sick (try it on the Phone sim), or the manager
          marks a shift called out from the schedule. The agent plans the
          recovery; you approve it.
        </p>
      </div>
      {list.length === 0 ? (
        <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          No call-outs yet. On{" "}
          <Link className="text-primary underline" href="/sim">
            Phone sim
          </Link>
          , text the store from Kayla&apos;s phone: &ldquo;sick, can&apos;t make
          my 5:30 tomorrow&rdquo;.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {list.map((c) => (
            <li key={c.id}>
              <Link
                href={`/callouts/${c.id}`}
                className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-muted/50"
              >
                <StatusPill status={c.status} />
                <span className="font-medium">{c.crew}</span>
                <span className="text-sm text-muted-foreground">
                  {humanizeTimes(c.shift)}
                </span>
                {c.reason && <span className="text-sm">· {c.reason}</span>}
                <span className="ml-auto text-xs text-muted-foreground">
                  {c.source === "SMS" ? "texted" : "marked by manager"} at{" "}
                  {c.created}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
