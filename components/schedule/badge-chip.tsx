import type { Badge } from "@/server/validation";
import { humanizeTimes } from "@/lib/time-format";

// Live validation badge (task 4.6). Red = a blocking rule (the agent would never assign
// this), amber = a warning. Hovering or focusing the badge shows what it means in general
// and why this shift got it, straight away (no native-title delay).

export function BadgeChip({
  badge,
  alignRight = false,
}: {
  badge: Badge;
  alignRight?: boolean;
}) {
  const block = badge.severity === "block";
  return (
    <span className="group/badge relative inline-block">
      <span
        tabIndex={0}
        aria-label={`${badge.label}: ${humanizeTimes(badge.help)} ${humanizeTimes(badge.message)}`}
        className={`inline-flex cursor-help items-center gap-0.5 rounded px-1 text-[10px] leading-4 font-semibold whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          block ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-900"
        }`}
        // Keep a click on the badge from opening the shift editor or starting a drag.
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {badge.label}
        <span aria-hidden className="opacity-70">
          ⓘ
        </span>
      </span>
      <span
        role="tooltip"
        className={`pointer-events-none invisible absolute top-full z-40 mt-1 w-60 rounded-md bg-foreground px-2.5 py-2 text-left text-[11px] leading-snug font-normal whitespace-normal text-background opacity-0 shadow-lg transition-opacity group-focus-within/badge:visible group-focus-within/badge:opacity-100 group-hover/badge:visible group-hover/badge:opacity-100 ${
          alignRight ? "right-0" : "left-0"
        }`}
      >
        <span className="block font-semibold">
          {badge.label} · {block ? "blocks" : "warning"}
        </span>
        <span className="block">{humanizeTimes(badge.help)}</span>
        <span className="mt-1 block opacity-80">
          {humanizeTimes(badge.message)}
        </span>
      </span>
    </span>
  );
}
