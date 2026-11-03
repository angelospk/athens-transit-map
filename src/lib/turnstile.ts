// Bot check (Cloudflare Turnstile) for the feedback form and «Λάθος θέση στάσης;». Optional on both sides:
// without VITE_TURNSTILE_SITE_KEY there is no widget and no script; without TURNSTILE_SECRET in the Apps
// Script (docs/feedback/Code.gs) the token is not checked. A failed or missing check never blocks a send:
// the row is marked unverified and scripts/stopfix.ts asks a person to look. The script loads only when a
// form opens, never with the map.
import { FEEDBACK_URL } from "./feedback";

export const TURNSTILE_SITE_KEY: string = import.meta.env.VITE_TURNSTILE_SITE_KEY || "";
export const TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
export const TOKEN_WAIT_MS = 4000;   // a send waits this long for a token still on its way

export interface TurnstileApi {
  render(el: HTMLElement, o: Record<string, unknown>): string | undefined;
  reset(id: string): void;
  remove(id: string): void;
}

/** The token can be checked only by the Apps Script; the old Google Form path has nothing to check it. */
export function turnstileOn(siteKey = TURNSTILE_SITE_KEY, feedbackUrl = FEEDBACK_URL): boolean {
  return !!siteKey && !!feedbackUrl;
}

let loading: Promise<TurnstileApi> | null = null;

/** Adds Turnstile's script once; a failed load is tried again on the next call. */
export function loadTurnstile(doc: Document = document, g: { turnstile?: unknown } = globalThis as { turnstile?: unknown }): Promise<TurnstileApi> {
  if (loading) return loading;
  const p = new Promise<TurnstileApi>((resolve, reject) => {
    const s = doc.createElement("script");
    s.src = TURNSTILE_SRC;
    s.async = true;
    const fail = (why: string) => { if (loading === p) loading = null; s.remove(); reject(new Error(why)); };
    s.onload = () => (g.turnstile ? resolve(g.turnstile as TurnstileApi) : fail("turnstile: no api"));
    s.onerror = () => fail("turnstile: script failed");
    doc.head.appendChild(s);
  });
  loading = p;
  return p;
}

/** The widget's latest token. take() hands it out once (a token checks once) and waits a little for
 *  one still coming; "" when none comes: the send goes out unverified. */
export class TokenBox {
  private token = "";
  private waiting: ((t: string) => void)[] = [];
  set(t: string) {
    const w = this.waiting.shift();
    if (w) w(t); else this.token = t;
  }
  clear() { this.token = ""; }
  take(waitMs = TOKEN_WAIT_MS): Promise<string> {
    if (this.token || waitMs <= 0) { const t = this.token; this.token = ""; return Promise.resolve(t); }
    return new Promise(resolve => {
      const done = (t: string) => { clearTimeout(timer); resolve(t); };
      const timer = setTimeout(() => { this.waiting = this.waiting.filter(w => w !== done); resolve(""); }, waitMs);
      this.waiting.push(done);
    });
  }
}
