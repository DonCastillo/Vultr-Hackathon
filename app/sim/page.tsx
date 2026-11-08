import type { Metadata } from "next";

import { LiveRefresh } from "@/components/live-refresh";
import { Phone } from "@/components/sim/phone";
import { getSimView } from "@/server/callout-views";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Phone sim · CrewShift" };

export default async function SimPage() {
  const v = await getSimView();
  return (
    <div className="space-y-4">
      <LiveRefresh />
      <div>
        <h1 className="text-xl font-semibold">Phone simulator</h1>
        <p className="text-sm text-muted-foreground">
          Stand-in for real SMS. Each card is a crew member&apos;s phone texting
          the store line. Try Kayla: &ldquo;sick, can&apos;t make my 5:30
          tomorrow&rdquo;. Reply YES or NO when an offer arrives.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <Phone {...v.manager} canSend={false} note="receives updates" />
        {v.phones.map((p) => (
          <Phone
            key={p.phone}
            phone={p.phone}
            name={p.name}
            messages={p.messages}
            note={p.smsOptIn ? undefined : "no SMS"}
          />
        ))}
      </div>
    </div>
  );
}
