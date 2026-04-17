// Human-friendly formatters shared across the UI. Keep presentation logic
// here so store/runtime stay concerned with raw values.

// 1ms, 847ms, 2.1s, 42.9s, 3m 4s. Drops the seconds suffix on exact minutes.
export function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  if (sec === 0) return `${min}m`;
  if (sec === 60) return `${min + 1}m`;
  return `${min}m ${sec}s`;
}

// 14:22:15, localized to the user's machine. Falls back to a slice if the
// input isn't a valid ISO date.
export function formatLocalTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(11, 19);
  return d.toLocaleTimeString(undefined, { hour12: false });
}

// Apr 17, 14:22:15
export function formatLocalDateTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour12: false });
  return `${date}, ${time}`;
}

// "just now", "42s ago", "3m ago", "2h ago", "5d ago".
export function formatRelative(iso: string, now = Date.now()): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const ms = Math.max(0, now - t);
  if (ms < 10_000) return 'just now';
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

// "1 step" / "3 steps" — pluralization helper for counts.
export function pluralize(n: number, word: string, plural = `${word}s`): string {
  return `${n} ${n === 1 ? word : plural}`;
}

// "5s", "42s", "1m", "1m 12s", "2h 3m" — compact countdown that rounds to
// the nearest second and drops idle units.
export function formatCountdown(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'now';
  const sec = Math.ceil(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rs = sec % 60;
  if (min < 60) return rs === 0 ? `${min}m` : `${min}m ${rs}s`;
  const hr = Math.floor(min / 60);
  const rm = min % 60;
  return rm === 0 ? `${hr}h` : `${hr}h ${rm}m`;
}

// Human-friendly "every Xs / Xm / Xh" for trigger interval display.
export function formatInterval(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  if (seconds < 60) return `every ${seconds}s`;
  if (seconds % 3600 === 0) return `every ${seconds / 3600}h`;
  if (seconds % 60 === 0) return `every ${seconds / 60}m`;
  return `every ${seconds}s`;
}
