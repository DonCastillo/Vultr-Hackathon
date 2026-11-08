"use client";

import { useEffect, useState } from "react";

import { timeRange } from "@/lib/time-format";

// Labour % by daypart (task 4.9): scheduled station hours x wage against a projected
// sales figure the manager types in. Sales projections are a per-browser convenience
// (localStorage), not store data.

interface Daypart {
  name: string;
  start: string;
  end: string;
  hours: number;
  cost: number;
}

const DEFAULT_SALES: Record<string, number> = {
  Overnight: 0,
  "Morning rush": 3600,
  Midday: 2200,
  Afternoon: 1500,
  "Evening/close": 1300,
};
const KEY = "crewshift.projectedSales";

export function LabourPanel({ dayparts }: { dayparts: Daypart[] }) {
  const [sales, setSales] = useState<Record<string, number>>(DEFAULT_SALES);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) setSales({ ...DEFAULT_SALES, ...JSON.parse(saved) });
    } catch {
      // storage unavailable: keep defaults
    }
  }, []);

  const update = (name: string, value: number) => {
    const next = { ...sales, [name]: value };
    setSales(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const totalCost = dayparts.reduce((c, d) => c + d.cost, 0);
  const totalSales = dayparts.reduce((c, d) => c + (sales[d.name] ?? 0), 0);

  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="mb-2 font-semibold">Labour by daypart</h2>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th className="py-1">Daypart</th>
            <th className="py-1 text-right">Hours</th>
            <th className="py-1 text-right">Labour</th>
            <th className="py-1 text-right">Projected sales</th>
            <th className="py-1 text-right">Labour %</th>
          </tr>
        </thead>
        <tbody>
          {dayparts.map((d) => {
            const s = sales[d.name] ?? 0;
            const pct = s > 0 ? (d.cost / s) * 100 : null;
            return (
              <tr key={d.name} className="border-t">
                <td className="py-1">
                  {d.name}{" "}
                  <span className="text-xs text-muted-foreground">
                    {timeRange(d.start, d.end)}
                  </span>
                </td>
                <td className="py-1 text-right tabular-nums">{d.hours}</td>
                <td className="py-1 text-right tabular-nums">${d.cost}</td>
                <td className="py-1 text-right">
                  <input
                    type="number"
                    min={0}
                    step={50}
                    aria-label={`Projected sales, ${d.name}`}
                    className="w-24 rounded border bg-background px-1.5 py-0.5 text-right tabular-nums"
                    value={s}
                    onChange={(e) =>
                      update(d.name, Number(e.target.value) || 0)
                    }
                  />
                </td>
                <td
                  className={`py-1 text-right tabular-nums ${pct !== null && pct > 30 ? "font-medium text-destructive" : ""}`}
                >
                  {pct === null ? "—" : `${pct.toFixed(1)}%`}
                </td>
              </tr>
            );
          })}
          <tr className="border-t font-medium">
            <td className="py-1">Day</td>
            <td className="py-1 text-right tabular-nums">
              {Math.round(dayparts.reduce((h, d) => h + d.hours, 0) * 10) / 10}
            </td>
            <td className="py-1 text-right tabular-nums">${totalCost}</td>
            <td className="py-1 text-right tabular-nums">${totalSales}</td>
            <td className="py-1 text-right tabular-nums">
              {totalSales > 0
                ? `${((totalCost / totalSales) * 100).toFixed(1)}%`
                : "—"}
            </td>
          </tr>
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted-foreground">
        Over 30% is flagged. Sales projections are saved in this browser.
      </p>
    </section>
  );
}
