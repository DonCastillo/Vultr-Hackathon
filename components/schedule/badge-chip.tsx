import type { Badge } from "@/server/validation";

// Live validation badge (task 4.6). Blocking rules are red, warnings amber; the full
// rule message is in the tooltip.

export function BadgeChip({ badge }: { badge: Badge }) {
  return (
    <span
      title={badge.message}
      className={`inline-block rounded px-1 text-[10px] leading-4 font-semibold whitespace-nowrap ${
        badge.severity === "block"
          ? "bg-red-100 text-red-800"
          : "bg-amber-100 text-amber-900"
      }`}
    >
      {badge.label}
    </span>
  );
}
