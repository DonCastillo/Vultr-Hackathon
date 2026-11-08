"use client";

import { useState, useTransition } from "react";

import {
  createShiftAction,
  deleteShiftAction,
  updateShiftAction,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ShiftCard, StationOption } from "@/server/views";

// Shift editor (task 4.5): times, unpaid break, and the station blocks inside the shift
// ("split" a shift into e.g. 05:30-10:00 Drive-Thru, 10:00-14:00 Beverage).

export type EditorTarget =
  | { mode: "create"; crewId: string; date: string }
  | { mode: "edit"; card: ShiftCard };

interface Block {
  stationId: string;
  start: string;
  end: string;
}

const inputClass = "w-full rounded-md border bg-background px-2 py-1.5 text-sm";

export function ShiftEditor({
  target,
  crew,
  stations,
  onClose,
}: {
  target: EditorTarget;
  crew: { id: string; name: string }[];
  stations: StationOption[];
  onClose: () => void;
}) {
  const card = target.mode === "edit" ? target.card : null;
  const [crewId, setCrewId] = useState(
    card?.crewId ?? (target.mode === "create" ? target.crewId : ""),
  );
  const [date, setDate] = useState(
    card?.date ?? (target.mode === "create" ? target.date : ""),
  );
  const [start, setStart] = useState(card?.start ?? "05:30");
  const [end, setEnd] = useState(card?.end ?? "14:00");
  const [breakMinutes, setBreakMinutes] = useState<string>(
    card ? String(card.breakMinutes) : "",
  );
  const [blocks, setBlocks] = useState<Block[]>(
    card?.segments.map((s) => ({
      stationId: s.stationId,
      start: s.start,
      end: s.end,
    })) ?? [{ stationId: stations[0]?.id ?? "", start: "05:30", end: "14:00" }],
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const setBlock = (i: number, patch: Partial<Block>) =>
    setBlocks((bs) => bs.map((b, n) => (n === i ? { ...b, ...patch } : b)));

  /** Splits the last block at a time the manager picks (defaults to its midpoint hour). */
  const split = () => {
    const last = blocks[blocks.length - 1];
    if (!last) return;
    const toMin = (t: string) =>
      Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
    const s = toMin(last.start);
    let e = toMin(last.end);
    if (e <= s) e += 1440;
    const mid = Math.round((s + e) / 2 / 30) * 30;
    const at = `${String(Math.floor((mid % 1440) / 60)).padStart(2, "0")}:${String(mid % 60).padStart(2, "0")}`;
    setBlocks((bs) => [
      ...bs.slice(0, -1),
      { ...last, end: at },
      { stationId: last.stationId, start: at, end: last.end },
    ]);
  };

  const save = () => {
    setError(null);
    const input = {
      crewId,
      date,
      start,
      end,
      breakMinutes: breakMinutes === "" ? undefined : Number(breakMinutes),
      blocks,
    };
    startTransition(async () => {
      const r = card
        ? await updateShiftAction(card.id, input)
        : await createShiftAction(input);
      if (r.ok) onClose();
      else setError(r.error);
    });
  };

  const remove = () => {
    if (!card) return;
    setError(null);
    startTransition(async () => {
      const r = await deleteShiftAction(card.id);
      if (r.ok) onClose();
      else setError(r.error);
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{card ? "Edit shift" : "Add shift"}</DialogTitle>
          <DialogDescription>
            Times are store time. An end at or before the start runs past
            midnight. Leave the break empty for the default (30 min after 5h, 60
            after 8.5h).
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="col-span-2 space-y-1">
            <span className="font-medium">Crew</span>
            <select
              className={inputClass}
              value={crewId}
              onChange={(e) => setCrewId(e.target.value)}
            >
              {crew.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="font-medium">Date</span>
            <input
              type="date"
              className={inputClass}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label className="space-y-1">
            <span className="font-medium">Unpaid break (min)</span>
            <input
              type="number"
              min={0}
              step={15}
              placeholder="auto"
              className={inputClass}
              value={breakMinutes}
              onChange={(e) => setBreakMinutes(e.target.value)}
            />
          </label>
          <label className="space-y-1">
            <span className="font-medium">Start</span>
            <input
              type="time"
              step={900}
              className={inputClass}
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label className="space-y-1">
            <span className="font-medium">End</span>
            <input
              type="time"
              step={900}
              className={inputClass}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Station blocks</span>
            <div className="flex gap-1">
              <Button type="button" variant="outline" size="xs" onClick={split}>
                Split last block
              </Button>
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() =>
                  setBlocks((bs) => [
                    ...bs,
                    {
                      stationId: stations[0]?.id ?? "",
                      start: bs.at(-1)?.end ?? start,
                      end,
                    },
                  ])
                }
              >
                + Block
              </Button>
            </div>
          </div>
          {blocks.map((b, i) => (
            <div
              key={i}
              className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-1.5"
            >
              <select
                aria-label={`Station for block ${i + 1}`}
                className={inputClass}
                value={b.stationId}
                onChange={(e) => setBlock(i, { stationId: e.target.value })}
              >
                {stations.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.shortCode} · {s.name}
                  </option>
                ))}
              </select>
              <input
                aria-label={`Block ${i + 1} start`}
                type="time"
                step={900}
                className={`${inputClass} w-28`}
                value={b.start}
                onChange={(e) => setBlock(i, { start: e.target.value })}
              />
              <input
                aria-label={`Block ${i + 1} end`}
                type="time"
                step={900}
                className={`${inputClass} w-28`}
                value={b.end}
                onChange={(e) => setBlock(i, { end: e.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove block ${i + 1}`}
                disabled={blocks.length === 1}
                onClick={() => setBlocks((bs) => bs.filter((_, n) => n !== i))}
              >
                ✕
              </Button>
            </div>
          ))}
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          {card ? (
            <Button
              type="button"
              variant="destructive"
              onClick={remove}
              disabled={pending}
            >
              Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="button" onClick={save} disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
