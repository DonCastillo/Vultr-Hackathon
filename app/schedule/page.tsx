import type { Metadata } from "next";
import Link from "next/link";

import { AutofillButton } from "@/components/schedule/autofill-button";
import { WeekGrid } from "@/components/schedule/week-grid";
import { buttonVariants } from "@/components/ui/button";
import { getWeekView } from "@/server/views";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Schedule · CrewShift" };

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week } = await searchParams;
  const view = await getWeekView(week);
  const first = view.days[0].label;
  const last = view.days[6].label;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">
            Week of {first} – {last}
          </h1>
          <p className="text-sm text-muted-foreground">
            Drag a shift to move it to another person or day. Click a shift to
            edit its times and stations; click an empty cell to add one.{" "}
            {view.badgeCount > 0 ? (
              <span className="font-medium text-destructive">
                {view.badgeCount} rule flags this week.
              </span>
            ) : (
              <span className="text-emerald-700">No rule flags this week.</span>
            )}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-1">
            <Link
              className={buttonVariants({ variant: "outline", size: "sm" })}
              href={`/schedule?week=${view.prevWeek}`}
            >
              ← Prev
            </Link>
            <Link
              className={buttonVariants({ variant: "outline", size: "sm" })}
              href={`/schedule?week=${view.today}`}
            >
              This week
            </Link>
            <Link
              className={buttonVariants({ variant: "outline", size: "sm" })}
              href={`/schedule?week=${view.nextWeek}`}
            >
              Next →
            </Link>
          </div>
          <AutofillButton weekStart={view.weekStart} />
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        {view.stations.map((s) => (
          <span key={s.id} className="inline-flex items-center gap-1">
            <span
              className="size-2.5 rounded-sm"
              style={{ background: s.color }}
            />
            {s.shortCode}{" "}
            <span className="text-muted-foreground">{s.name}</span>
          </span>
        ))}
      </div>

      <WeekGrid view={view} />
    </div>
  );
}
