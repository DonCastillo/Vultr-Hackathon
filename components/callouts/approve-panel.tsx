"use client";

import { useState, useTransition } from "react";

import { approveOutreachAction } from "@/app/actions";
import { Button } from "@/components/ui/button";

// Manager approval gate (CLAUDE.md): station moves and outreach only start here, and
// overtime candidates are only texted with explicit approval.

export function ApprovePanel({
  callOutId,
  hasOvertime,
}: {
  callOutId: string;
  hasOvertime: boolean;
}) {
  const [otApproved, setOtApproved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="space-y-2 rounded-lg border-2 border-primary/40 bg-accent/40 p-4">
      <p className="text-sm font-medium">Approve this plan?</p>
      <p className="text-sm text-muted-foreground">
        The station moves are applied right away (moved crew get a heads-up
        text). Then candidates are texted one at a time, best first, until
        someone accepts.
      </p>
      {hasOvertime && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={otApproved}
            onChange={(e) => setOtApproved(e.target.checked)}
          />
          Also text candidates who would go into overtime
        </label>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await approveOutreachAction(callOutId, otApproved);
            if (!r.ok) setError(r.error);
          })
        }
      >
        {pending ? "Starting…" : "Approve moves & start outreach"}
      </Button>
    </div>
  );
}
