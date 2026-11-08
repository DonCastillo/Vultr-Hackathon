"use client";

import { useState, useTransition } from "react";

import { autofillWeekAction, type AutofillResult } from "@/app/actions";
import { Button } from "@/components/ui/button";

// Auto-fill (task 4.10): asks once to confirm, then fills the week's coverage gaps with
// rule-checked, no-overtime shifts and reports what it couldn't fill.

export function AutofillButton({ weekStart }: { weekStart: string }) {
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<AutofillResult | null>(null);
  const [pending, startTransition] = useTransition();

  const run = () =>
    startTransition(async () => {
      setConfirming(false);
      setResult(await autofillWeekAction(weekStart));
    });

  return (
    <div className="flex flex-col items-end gap-1">
      {confirming ? (
        <div className="flex gap-1">
          <Button size="sm" onClick={run} disabled={pending}>
            Fill gaps with draft shifts
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setConfirming(false)}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setConfirming(true)}
          disabled={pending}
        >
          {pending ? "Filling…" : "Auto-fill gaps"}
        </Button>
      )}
      {result && (
        <p
          role="status"
          className="max-w-md text-right text-xs text-muted-foreground"
        >
          {result.ok
            ? `Added ${result.created} draft shift${result.created === 1 ? "" : "s"}.${
                result.unfilled.length
                  ? ` Couldn't fill: ${result.unfilled.slice(0, 4).join("; ")}${result.unfilled.length > 4 ? "…" : ""}`
                  : " Every gap is covered."
              }`
            : result.error}
        </p>
      )}
    </div>
  );
}
