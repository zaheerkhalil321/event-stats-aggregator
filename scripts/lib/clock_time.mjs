/**
 * A timing-site time as hh:mm:ss: "53:47.18" -> "00:53:47" (Elite lists and pages show
 * minutes:seconds.hundredths), "1:02:03" -> "01:02:03". Anything else -> null.
 */
export function clockTime(s) {
  const m = String(s ?? '').trim().match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:\.\d+)?$/);
  if (!m) return null;
  return [m[1] ?? '0', m[2], m[3]].map((x) => String(x).padStart(2, '0')).join(':');
}
