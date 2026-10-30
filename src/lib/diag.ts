// What the page did lately, sent with feedback so a report can be matched to the backend's data:
// the last requests (host + path, status, time; no query strings, which can hold searched places)
// and the last page errors. Kept in memory only; nothing is sent without the feedback form.

export interface ReqLog { at: number; url: string; status: number; ms: number; error?: string }
export interface ErrLog { at: number; message: string }
export interface DiagSnapshot { requests: ReqLog[]; errors: ErrLog[] }

const MAX_REQ = 20, MAX_ERR = 10, MAX_MSG = 300;

const where = (input: RequestInfo | URL): string => {
  const raw = input instanceof Request ? input.url : String(input);
  try { const u = new URL(raw, "http://local"); return u.host === "local" ? u.pathname : u.host + u.pathname; }
  catch { return raw.split("?")[0]; }
};

// Error text can quote a URL (a failed fetch, a stack line): keep scheme, host and path only,
// never credentials, a query or a fragment. A URL that does not parse is dropped whole.
const bare = (url: string): string => {
  const tail = url.match(/[.,;:!)\]]+$/)?.[0] ?? "";
  try { const u = new URL(url.slice(0, url.length - tail.length)); return u.protocol + "//" + u.host + u.pathname + tail; }
  catch { return "[url]" + tail; }
};
const scrub = (msg: string): string =>
  msg.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>`]*/gi, bare)
    .replace(/\?[^\s"'<>`?]*=[^\s"'<>`]*/g, "")  // a relative URL's query, e.g. /?stop=…
    .slice(0, MAX_MSG);

export class Diag {
  private requests: ReqLog[] = [];
  private errors: ErrLog[] = [];
  constructor(private now: () => number = Date.now, private skip: string[] = []) {}

  /** fetch that records each request; behaves exactly like fetchFn otherwise. */
  wrap(fetchFn: typeof fetch): typeof fetch {
    return async (input, init) => {
      const url = where(input);
      if (this.skip.some(s => url.includes(s))) return fetchFn(input, init);
      const t0 = this.now();
      try {
        const res = await fetchFn(input, init);
        this.push({ at: this.now(), url, status: res.status, ms: this.now() - t0 });
        return res;
      } catch (e) {
        this.push({ at: this.now(), url, status: 0, ms: this.now() - t0, error: scrub(String(e)) });
        throw e;
      }
    };
  }

  error(message: string): void {
    this.errors.push({ at: this.now(), message: scrub(message) });
    if (this.errors.length > MAX_ERR) this.errors.shift();
  }

  snapshot(): DiagSnapshot {
    return { requests: this.requests.map(r => ({ ...r })), errors: this.errors.map(e => ({ ...e })) };
  }

  private push(r: ReqLog) {
    this.requests.push(r);
    if (this.requests.length > MAX_REQ) this.requests.shift();
  }
}

export const diag = new Diag(Date.now, ["script.google.com", "docs.google.com"]);

/** Records every fetch and page error from now on (main.ts, before the app mounts). */
export function installDiag(): void {
  globalThis.fetch = diag.wrap(globalThis.fetch.bind(globalThis));
  addEventListener("error", e => diag.error(e.message || String(e.error)));
  addEventListener("unhandledrejection", e => diag.error(`unhandled: ${String(e.reason)}`));
}
