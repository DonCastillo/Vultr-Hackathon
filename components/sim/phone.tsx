"use client";

import { useState, useTransition } from "react";

import { simSendAction } from "@/app/actions";

// One simulated phone on /sim. Typing here is the same as the crew member texting the store line.

export function Phone({
  phone,
  name,
  messages,
  canSend = true,
  note,
}: {
  phone: string;
  name: string;
  messages: { id: string; at: string; mine: boolean; body: string }[];
  canSend?: boolean;
  note?: string;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const send = () => {
    setError(null);
    const body = text;
    startTransition(async () => {
      const r = await simSendAction(phone, body);
      if (r.ok) setText("");
      else setError(r.error);
    });
  };
  return (
    <div className="flex h-80 flex-col rounded-2xl border-4 border-zinc-800 bg-card">
      <div className="border-b px-3 py-1.5">
        <p className="text-sm font-semibold">{name}</p>
        <p className="text-xs text-muted-foreground">
          {phone}
          {note ? ` · ${note}` : ""}
        </p>
      </div>
      <ol className="flex flex-1 flex-col-reverse gap-1 overflow-y-auto p-2">
        {[...messages].reverse().map((m) => (
          <li
            key={m.id}
            className={`max-w-[85%] rounded-xl px-2.5 py-1.5 text-sm ${
              m.mine
                ? "self-end bg-primary text-primary-foreground"
                : "self-start bg-muted"
            }`}
            title={m.at}
          >
            {m.body}
          </li>
        ))}
      </ol>
      {canSend && (
        <form
          className="flex gap-1 border-t p-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) send();
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Text the store…"
            aria-label={`Message from ${name}`}
            className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1 text-sm"
          />
          <button
            type="submit"
            disabled={pending || !text.trim()}
            className="rounded-md bg-primary px-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {pending ? "…" : "Send"}
          </button>
        </form>
      )}
      {error && <p className="px-2 pb-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
