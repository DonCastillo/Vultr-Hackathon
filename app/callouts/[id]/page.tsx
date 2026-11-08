import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ApprovePanel } from "@/components/callouts/approve-panel";
import { StatusPill } from "@/components/callouts/status-pill";
import { LiveRefresh } from "@/components/live-refresh";
import { humanizeTimes } from "@/lib/time-format";
import { getCallOutView } from "@/server/callout-views";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Call-out · CrewShift" };

const KIND: Record<string, string> = {
  CALL_IN: "Call in",
  EXTEND: "Extend shift",
};

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2 rounded-lg border bg-card p-4">
      <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

function describe(type: string, p: Record<string, unknown>): string {
  const s = (v: unknown): string =>
    typeof v === "string"
      ? humanizeTimes(v)
      : Array.isArray(v)
        ? `${v.length} item${v.length === 1 ? "" : "s"}`
        : v && typeof v === "object"
          ? "{…}"
          : String(v);
  if (p.summary) return s(p.summary);
  if (p.body) return s(p.body);
  if (p.reason) return s(p.reason);
  if (p.intent) return `Reply read as ${s(p.intent)}`;
  const keys = Object.keys(p);
  return keys.length
    ? keys
        .map((k) => `${k}: ${s(p[k])}`)
        .join(" · ")
        .slice(0, 200)
    : type;
}

export default async function CallOutPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const v = await getCallOutView(id);
  if (!v) notFound();
  const live =
    v.status === "OUTREACH" || v.status === "PLANNED" || v.status === "OPEN";

  return (
    <div className="space-y-4">
      {live && <LiveRefresh />}
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/callouts"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Call-outs
        </Link>
        <h1 className="text-xl font-semibold">
          {v.crew} called out · {humanizeTimes(v.shift)}
        </h1>
        <StatusPill status={v.status} />
      </div>
      <p className="text-sm text-muted-foreground">
        {v.source === "SMS" ? "Texted in" : "Marked by the manager"}
        {v.reason ? ` · ${v.reason}` : ""}
        {v.rawText ? ` · “${v.rawText}”` : ""} · stations:{" "}
        {v.shiftStations.map(humanizeTimes).join(", ")}
      </p>

      {v.summary && (
        <div className="rounded-lg border bg-accent/30 p-4">
          <p className="text-sm">{humanizeTimes(v.summary)}</p>
          {v.llm && (
            <p className="mt-1 text-xs text-muted-foreground">
              Summary written by {v.llm}
            </p>
          )}
        </div>
      )}

      {v.status === "PLANNED" && (
        <ApprovePanel callOutId={v.id} hasOvertime={v.hasOvertime} />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Coverage gaps">
          {v.gaps.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No station drops below its minimum.
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {v.gaps.map((g, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span
                    className="size-2.5 rounded-full"
                    style={{ background: g.color }}
                  />
                  <span className="font-medium">{g.station}</span>{" "}
                  {humanizeTimes(g.range)}
                  <span className="text-muted-foreground">({g.detail})</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title={`Plan A · rebalance crew on shift${v.applied ? " (applied)" : ""}`}
        >
          {v.moves.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No safe station moves.
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {v.moves.map((m, i) => (
                <li key={i}>
                  <span className="font-medium">{m.crew}</span>: {m.from} →{" "}
                  {m.to}, {humanizeTimes(m.range)}
                </li>
              ))}
            </ul>
          )}
          {v.remaining.length > 0 && (
            <p className="text-sm text-muted-foreground">
              Still short:{" "}
              {v.remaining
                .map((g) => `${g.station} ${humanizeTimes(g.range)}`)
                .join("; ")}
            </p>
          )}
        </Section>
      </div>

      <Section title="Plan B · off-duty crew, ranked">
        {v.candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody to call in.</p>
        ) : (
          <ol className="space-y-2 text-sm">
            {v.candidates.map((c, i) => (
              <li key={`${c.crewId}-${i}`} className="rounded-md border p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">
                    {i + 1}. {c.name}
                  </span>
                  <span>
                    {KIND[c.kind] ?? c.kind} · {c.station}{" "}
                    {humanizeTimes(c.range)}
                  </span>
                  {c.isOvertime && (
                    <span className="rounded bg-orange-100 px-1.5 text-xs font-semibold text-orange-900">
                      Overtime +{c.addedOtHours}h
                    </span>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    score {c.score.toFixed(1)}
                  </span>
                </div>
                <p className="mt-1 text-muted-foreground">
                  {humanizeTimes(c.rationale)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Section>

      {v.offers.length > 0 && (
        <Section title="Offers · one at a time">
          <ul className="space-y-1 text-sm">
            {v.offers.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-2">
                <StatusPill status={o.status} />
                <span className="font-medium">{o.crew}</span>
                <span>
                  {KIND[o.kind] ?? o.kind} · {o.station}{" "}
                  {humanizeTimes(o.range)}
                </span>
                {o.isOvertime && (
                  <span className="text-xs text-orange-800">OT</span>
                )}
                {o.status === "SENT" && o.expiresAt && (
                  <span className="text-xs text-muted-foreground">
                    expires{" "}
                    {new Date(o.expiresAt).toLocaleTimeString("en-US", {
                      timeZone: "America/Edmonton",
                    })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Agent timeline (audit)">
          <ol className="space-y-1 text-sm">
            {v.timeline.map((e) => (
              <li key={e.id} className="grid grid-cols-[5.5rem_1fr] gap-2">
                <span className="text-xs text-muted-foreground tabular-nums">
                  {e.at}
                </span>
                <span>
                  <code className="rounded bg-muted px-1 text-xs">
                    {e.type}
                  </code>{" "}
                  <span className="text-xs text-muted-foreground">
                    {e.actor}
                  </span>{" "}
                  <span className="break-words">
                    {describe(e.type, e.payload ?? {})}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </Section>
        <Section title="Texts">
          {v.messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No texts yet.</p>
          ) : (
            <ol className="space-y-1 text-sm">
              {v.messages.map((m) => (
                <li key={m.id} className="grid grid-cols-[5.5rem_1fr] gap-2">
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {m.at}
                  </span>
                  <span>
                    <span className="font-medium">
                      {m.direction === "INBOUND" ? `${m.who} →` : `→ ${m.who}`}
                    </span>{" "}
                    {m.body}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Section>
      </div>
    </div>
  );
}
