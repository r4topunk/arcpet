import type { Locale } from './i18n';

export function shortAddress(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function shortHash(h: string): string {
  return `${h.slice(0, 10)}…${h.slice(-6)}`;
}

/** Compact duration: "2d 3h", "5h 12m", "4m 09s", "12s". Negative values clamp to 0. */
export function formatDuration(seconds: bigint | number): string {
  let s = Math.max(0, Number(seconds));
  const d = Math.floor(s / 86_400);
  s -= d * 86_400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, '0')}s`;
  return `${s}s`;
}

/** Whole days of an age in seconds (the tokenURI "Age (days)" attribute uses the same floor). */
export function ageDays(seconds: bigint): number {
  return Number(seconds / 86_400n);
}

/** Local date and time of a unix timestamp in the active language. */
export function formatDateTime(unix: bigint, locale: Locale): string {
  return new Date(Number(unix) * 1000).toLocaleString(locale === 'pt-BR' ? 'pt-BR' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** Parses ?id=<n> (static export: one HTML file serves every pet, the id is read client-side). */
export function parsePetId(raw: string | null): bigint | null {
  if (!raw || !/^\d{1,30}$/.test(raw)) return null;
  const id = BigInt(raw);
  return id > 0n ? id : null;
}
