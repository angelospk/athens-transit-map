// A small stale-while-revalidate cache for the rail cards: the map loads the data of what is on
// screen while it rests (MapView), so a tapped station or train shows at once (peek) and the card
// asks again only when its copy is older than the server's own cache time.

import type { FetchResult } from "./poller";

interface Entry { at: number; good?: FetchResult; flight?: Promise<FetchResult> }

export class SwrCache {
  private m = new Map<string, Entry>();
  constructor(private now: () => number = Date.now, private max = 300) {}

  // The last good (200) answer for a key, of any age (`at`: when it came).
  peek(key: string): FetchResult | undefined {
    return this.m.get(key)?.good;
  }

  // The answer for a key: the good one while younger than ttl, else a new load (one at a time per key).
  get(key: string, ttl: number, load: () => Promise<FetchResult>): Promise<FetchResult> {
    const e = this.m.get(key);
    if (e?.good && this.now() - e.at < ttl) return Promise.resolve(e.good);
    if (e?.flight) return e.flight;
    const entry: Entry = e ?? { at: 0 };
    const flight = load().catch((): FetchResult => ({ status: 0, body: null })).then(r => {
      entry.flight = undefined;
      if (r.status !== 200) return r;
      entry.at = this.now();
      return (entry.good = { ...r, at: entry.at });
    });
    entry.flight = flight;
    this.m.delete(key);   // newest last: the first key is the oldest
    this.m.set(key, entry);
    if (this.m.size > this.max) this.m.delete(this.m.keys().next().value!);
    return flight;
  }
}
