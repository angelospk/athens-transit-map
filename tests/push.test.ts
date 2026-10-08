import { afterEach, describe, expect, it, vi } from "vitest";
import { PUSH_URL, retryStops, startPush, stopPush } from "../src/lib/push";

const KEY = "BOc7e28ESavPwoaIB0AHwtBHAZHIe3hNm1yWUm-FagBKGhmKSBnrkSZ0Hs1OWr7iqGWO0a8nkSsUhh7WJ1SgdQ8";
const bytes = (b64url: string) => Uint8Array.from(atob(b64url.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
const subJson = { endpoint: "https://web.push.apple.com/x", keys: { p256dh: "p", auth: "a" } };

function fakeReg(existing?: { key: string }) {
  const calls: string[] = [];
  const sub = (key: string) => ({
    options: { applicationServerKey: bytes(key).buffer },
    toJSON: () => subJson,
    unsubscribe: async () => { calls.push("unsubscribe"); return true; },
  });
  const reg = { pushManager: {
    getSubscription: async () => (existing ? sub(existing.key) : null),
    subscribe: async (o: { userVisibleOnly: boolean; applicationServerKey: Uint8Array }) => {
      calls.push(`subscribe ${o.userVisibleOnly} ${[...o.applicationServerKey].join() === [...bytes(KEY)].join()}`);
      return sub(KEY);
    },
  } } as unknown as ServiceWorkerRegistration;
  return { reg, calls };
}

function fakeFetch(post: { status: number; body?: unknown }) {
  const reqs: { url: string; method: string; body?: unknown; keepalive?: boolean }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    reqs.push({ url, method: init.method ?? "GET", body: init.body && JSON.parse(init.body as string), keepalive: init.keepalive });
    if (url === `${PUSH_URL}/key`) return new Response(JSON.stringify({ key: KEY }), { status: 200 });
    if (init.method === "POST") return new Response(JSON.stringify(post.body ?? {}), { status: post.status });
    return new Response(null, { status: 204 });
  });
  return reqs;
}

afterEach(() => vi.unstubAllGlobals());

describe("startPush", () => {
  it("subscribes with the server's key and sends the link with the subscription", async () => {
    const reqs = fakeFetch({ status: 201, body: { id: "abc", until: 99 } });
    const { reg, calls } = fakeReg();
    expect(await startPush(reg, "1xyz")).toEqual({ id: "abc", until: 99 });
    expect(calls).toEqual(["subscribe true true"]);
    expect(reqs.at(-1)).toMatchObject({ url: `${PUSH_URL}/alerts`, method: "POST", body: { p: "1xyz", sub: subJson } });
  });

  it("keeps a subscription made with the same key, and replaces one made with another", async () => {
    fakeFetch({ status: 201, body: { id: "abc", until: 99 } });
    const same = fakeReg({ key: KEY });
    await startPush(same.reg, "1xyz");
    expect(same.calls).toEqual([]);
    const other = fakeReg({ key: "B" + KEY.slice(1, -2) + "AA" });
    await startPush(other.reg, "1xyz");
    expect(other.calls).toEqual(["unsubscribe", "subscribe true true"]);
  });

  it("gives null when the server refuses or is away", async () => {
    fakeFetch({ status: 409, body: { error: "old" } });
    expect(await startPush(fakeReg().reg, "1xyz")).toBeNull();
    vi.stubGlobal("fetch", async () => { throw new TypeError("offline"); });
    expect(await startPush(fakeReg().reg, "1xyz")).toBeNull();
  });
});

describe("stopPush", () => {
  it("deletes the alert, also while the page closes", async () => {
    const reqs = fakeFetch({ status: 201 });
    await stopPush("abc");
    expect(reqs).toEqual([{ url: `${PUSH_URL}/alerts/abc`, method: "DELETE", body: undefined, keepalive: true }]);
  });
});

describe("stopPush when the server is away", () => {
  it("keeps the stop and sends it again on the next load, until the server answers", async () => {
    const mem = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) });
    vi.stubGlobal("fetch", async () => new Response(null, { status: 503 }));
    await stopPush("abc");
    vi.stubGlobal("fetch", async () => { throw new TypeError("offline"); });
    await retryStops();
    expect(JSON.parse(mem.get("pushStops")!).map((x: [string, number]) => x[0])).toEqual(["abc"]);
    const reqs = fakeFetch({ status: 201 });
    await retryStops();
    expect(reqs.map(r => `${r.method} ${r.url}`)).toEqual([`DELETE ${PUSH_URL}/alerts/abc`]);
    expect(JSON.parse(mem.get("pushStops")!)).toEqual([]);
  });

  it("forgets a stop after its alert would have ended anyway", async () => {
    const mem = new Map([["pushStops", JSON.stringify([["old", Date.now() - 3 * 3600_000]])]]);
    vi.stubGlobal("localStorage", { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: () => {} });
    const reqs = fakeFetch({ status: 201 });
    await retryStops();
    expect(reqs).toEqual([]);
    expect(JSON.parse(mem.get("pushStops")!)).toEqual([]);
  });
});

describe("stopPush keeps the stop until the server confirms it", () => {
  const storage = () => {
    const mem = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) });
    return () => JSON.parse(mem.get("pushStops") ?? "[]").map((x: [string, number]) => x[0]);
  };

  it("writes it down before asking, so a page closed meanwhile still has it", async () => {
    const ids = storage();
    let answer!: (r: Response) => void;
    vi.stubGlobal("fetch", () => new Promise<Response>(r => (answer = r)));
    const done = stopPush("abc");
    expect(ids()).toEqual(["abc"]);
    answer(new Response(null, { status: 204 }));
    await done;
    expect(ids()).toEqual([]);
  });

  it("does not lose a stop made while older ones are sent again", async () => {
    const ids = storage();
    vi.stubGlobal("fetch", async () => new Response(null, { status: 503 }));
    await stopPush("old");
    const answers: ((r: Response) => void)[] = [];
    vi.stubGlobal("fetch", () => new Promise<Response>(r => answers.push(r)));
    const retry = retryStops();
    const fresh = stopPush("new");
    answers[1](new Response(null, { status: 503 }));   // "new" fails
    await fresh;
    answers[0](new Response(null, { status: 204 }));   // "old" is confirmed
    await retry;
    expect(ids()).toEqual(["new"]);
  });
});
