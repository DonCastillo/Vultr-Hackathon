// Display-only time formatting: the app stores and reasons in 24-hour "HH:MM" (store
// time); people read 12-hour times. Use these at the last step, in components.

/** "05:30" -> "5:30am", "14:00" -> "2pm", "00:00" -> "12am". */
export function to12h(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h < 12 ? "am" : "pm";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0
    ? `${hour}${suffix}`
    : `${hour}:${String(m).padStart(2, "0")}${suffix}`;
}

/** "05:30", "14:00" -> "5:30am–2pm". */
export function timeRange(start: string, end: string): string {
  return `${to12h(start)}–${to12h(end)}`;
}

const HHMM = /\b([01]\d|2[0-3]):([0-5]\d)\b/g;
const HHMM_RANGE =
  /\b((?:[01]\d|2[0-3]):[0-5]\d)-((?:[01]\d|2[0-3]):[0-5]\d)\b/g;

/**
 * Rewrites every 24-hour time in a sentence, e.g. rule messages from the engine:
 * "Zoe isn't available Mon 04:30-13:00." -> "Zoe isn't available Mon 4:30am–1pm."
 */
export function humanizeTimes(text: string): string {
  return text
    .replace(HHMM_RANGE, (_, a: string, b: string) => timeRange(a, b))
    .replace(HHMM, (t) => to12h(t));
}
