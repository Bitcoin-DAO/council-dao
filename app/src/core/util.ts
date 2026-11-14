// Small shared helpers: hex, hashing, canonical JSON (RFC 8785).
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';

export { bytesToHex, hexToBytes, utf8ToBytes };

export const isHex = (s: unknown, len?: number): s is string =>
  typeof s === 'string' && /^[0-9a-f]*$/.test(s) && s.length % 2 === 0 && (len === undefined || s.length === len);

export const sha256Hex = (data: Uint8Array | string): string =>
  bytesToHex(sha256(typeof data === 'string' ? utf8ToBytes(data) : data));

/** RFC 8785 JSON Canonicalization Scheme. */
export function jcs(value: unknown): string {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('JCS: non-finite number');
    return JSON.stringify(value); // ES number serialisation is what JCS specifies
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(jcs).join(',') + ']';
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter(k => obj[k] !== undefined).sort((a, b) => {
      // sort by UTF-16 code units
      const n = Math.min(a.length, b.length);
      for (let i = 0; i < n; i++) {
        const d = a.charCodeAt(i) - b.charCodeAt(i);
        if (d) return d;
      }
      return a.length - b.length;
    });
    return '{' + keys.map(k => JSON.stringify(k) + ':' + jcs(obj[k])).join(',') + '}';
  }
  throw new Error('JCS: unsupported value');
}

export const hashJson = (value: unknown): string => sha256Hex(jcs(value));

/** JSON from an event or a file; undefined when it is not JSON or holds a number JSON cannot round-trip (1e999). */
export function parseJson<T = unknown>(s: string): T | undefined {
  try {
    return JSON.parse(s, (_k, v) => {
      if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('non-finite number');
      return v;
    }) as T;
  } catch {
    return undefined;
  }
}

/** A time zone the platform knows; anything else would throw wherever dates are formatted (review R-H2). */
export function validTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
export const safeTimeZone = (tz: unknown) => (validTimeZone(tz) ? tz : 'UTC');

/**
 * The app's time, which decides every date it shows or signs: the phone's clock corrected by the offset read from
 * the site's server (setClockOffset). A phone whose clock is minutes off still dates votes and counts correctly.
 */
let clockOffsetMs = 0;
export const setClockOffset = (ms: number) => void (clockOffsetMs = ms);
export const clockOffset = () => clockOffsetMs;
export const nowMs = () => Date.now() + clockOffsetMs;
export const nowSec = () => Math.floor(nowMs() / 1000);

/**
 * The offset from a response's Date header (whole seconds, so add half a second), measured against the midpoint of
 * the request. Undefined when the header is missing or unreadable.
 */
export function offsetFromDate(dateHeader: string | null, sentMs: number, receivedMs: number): number | undefined {
  const server = dateHeader ? Date.parse(dateHeader) : NaN;
  if (!Number.isFinite(server)) return undefined;
  return Math.round(server + 500 - (sentMs + receivedMs) / 2);
}
