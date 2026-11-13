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
