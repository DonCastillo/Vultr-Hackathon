const STYLE: Record<string, string> = {
  OPEN: "bg-zinc-200 text-zinc-800",
  PLANNED: "bg-amber-100 text-amber-900",
  OUTREACH: "bg-sky-100 text-sky-900",
  COVERED: "bg-emerald-100 text-emerald-900",
  UNFILLED: "bg-red-100 text-red-800",
  CANCELLED: "bg-zinc-200 text-zinc-600",
  PENDING: "bg-zinc-100 text-zinc-700",
  SENT: "bg-sky-100 text-sky-900",
  CLARIFYING: "bg-violet-100 text-violet-900",
  ACCEPTED: "bg-emerald-100 text-emerald-900",
  DECLINED: "bg-red-100 text-red-800",
  EXPIRED: "bg-orange-100 text-orange-900",
};

const LABEL: Record<string, string> = {
  PLANNED: "Needs approval",
  OUTREACH: "Texting crew",
  COVERED: "Covered",
  UNFILLED: "Unfilled",
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${STYLE[status] ?? "bg-zinc-100"}`}
    >
      {LABEL[status] ?? status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}
