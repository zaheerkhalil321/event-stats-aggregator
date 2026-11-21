/**
 * A timing-site time as hh:mm:ss: "53:47.18" -> "00:53:47" (Elite lists and pages show
 * minutes:seconds.hundredths), "1:02:03" -> "01:02:03", "62:40.12" -> "01:02:40". Anything else -> null.
 */
export function clockTime(s) {
  const m = String(s ?? '').trim().match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:\.\d+)?$/);
  if (!m) return null;
  // Minutes over 59 (Elite "62:40.12") are carried into hours: "01:02:40".
  const mm = Number(m[2]);
  const h = Number(m[1] ?? 0) + Math.floor(mm / 60);
  return [h, mm % 60, m[3]].map((x) => String(x).padStart(2, '0')).join(':');
}
