// Relay access: query every configured relay, de-duplicate by id, publish to all.
import { SimplePool } from 'nostr-tools/pool';
import type { Filter } from 'nostr-tools/filter';
import type { Event } from '../core/events';

let pool: SimplePool | undefined;
const getPool = () => (pool ??= new SimplePool());

/**
 * Every relay's events for the filter, de-duplicated. Ends when all relays have sent what they hold, or at the latest
 * after maxWait plus a short grace, with whatever arrived: one relay that connects but never answers (or never
 * closes) must not hold up the page. Seen in the wild: the first load waited until the next 30-second sync.
 */
export function query(relays: string[], filter: Filter, maxWait = 5000): Promise<Event[]> {
  if (!relays.length) return Promise.resolve([]);
  return new Promise(resolve => {
    const got = new Map<string, Event>();
    let done = false;
    let sub: { close: (reason?: string) => unknown } | undefined;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        void Promise.resolve(sub?.close('done')).catch(() => undefined);
      } catch {
        // already closed
      }
      resolve([...got.values()]);
    };
    const timer = setTimeout(finish, maxWait + 1500);
    sub = getPool().subscribeMany(relays, filter, {
      maxWait,
      onevent: e => void got.set(e.id, e as Event),
      oneose: finish,
      onclose: finish,
    });
    if (done) void Promise.resolve(sub.close('done')).catch(() => undefined);
  });
}

export interface PublishResult {
  ok: string[];
  failed: { relay: string; reason: string }[];
}

export async function publish(relays: string[], event: Event): Promise<PublishResult> {
  const results = await Promise.allSettled(getPool().publish(relays, event, { maxWait: 8000 }));
  const out: PublishResult = { ok: [], failed: [] };
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') out.ok.push(relays[i]);
    else out.failed.push({ relay: relays[i], reason: String((r.reason as Error)?.message ?? r.reason) });
  });
  return out;
}

/** The most a relay returns for one request (the DAO relay's cap; public relays use the same or less). */
export const PAGE = 500;

/**
 * Every event matching the filter, from each relay, paging back in time while a relay returns full pages
 * (review X-1/R-H6: a relay returns at most PAGE events, newest first, so one request lost the oldest part of a
 * large record, the genesis first). Each relay is paged on its own: their pages end at different times.
 */
export async function queryAll(relays: string[], filter: Filter, maxPages = 200, q: (relays: string[], f: Filter) => Promise<Event[]> = query): Promise<Event[]> {
  const got = new Map<string, Event>();
  await Promise.all(relays.map(async relay => {
    let until: number | undefined;
    for (let page = 0; page < maxPages; page++) {
      const batch = await q([relay], { ...filter, limit: PAGE, ...(until !== undefined ? { until } : {}) });
      let fresh = 0;
      for (const e of batch) if (!got.has(e.id)) { got.set(e.id, e); fresh++; }
      if (batch.length < PAGE) return;
      const oldest = Math.min(...batch.map(e => e.created_at));
      // Events sharing the boundary second may span two pages: ask from that second again, unless nothing new came.
      until = fresh === 0 || until === oldest ? oldest - 1 : oldest;
    }
  }));
  return [...got.values()];
}
