import type { Metadata } from "next";

import { getRosterView } from "@/server/views";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Crew · CrewShift" };

const LEVEL: Record<string, string> = {
  TRAINEE: "trainee",
  CERTIFIED: "",
  TRAINER: "trainer",
};
const CERT: Record<string, string> = {
  FOOD_HANDLER: "Food handler",
  BAKER: "Baker",
  SUPERVISOR: "Supervisor",
  FIRST_AID: "First aid",
};

export default async function CrewPage() {
  const view = await getRosterView();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Crew roster</h1>
        <p className="text-sm text-muted-foreground">
          {view.crew.length} active crew · youth rules apply under{" "}
          {view.youthUnderAge}
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[960px] text-sm">
          <thead className="bg-muted/60 text-left text-xs text-muted-foreground uppercase">
            <tr>
              <th className="px-3 py-2">Crew</th>
              <th className="px-3 py-2">Stations</th>
              <th className="px-3 py-2">Certs</th>
              <th className="px-3 py-2">Availability</th>
              <th className="px-3 py-2">Time off</th>
              <th className="px-3 py-2 text-right">Reliability</th>
            </tr>
          </thead>
          <tbody>
            {view.crew.map((c) => (
              <tr key={c.id} className="border-t align-top">
                <td className="px-3 py-2">
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {c.age} · ${c.hourlyWage.toFixed(2)}/h · since{" "}
                    {c.hireDate.slice(0, 4)}
                    {c.maxWeeklyHours !== null &&
                      ` · max ${c.maxWeeklyHours}h/wk`}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {c.isYouth && (
                      <Tag className="bg-amber-100 text-amber-900">Youth</Tag>
                    )}
                    {c.isStudent && (
                      <Tag className="bg-sky-100 text-sky-900">Student</Tag>
                    )}
                    {!c.smsOptIn && (
                      <Tag className="bg-zinc-200 text-zinc-700">No SMS</Tag>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {c.stations.map((s) => (
                      <span
                        key={s.shortCode}
                        title={`${s.name}${LEVEL[s.level] ? ` (${LEVEL[s.level]})` : ""}`}
                        className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs"
                        style={{ borderColor: s.color }}
                      >
                        <span
                          className="size-2 rounded-full"
                          style={{ background: s.color }}
                        />
                        {s.shortCode}
                        {LEVEL[s.level] && (
                          <span className="text-muted-foreground">
                            {LEVEL[s.level]}
                          </span>
                        )}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2">
                  {c.certs.length === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <ul className="space-y-0.5 text-xs">
                      {c.certs.map((x) => (
                        <li
                          key={x.type}
                          className={
                            x.expired ? "font-medium text-destructive" : ""
                          }
                        >
                          {CERT[x.type] ?? x.type}
                          {x.expiresAt
                            ? ` · ${x.expired ? "expired" : "exp."} ${x.expiresAt}`
                            : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">
                  {c.availability.map((a) => (
                    <div key={a}>{a}</div>
                  ))}
                </td>
                <td className="px-3 py-2 text-xs">
                  {c.timeOff.length === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    c.timeOff.map((t) => (
                      <div key={t.range}>
                        {t.range}{" "}
                        <span className="text-muted-foreground">
                          ({t.status.toLowerCase()})
                        </span>
                      </div>
                    ))
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {Math.round(c.reliability * 100)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Tag({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${className}`}
    >
      {children}
    </span>
  );
}
