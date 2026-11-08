"use client";

import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useId, useState, useTransition } from "react";

import { moveShiftAction } from "@/app/actions";
import { timeRange } from "@/lib/time-format";
import type { ShiftCard, WeekView } from "@/server/views";

import { BadgeChip } from "./badge-chip";
import { ShiftEditor, type EditorTarget } from "./shift-editor";

// Week view (tasks 4.3 / 4.4): crew x day grid with station-colored shift bars.
// Drag a shift onto another cell to move it (same times, new person and/or day); click a
// shift to edit it; click an empty cell to add one.

export function WeekGrid({ view }: { view: WeekView }) {
  const [editing, setEditing] = useState<EditorTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // A stable id keeps dnd-kit's accessibility ids the same on the server and the client.
  const dndId = useId();
  // A small drag distance keeps plain clicks as clicks (open the editor).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const card = e.active.data.current?.card as ShiftCard | undefined;
    const target = e.over?.data.current as
      { crewId: string; date: string } | undefined;
    if (!card || !target) return;
    if (card.crewId === target.crewId && card.date === target.date) return;
    setError(null);
    startTransition(async () => {
      const r = await moveShiftAction(card.id, target.crewId, target.date);
      if (!r.ok) setError(r.error);
    });
  };

  return (
    <>
      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}
      <DndContext id={dndId} sensors={sensors} onDragEnd={onDragEnd}>
        <div
          className={`overflow-x-auto rounded-lg border bg-card ${pending ? "opacity-70" : ""}`}
        >
          <table className="w-full min-w-[1100px] table-fixed border-collapse text-sm">
            <colgroup>
              <col className="w-48" />
              {view.days.map((d) => (
                <col key={d.date} />
              ))}
            </colgroup>
            <thead>
              <tr className="bg-muted/60 text-xs">
                <th className="sticky left-0 z-10 bg-muted px-2 py-2 text-left font-medium">
                  Crew
                </th>
                {view.days.map((d, i) => (
                  <th
                    key={d.date}
                    className={`px-2 py-2 text-left font-medium ${d.date === view.today ? "text-primary" : ""}`}
                  >
                    {d.label}
                    <span className="ml-1 font-normal text-muted-foreground">
                      {view.dayTotals[i]}h
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.rows.map((row) => (
                <tr key={row.crewId} className="border-t">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-card px-2 py-1.5 text-left align-top font-normal"
                  >
                    <div className="truncate font-medium">{row.name}</div>
                    {!row.active && (
                      <span
                        className="rounded bg-zinc-200 px-1 text-[10px] font-semibold text-zinc-700"
                        title="No longer active: reassign these shifts"
                      >
                        Inactive · reassign
                      </span>
                    )}
                    <div className="text-xs text-muted-foreground">
                      <span
                        className={
                          row.maxWeeklyHours !== null &&
                          row.weekHours > row.maxWeeklyHours
                            ? "text-destructive"
                            : ""
                        }
                      >
                        {row.weekHours}h
                      </span>
                      {row.maxWeeklyHours !== null &&
                        ` / ${row.maxWeeklyHours}`}
                      {row.age < 18 && ` · ${row.age}`}
                      {row.isStudent && " · student"}
                    </div>
                  </th>
                  {row.days.map((cards, i) => (
                    <Cell
                      key={view.days[i].date}
                      crewId={row.crewId}
                      date={view.days[i].date}
                      cards={cards}
                      alignRight={i >= view.days.length - 2}
                      onAdd={() =>
                        setEditing({
                          mode: "create",
                          crewId: row.crewId,
                          date: view.days[i].date,
                        })
                      }
                      onEdit={(card) => setEditing({ mode: "edit", card })}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DndContext>
      {editing && (
        <ShiftEditor
          target={editing}
          crew={view.rows.map((r) => ({
            id: r.crewId,
            name: r.active ? r.name : `${r.name} (inactive)`,
          }))}
          stations={view.stations}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function Cell({
  crewId,
  date,
  cards,
  alignRight,
  onAdd,
  onEdit,
}: {
  crewId: string;
  date: string;
  cards: ShiftCard[];
  /** Last columns open badge tooltips to the left so they stay on screen. */
  alignRight: boolean;
  onAdd: () => void;
  onEdit: (card: ShiftCard) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `cell:${crewId}:${date}`,
    data: { crewId, date },
  });
  return (
    <td
      ref={setNodeRef}
      className={`group relative h-14 border-l px-1 py-1 align-top ${isOver ? "bg-accent" : ""}`}
    >
      <div className="space-y-1">
        {cards.map((c) => (
          <Card
            key={c.id}
            card={c}
            alignRight={alignRight}
            onEdit={() => onEdit(c)}
          />
        ))}
      </div>
      {cards.length === 0 && (
        <button
          type="button"
          onClick={onAdd}
          aria-label="Add shift"
          className="absolute inset-1 rounded border border-dashed border-transparent text-xs text-muted-foreground opacity-0 group-hover:border-border group-hover:opacity-100 focus-visible:opacity-100"
        >
          + Add
        </button>
      )}
    </td>
  );
}

function Card({
  card,
  alignRight,
  onEdit,
}: {
  card: ShiftCard;
  alignRight: boolean;
  onEdit: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `shift:${card.id}`,
      data: { card },
      disabled: card.status === "CALLED_OUT",
    });
  const calledOut = card.status === "CALLED_OUT";
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onEdit}
      onKeyDown={(e) => {
        if (e.key === "Enter") onEdit();
      }}
      role="button"
      tabIndex={0}
      title={`${timeRange(card.start, card.end)} · ${card.hours}h paid${card.notes ? ` · ${card.notes}` : ""}`}
      style={
        transform
          ? {
              transform: `translate(${transform.x}px, ${transform.y}px)`,
              zIndex: 20,
            }
          : undefined
      }
      className={`cursor-grab rounded border bg-background p-1 text-xs shadow-sm hover:border-primary/50 active:cursor-grabbing ${
        isDragging ? "opacity-80 shadow-lg" : ""
      } ${calledOut ? "line-through opacity-50" : ""}`}
    >
      <div className="flex items-center justify-between gap-1 font-medium tabular-nums">
        <span>{timeRange(card.start, card.end)}</span>
        <span className="text-muted-foreground">{card.hours}h</span>
      </div>
      <div className="relative mt-0.5 h-2 overflow-hidden rounded-sm bg-muted">
        {card.segments.map((s) => (
          <span
            key={`${s.stationId}-${s.start}`}
            title={`${s.shortCode} ${timeRange(s.start, s.end)}`}
            className="absolute top-0 h-full"
            style={{
              left: `${s.leftPct}%`,
              width: `${s.widthPct}%`,
              background: s.color,
            }}
          />
        ))}
      </div>
      <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
        {card.segments.map((s) => s.shortCode).join(" → ")}
      </div>
      {card.badges.length > 0 && (
        <div className="mt-0.5 flex flex-wrap gap-0.5">
          {card.badges.map((b) => (
            <BadgeChip
              key={`${b.label}-${b.message}`}
              badge={b}
              alignRight={alignRight}
            />
          ))}
        </div>
      )}
    </div>
  );
}
