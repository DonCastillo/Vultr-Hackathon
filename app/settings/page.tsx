import type { Metadata } from "next";

import { CoverageEditor } from "@/components/settings/coverage-editor";
import { SettingsForm } from "@/components/settings/settings-form";
import { getCoverageTemplate } from "@/server/coverage-template";
import { PRESET_DISCLAIMER, PRESETS } from "@/server/rules/presets";
import { getSettingsView } from "@/server/views";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Settings · CrewShift" };

export default async function SettingsPage() {
  const [view, coverage] = await Promise.all([
    getSettingsView(),
    getCoverageTemplate(),
  ]);
  const presets = Object.values(PRESETS).map((p) => ({
    jurisdiction: p.jurisdiction,
    label: p.label,
    summary: `OT after ${p.dailyOtHours ? `${p.dailyOtHours}h/day or ` : ""}${p.weeklyOtHours}h/week · ${p.minRestHours}h rest · youth under ${p.youthUnderAge}`,
  }));
  return (
    <div className="max-w-5xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">{PRESET_DISCLAIMER}</p>
      </div>
      <SettingsForm
        key={`${view.jurisdiction}:${JSON.stringify(view.config)}`}
        view={view}
        presets={presets}
      />
      <CoverageEditor
        stations={coverage.stations}
        initial={coverage.template}
        weekdayOverrides={coverage.weekdayOverrides}
      />
    </div>
  );
}
