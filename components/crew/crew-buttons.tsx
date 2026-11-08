"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { CrewEditInput } from "@/server/crew";

import { CrewEditor, EMPTY_CREW } from "./crew-editor";

type Station = { id: string; shortCode: string; name: string; color: string };

export function EditCrewButton({
  crewId,
  initial,
  stations,
}: {
  crewId: string;
  initial: CrewEditInput;
  stations: Station[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size="xs"
        variant="outline"
        onClick={() => setOpen(true)}
        aria-label={`Edit ${initial.firstName} ${initial.lastName}`}
      >
        Edit
      </Button>
      {open && (
        <CrewEditor
          crewId={crewId}
          initial={initial}
          stations={stations}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function AddCrewButton({ stations }: { stations: Station[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        + Add crew member
      </Button>
      {open && (
        <CrewEditor
          crewId={null}
          initial={EMPTY_CREW}
          stations={stations}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
