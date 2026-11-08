import type { Metadata } from "next";

import {
  AddCrewButton,
  EditCrewButton,
  ViewCrewName,
} from "@/components/crew/crew-buttons";
import { getCrewForEdit } from "@/server/crew";
import { getRosterView, getSettingsView } from "@/server/views";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Crew · CrewShift" };

const LEVEL: Record<string, string> = {
  TRAINEE: "trainee",
  CERTIFIED: "",
  TRAINER: "trainer",
};
// Column tooltips: what each column means and how the scheduling rules use it.
const HINTS = {
  crew: "Name, age, hourly wage, start year and personal weekly-hours cap. Youth = under the jurisdiction's youth age (school-day and late-night limits apply); Student = school-day limits apply; No SMS = never texted shift offers.",
  stations:
    "Stations this person is trained on. Plain = certified; 'trainee' can't be alone on rush-critical stations during the morning rush; 'trainer' can train others. Untrained stations can't be scheduled.",
  certs:
    "Certifications and expiry dates. Sandwich and Oven need a valid food-handler cert, Overnight Baker a baker cert, Shift Supervisor a supervisor cert. Expired certs (red) block those stations.",
  availability:
    "Weekly windows this person can work, in store time. Shifts and offers outside them are flagged Unavailable. A window ending before it starts runs past midnight.",
  timeOff:
    "Upcoming time off. Approved time off blocks scheduling and shift offers; requested time off is only a warning until approved.",
};

const RELIABILITY_HINT =
  "How often this person accepts an extra-shift offer. When a call-out needs a replacement, more reliable crew are texted earlier (a tie-breaker after avoiding overtime and spreading pickups fairly).";
const CERT: Record<string, string> = {
  FOOD_HANDLER: "Food handler",
  BAKER: "Baker",
  SUPERVISOR: "Supervisor",
  FIRST_AID: "First aid",
};

export default async function CrewPage() {
  const [view, editable, settings] = await Promise.all([
    getRosterView(),
    getCrewForEdit(),
    getSettingsView(),
  ]);
  const stations = settings.stations.map(({ id, shortCode, name, color }) => ({
    id,
    shortCode,
    name,
    color,
  }));
  const editById = new Map(editable.map((e) => [e.id, e.input]));
  const inactive = editable.filter((e) => !e.input.active);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Crew roster</h1>
          <p className="text-sm text-muted-foreground">
            {view.crew.length} active crew · youth rules apply under{" "}
            {view.youthUnderAge}
          </p>
        </div>
        <AddCrewButton stations={stations} />
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[960px] text-sm">
          <thead className="bg-muted/60 text-left text-xs text-muted-foreground uppercase">
            <tr>
              <HintHeader label="Crew" hint={HINTS.crew} />
              <HintHeader label="Stations" hint={HINTS.stations} />
              <HintHeader label="Certs" hint={HINTS.certs} />
              <HintHeader label="Availability" hint={HINTS.availability} />
              <HintHeader label="Time off" hint={HINTS.timeOff} />
              <HintHeader
                label="Reliability"
                hint={RELIABILITY_HINT}
                className="text-right"
              />
              <th className="px-3 py-2">
                <span className="sr-only">Edit</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {view.crew.map((c) => (
              <tr key={c.id} className="border-t align-top">
                <td className="px-3 py-2">
                  <div>
                    {editById.get(c.id) ? (
                      <ViewCrewName
                        crewId={c.id}
                        name={c.name}
                        initial={editById.get(c.id)!}
                        stations={stations}
                      />
                    ) : (
                      <span className="font-medium">{c.name}</span>
                    )}
                  </div>
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
                <td
                  className="cursor-help px-3 py-2 text-right tabular-nums"
                  title={`${c.name} accepts about ${Math.round(c.reliability * 100)}% of shift offers. ${RELIABILITY_HINT}`}
                >
                  {Math.round(c.reliability * 100)}%
                </td>
                <td className="px-3 py-2 text-right">
                  {editById.get(c.id) && (
                    <EditCrewButton
                      crewId={c.id}
                      initial={editById.get(c.id)!}
                      stations={stations}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {inactive.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Inactive crew
          </h2>
          <ul className="flex flex-wrap gap-2">
            {inactive.map((e) => (
              <li
                key={e.id}
                className="flex items-center gap-2 rounded-md border bg-card px-2 py-1 text-sm"
              >
                {e.input.firstName} {e.input.lastName}
                <EditCrewButton
                  crewId={e.id}
                  initial={e.input}
                  stations={stations}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function HintHeader({
  label,
  hint,
  className = "",
}: {
  label: string;
  hint: string;
  className?: string;
}) {
  // A CSS tooltip: shows at once on hover or keyboard focus (native title tooltips are slow
  // and unreliable). Right-aligned columns open their tooltip to the left.
  const alignRight = className.includes("text-right");
  return (
    <th className={`px-3 py-2 ${className}`}>
      <span className="group relative inline-block">
        <span
          tabIndex={0}
          aria-describedby={`hint-${label}`}
          className="cursor-help whitespace-nowrap underline decoration-dotted underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {label} ⓘ
        </span>
        <span
          id={`hint-${label}`}
          role="tooltip"
          className={`pointer-events-none invisible absolute top-full z-30 mt-1.5 w-72 rounded-md bg-foreground px-3 py-2 text-left text-xs leading-snug font-normal tracking-normal text-background normal-case opacity-0 shadow-lg transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100 ${alignRight ? "right-0" : "left-0"}`}
        >
          {hint}
        </span>
      </span>
    </th>
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
