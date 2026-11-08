"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { tickAction } from "@/app/actions";

// Keeps a page live: every few seconds it expires overdue offers (so outreach moves on even
// without the worker running) and re-renders with fresh data from the server.

export function LiveRefresh({ everyMs = 2500 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        await tickAction();
      } finally {
        if (!stopped) router.refresh();
      }
    }, everyMs);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [router, everyMs]);
  return null;
}
