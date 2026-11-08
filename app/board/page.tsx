import type { Metadata } from "next";
import Link from "next/link";

import { LabourPanel } from "@/components/board/labour-panel";
import { humanizeTimes, to12h } from "@/lib/time-format";
import { buttonVariants } from "@/components/ui/button";
import { getBoardView } from "@/server/views";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Station board · CrewShift" };

const SLOT_PX = 12; // one 15-minute slot
const LANE_PX = 26;

const clock = (minutes: number) => {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date } = await searchParams;
  const view = await getBoardView(date);
  const px = (minutes: number) => ((minutes - view.windowStart) / 15) * SLOT_PX;
  const width = px(view.windowEnd);
  const hours = Array.from(
    { length: (view.windowEnd - view.windowStart) / 60 },
    (_, i) => view.windowStart + i * 60,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">
            Station board · {view.label}
          </h1>
          <p className="text-sm text-muted-foreground">
            Who is on which station, against the coverage template (green
            covered, red short).
          </p>
        </div>
        <div className="flex gap-1">
          <Link
            className={buttonVariants({ variant: "outline", size: "sm" })}
            href={`/board?date=${view.prevDate}`}
          >
            ← Prev
          </Link>
          <Link
            className={buttonVariants({ variant: "outline", size: "sm" })}
            href={`/board?date=${view.today}`}
          >
            Today
          </Link>
          <Link
            className={buttonVariants({ variant: "outline", size: "sm" })}
            href={`/board?date=${view.nextDate}`}
          >
            Next →
          </Link>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <div className="flex" style={{ minWidth: width + 160 }}>
          {/* Station names */}
          <div className="sticky left-0 z-10 w-40 shrink-0 border-r bg-card">
            <div className="h-7 border-b" />
            {view.stations.map((st) => (
              <div
                key={st.id}
                className="flex flex-col justify-center border-b px-2"
                style={{ height: Math.max(1, st.lanes.length) * LANE_PX + 12 }}
              >
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <span
                    className="size-2.5 rounded-full"
                    style={{ background: st.color }}
                  />
                  {st.shortCode}
                </div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {st.name}
                </div>
              </div>
            ))}
          </div>

          {/* Timeline */}
          <div className="relative" style={{ width }}>
            <div className="relative h-7 border-b">
              {hours.map((h) => (
                <div
                  key={h}
                  className="absolute top-0 h-full border-l pl-1 text-[11px] text-muted-foreground"
                  style={{ left: px(h) }}
                >
                  {to12h(clock(h))}
                </div>
              ))}
            </div>
            {view.stations.map((st) => (
              <div
                key={st.id}
                className="relative border-b"
                style={{ height: Math.max(1, st.lanes.length) * LANE_PX + 12 }}
              >
                {hours.map((h) => (
                  <div
                    key={h}
                    className="absolute top-0 h-full border-l border-dashed opacity-50"
                    style={{ left: px(h) }}
                  />
                ))}
                {st.lanes.map((lane, li) =>
                  lane.map((b) => (
                    <div
                      key={`${b.shiftId}-${b.start}`}
                      title={`${b.crewName} ${humanizeTimes(b.label)}${b.calledOut ? " (called out)" : ""}${b.inactive ? " (inactive: reassign)" : ""}`}
                      className={`absolute flex items-center overflow-hidden rounded px-1.5 text-xs font-medium text-white shadow-sm ${b.calledOut ? "line-through opacity-40" : ""} ${b.inactive ? "outline-2 outline-offset-[-2px] outline-white outline-dashed" : ""}`}
                      style={{
                        left: px(b.start) + 1,
                        width: Math.max(px(b.end) - px(b.start) - 2, 4),
                        top: li * LANE_PX + 2,
                        height: LANE_PX - 4,
                        background: st.color,
                      }}
                    >
                      <span className="truncate">
                        {b.crewName}
                        {b.inactive && " (inactive)"}
                      </span>
                    </div>
                  )),
                )}
                {/* Coverage heatmap */}
                <div className="absolute right-0 bottom-0 left-0 h-2.5">
                  {st.slots
                    .filter((s) => s.required > 0)
                    .map((s) => {
                      const short = s.scheduled < s.required;
                      return (
                        <div
                          key={s.start}
                          title={`${to12h(clock(s.start))} ${s.scheduled}/${s.required}${short ? " short" : ""}`}
                          className={`absolute h-full ${short ? (s.scheduled === 0 ? "bg-red-600" : "bg-red-400") : "bg-emerald-500"}`}
                          style={{ left: px(s.start), width: SLOT_PX - 1 }}
                        />
                      );
                    })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border bg-card p-4">
          <h2 className="mb-2 font-semibold">Coverage check</h2>
          {view.shortfalls.length === 0 && view.supervisorGaps.length === 0 ? (
            <p className="text-sm text-emerald-700">
              Every station meets the coverage template.
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {view.supervisorGaps.map((g) => (
                <li key={g} className="text-destructive">
                  No supervisor on the floor {humanizeTimes(g)}
                </li>
              ))}
              {view.shortfalls.map((s) => (
                <li key={`${s.stationName}-${s.range}`}>
                  <span className="font-medium text-destructive">
                    Short {s.missing}
                  </span>{" "}
                  · {s.stationName} {humanizeTimes(s.range)}
                </li>
              ))}
            </ul>
          )}
        </section>
        <LabourPanel dayparts={view.dayparts} />
      </div>
    </div>
  );
}
