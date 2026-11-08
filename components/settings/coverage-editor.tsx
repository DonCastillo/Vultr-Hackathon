"use client";

import { useState, useTransition } from "react";

import { saveCoverageTemplateAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import type { CoverageTemplate } from "@/server/coverage-template";

// Coverage template editor: minimum headcount per station per daypart (0 = not needed),
// plus the daypart times. Feeds the station board heatmap, call-out planning and auto-fill.

type Daypart = keyof CoverageTemplate["dayparts"];

const ORDER: Daypart[] = [
  "MORNING_RUSH",
  "MIDDAY",
  "AFTERNOON",
  "EVENING_CLOSE",
  "OVERNIGHT",
];
const LABEL: Record<Daypart, string> = {
  OVERNIGHT: "Overnight",
  MORNING_RUSH: "Morning rush",
  MIDDAY: "Midday",
  AFTERNOON: "Afternoon",
  EVENING_CLOSE: "Evening/close",
};

export function CoverageEditor({
  stations,
  initial,
  weekdayOverrides,
}: {
  stations: { id: string; shortCode: string; name: string; color: string }[];
  initial: CoverageTemplate;
  weekdayOverrides: number;
}) {
  const [template, setTemplate] = useState<CoverageTemplate>(initial);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [pending, startTransition] = useTransition();

  const count = (stationId: string, d: Daypart) =>
    template.counts[stationId]?.[d] ?? 0;
  const setCount = (stationId: string, d: Daypart, value: number) =>
    setTemplate((t) => ({
      ...t,
      counts: {
        ...t.counts,
        [stationId]: {
          ...t.counts[stationId],
          [d]: Math.max(0, Math.min(20, value)),
        },
      },
    }));
  const setTime = (d: Daypart, key: "start" | "end", value: string) =>
    setTemplate((t) => ({
      ...t,
      dayparts: { ...t.dayparts, [d]: { ...t.dayparts[d], [key]: value } },
    }));

  const save = () =>
    startTransition(async () => {
      const r = await saveCoverageTemplateAction(template);
      setMessage(
        r.ok
          ? { ok: true, text: "Coverage template saved." }
          : { ok: false, text: r.error },
      );
    });

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <div>
        <h2 className="font-semibold">Coverage template</h2>
        <p className="text-sm text-muted-foreground">
          The minimum number of people each station needs in each daypart, every
          day (0 = not needed). The station board turns red below these numbers,
          and call-out planning and auto-fill fill to them.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="py-1 pr-2 font-medium">Station</th>
              {ORDER.map((d) => (
                <th key={d} className="px-1 py-1 align-bottom font-medium">
                  <div className="text-foreground">{LABEL[d]}</div>
                  <div className="mt-1 flex flex-col gap-1">
                    <input
                      type="time"
                      step={900}
                      aria-label={`${LABEL[d]} starts`}
                      className="w-full rounded border bg-background px-1 py-0.5 text-xs"
                      value={template.dayparts[d].start}
                      onChange={(e) => setTime(d, "start", e.target.value)}
                    />
                    <input
                      type="time"
                      step={900}
                      aria-label={`${LABEL[d]} ends`}
                      className="w-full rounded border bg-background px-1 py-0.5 text-xs"
                      value={template.dayparts[d].end}
                      onChange={(e) => setTime(d, "end", e.target.value)}
                    />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stations.map((s) => (
              <tr key={s.id} className="border-t">
                <th scope="row" className="py-1 pr-2 text-left font-normal">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="size-2.5 rounded-full"
                      style={{ background: s.color }}
                    />
                    <span className="font-medium">{s.shortCode}</span>
                    <span className="hidden text-xs text-muted-foreground sm:inline">
                      {s.name}
                    </span>
                  </span>
                </th>
                {ORDER.map((d) => (
                  <td key={d} className="px-1 py-1">
                    <input
                      type="number"
                      min={0}
                      max={20}
                      aria-label={`${s.name}, ${LABEL[d]}: minimum people`}
                      className={`w-full rounded border bg-background px-1.5 py-1 text-center tabular-nums ${
                        count(s.id, d) === 0
                          ? "text-muted-foreground"
                          : "font-medium"
                      }`}
                      value={count(s.id, d)}
                      onChange={(e) =>
                        setCount(s.id, d, Number(e.target.value) || 0)
                      }
                    />
                  </td>
                ))}
              </tr>
            ))}
            <tr className="border-t font-medium">
              <th scope="row" className="py-1 pr-2 text-left">
                People needed
              </th>
              {ORDER.map((d) => (
                <td key={d} className="px-1 py-1 text-center tabular-nums">
                  {stations.reduce((n, s) => n + count(s.id, d), 0)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
        <li>
          Dayparts can&apos;t overlap. Overnight may run past midnight (end
          before start).
        </li>
        <li>
          The morning rush times are also when trainees can&apos;t work alone on
          rush-critical stations.
        </li>
        {weekdayOverrides > 0 && (
          <li>
            {weekdayOverrides} weekday-specific rule
            {weekdayOverrides === 1 ? "" : "s"} keep their headcounts and follow
            these daypart times.
          </li>
        )}
      </ul>

      {message && (
        <p
          role="status"
          className={`rounded-md px-3 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-destructive/10 text-destructive"}`}
        >
          {message.text}
        </p>
      )}
      <Button type="button" onClick={save} disabled={pending}>
        {pending ? "Saving…" : "Save coverage template"}
      </Button>
    </section>
  );
}
