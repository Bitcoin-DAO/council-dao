// Review of 14 November 2026, block 5: the app pages through a relay's record (X-1, R-H6).
import { describe, expect, it } from 'vitest';
import type { Filter } from 'nostr-tools/filter';
import type { Event } from '../core/events';
import { PAGE, queryAll } from './relays';

/** A relay holding these events, answering newest first, at most PAGE per request, honouring `until`. */
const fakeRelay = (store: Record<string, Event[]>) => async ([relay]: string[], f: Filter) =>
  store[relay].filter(e => f.until === undefined || e.created_at <= f.until).sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1)).slice(0, Math.min(f.limit ?? PAGE, PAGE));
const ev = (i: number, at: number) => ({ id: i.toString(16).padStart(64, '0'), created_at: at, kind: 3575, pubkey: '', sig: '', tags: [], content: '' }) as Event;

describe('paging through a relay (review X-1)', () => {
  it('gets every event of a record larger than one page, including the oldest (the genesis)', async () => {
    // 1,234 events, many sharing a second (bursts), including across page boundaries.
    const all = Array.from({ length: 1234 }, (_, i) => ev(i, 1000 + Math.floor(i / 7)));
    const got = await queryAll(['wss://a'], { '#D': ['x'] }, 200, fakeRelay({ 'wss://a': all }));
    expect(got.length).toBe(1234);
    expect(got.some(e => e.created_at === 1000)).toBe(true);
  });
  it('pages each relay on its own: one relay\'s page ending later cannot hide the other\'s events', async () => {
    const a = Array.from({ length: 700 }, (_, i) => ev(i, 2000 + i)); // recent
    const b = Array.from({ length: 900 }, (_, i) => ev(10_000 + i, 100 + i)); // older
    const got = await queryAll(['wss://a', 'wss://b'], {}, 200, fakeRelay({ 'wss://a': a, 'wss://b': b }));
    expect(got.length).toBe(1600);
  });
  it('more events in one second than a page holds: stops instead of looping', async () => {
    const all = Array.from({ length: 600 }, (_, i) => ev(i, 5000));
    const got = await queryAll(['wss://a'], {}, 200, fakeRelay({ 'wss://a': all }));
    expect(got.length).toBe(500); // the relay cannot be asked for the rest of that second; no endless loop
  });
  it('a small record takes one request per relay, as before', async () => {
    let calls = 0;
    const q = async (r: string[], f: Filter) => { calls++; return fakeRelay({ 'wss://a': [ev(1, 1)] })(r, f); };
    await queryAll(['wss://a'], {}, 200, q);
    expect(calls).toBe(1);
  });
});
