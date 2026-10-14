// @oasa_bus_bot: stop alerts in Telegram or as web push, no account. The page's 🔔 gives a link with the lines, variants
// and boarding stops (src/lib/tglink.ts); the bot watches those lines' live data and writes when a bus
// is within n stops (src/lib/alerts.ts, the page's rule). One-off: an alert ends after 2 hours.
// Recurring (Telegram only, a "2" link): on the chosen weekdays and times (Athens) it watches for the length of
// the window and sleeps otherwise; it never expires. A new OASA data version carries it over when its stops
// are still there (same line, variant and stop name), else ends it.
// Web push: the page sends the same link with its push subscription (POST /alerts, see web()).
// Design: docs/superpowers/specs/2026-10-07-stop-alerts-design.md (options B and C). IO comes in through
// BotDeps, so the logic runs in tests; bot/main.ts wires it to Telegram and the network.
//
// Delivery is at most once: state (alerts, fired trips, update offset) is saved before messages go out,
// and nothing goes out when the save fails. The update offset is saved only with what the updates
// changed: a crash in between gets the updates again from Telegram.

import { AlertWatch, hitText, type AlertSpec } from "../src/lib/alerts";
import { clock } from "../src/lib/format";
import { decodeAlert, type Rep } from "../src/lib/tglink";
import type { TripIndex } from "../src/lib/trip";
import type { LineLive, LineStatic } from "../src/lib/types";

export interface Fetched { status: number; body: unknown; date?: number }   // date: server time (ms)
export interface TgResult { ok: boolean; result?: unknown; error_code?: number; parameters?: { retry_after?: number } }
export interface BotDeps {
  urls: { trips: string; static: string; api: string };
  now(): number;
  sleep(ms: number): Promise<void>;
  save(s: BotState): void;
  tg(method: string, body: Record<string, unknown>): Promise<TgResult>;
  push(sub: PushSub, data: string): Promise<number>;   // the push service's HTTP status, 0 if unreachable
  get(url: string): Promise<Fetched>;
}
// A browser's push subscription (PushSubscription.toJSON()): all the bot keeps of the device.
export interface PushSub { endpoint: string; keys: { p256dh: string; auth: string } }
// To one Telegram chat or one push subscription.
export interface SavedAlert {
  id: string; chat?: number; push?: PushSub; ver: string; spec: AlertSpec; label: string;
  rep?: Rep;   // recurring: spec.until is the end of the current window (or of the last one)
  watch: ReturnType<AlertWatch["snapshot"]>;
}
export interface BotState { offset: number; alerts: SavedAlert[] }

interface Msg { chat: { id: number; type: string }; text?: string }
interface Callback { id: string; from: { id: number }; data?: string; message?: { chat: { id: number }; message_id: number } }
interface Update { update_id: number; message?: Msg; callback_query?: Callback }

const ALERT_MS = 2 * 3600_000;
const PER_CHAT = 5;
const REP_PER_CHAT = 5;        // recurring alerts per chat
const MAX_ALERTS = 200;
const MAX_LINES = 20;          // lines polled at once, for all chats
const REFRESH_MS = 6 * 3600_000;
const MISMATCH_MS = 10 * 60_000;   // sooner while the stop index and the backend's data differ
const FORCE_GAP_MS = 60_000;   // a link newer than the bot's data reloads it, at most this often
const START_GAP_MS = 2000;     // one new alert per chat this often
const SEND_GAP_MS = 40;        // Telegram: about 30 messages a second in all
const MIN_POLL_MS = 5000;      // the contract's floor per line
// Push services of the browsers: the bot sends only there, never to any other URL it is given.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];

type Made = { ok: true; a: SavedAlert; n: number } | { ok: false; why: "data" | "bad" | "old" | "updating" | "soon" | "busy" | "full" };

const HELP = "Γεια! Σου γράφω όταν το λεωφορείο σου πλησιάζει τη στάση σου.\n\n" +
  "Άνοιξε τον χάρτη https://bus.haroldpoi.dev, πάτα 🧭, διάλεξε από πού και προς τα πού, και μετά «Στο Telegram».\n\n" +
  "/list: οι ειδοποιήσεις σου.\n" +
  "/stop: σταματάει όλες τις ειδοποιήσεις.";

export class Bot {
  private state: BotState;
  private watches = new Map<string, AlertWatch>();
  private ix: TripIndex | null = null;
  private staticVer: string | null = null;
  private ixAt = -Infinity;
  private forcedAt = -Infinity;
  private loading: Promise<void> | null = null;
  private statics = new Map<string, LineStatic>();
  private lines = new Map<string, { next: number; busy: boolean; errors: number }>();
  private lastStart = new Map<number | string, number>();
  private queue: { method: string; body: Record<string, unknown> }[] = [];
  private draining: Promise<void> | null = null;

  constructor(private d: BotDeps, saved?: BotState) {
    this.state = { offset: saved?.offset ?? 0, alerts: saved?.alerts ?? [] };
    for (const a of this.state.alerts) this.watches.set(a.id, new AlertWatch(a.watch));
  }

  get offset() { return this.state.offset; }

  // Telegram updates (getUpdates), in order; the new offset is saved with what they changed.
  async handle(updates: Update[]) {
    let offset = this.state.offset;
    for (const u of updates) {
      offset = Math.max(offset, u.update_id + 1);
      try {
        if (u.message) await this.onMessage(u.message);
        else if (u.callback_query) this.onCallback(u.callback_query);
      } catch (e) {
        console.error("update failed:", (e as Error).message);
      }
    }
    const before = this.state.offset;
    this.state.offset = offset;
    if (!this.save()) this.state.offset = before;   // Telegram sends them again
  }

  // Once a second: end old alerts, ask the due lines.
  async tick() {
    const now = this.d.now();
    for (const a of this.state.alerts) if (a.rep) {   // a new window is a new alert for the watch: each day fires again
      const end = windowEnd(a.rep, now);
      if (end != null && a.spec.until !== end) a.spec.until = end;
    }
    const over = this.state.alerts.filter(a => !a.rep && now > a.spec.until * 1000);
    if (over.length) {
      this.remove(a => over.includes(a));
      if (this.save()) for (const a of over) if (a.chat != null)   // a push alert ends quietly: the page shows its end
        this.send(a.chat, `⌛ Τέλος ειδοποίησης για ${lineList(a)} (2 ώρες). Για νέα, πάτα πάλι 🔔 στον χάρτη.`);
    }
    if (!this.state.alerts.length) return;
    await this.loadData();
    const needed = new Set(this.state.alerts.filter(a => this.live(a, now)).flatMap(a => a.spec.lines.map(l => l.line)));
    await Promise.all([...needed].map(l => this.poll(l)));
  }

  // Sends what is queued, one at a time.
  flush(): Promise<void> {
    this.draining ??= this.drain().finally(() => (this.draining = null));
    return this.draining;
  }

  private async drain() {
    while (this.queue.length) {
      const m = this.queue.shift()!;
      if (m.method === "push") { await this.pushOne(m.body.sub as PushSub, m.body.data as string); continue; }
      let r = await this.d.tg(m.method, m.body);
      if (!r.ok && r.error_code === 429) {   // too fast: wait as told, try once more
        await this.d.sleep((r.parameters?.retry_after ?? 5) * 1000);
        r = await this.d.tg(m.method, m.body);
      }
      if (!r.ok && r.error_code === 403 && typeof m.body.chat_id === "number") {   // blocked by the user
        const chat = m.body.chat_id;
        this.remove(a => a.chat === chat);
        this.queue = this.queue.filter(q => q.body.chat_id !== chat);
        this.save();
      } else if (!r.ok) console.error(`telegram ${m.method}: ${r.error_code ?? "network"}`);
      await this.d.sleep(SEND_GAP_MS);
    }
  }

  private async onMessage(m: Msg) {
    const chat = m.chat.id;
    const [cmd, arg] = (m.text ?? "").trim().split(/\s+/);
    if (m.chat.type !== "private") return this.send(chat, "Δουλεύω μόνο σε προσωπική συζήτηση.");
    if (cmd === "/stop") {
      const had = this.state.alerts.some(a => a.chat === chat);
      this.remove(a => a.chat === chat);
      return this.send(chat, had ? "Σταμάτησαν όλες οι ειδοποιήσεις." : "Δεν είχες ειδοποιήσεις.");
    }
    if (cmd === "/list") return this.list(chat);
    if (cmd === "/start" && arg) return this.start(chat, arg);
    this.send(chat, HELP);
  }

  // One-off alerts, and recurring ones inside their window, are polled; the data must be the alert's own.
  private live(a: SavedAlert, now: number) {
    if (!a.rep) return true;
    return this.staticVer === this.ix?.v && windowEnd(a.rep, now) != null;
  }

  private list(chat: number) {
    const mine = this.state.alerts.filter(a => a.chat === chat);
    if (!mine.length) return this.send(chat, "Δεν έχεις ειδοποιήσεις.");
    const text = mine.map(a => (a.rep ? `🔁 ${repDays(a.rep.days)} ${hhmm(a.rep.start)}–${hhmm(a.rep.start + a.rep.len)}` : `🔔 έως ${clock(a.spec.until).slice(0, 5)}`) +
      ` · ${lineList(a)} · ${a.label}`).join("\n");
    const inline_keyboard = [
      ...mine.map(a => [{ text: `Σταμάτα ${lineList(a)} ${a.rep ? hhmm(a.rep.start) : clock(a.spec.until).slice(0, 5)}`, callback_data: `stop:${a.id}` }]),
      [{ text: "Απεγγραφή από όλα", callback_data: "all" }],
    ];
    this.queue.push({ method: "sendMessage", body: { chat_id: chat, text, disable_web_page_preview: true, reply_markup: { inline_keyboard } } });
  }

  private async start(chat: number, payload: string) {
    const m = await this.create(payload, chat, { chat });
    if (!m.ok) {
      if (m.why !== "soon") this.send(chat, {
        data: "Δεν φορτώνουν τα δεδομένα των στάσεων. Δοκίμασε σε λίγο.",
        old: "Ο σύνδεσμος είναι από παλιότερα δεδομένα στάσεων. Φτιάξε νέο από τον χάρτη.",
        bad: "Ο σύνδεσμος δεν είναι σωστός. Φτιάξε νέο από τον χάρτη: 🧭 → «Στο Telegram».",
        updating: "Τα δεδομένα του ΟΑΣΑ ενημερώνονται. Δοκίμασε ξανά αργότερα.",
        busy: "Πολλές ειδοποιήσεις αυτή τη στιγμή. Δοκίμασε σε λίγο.",
        full: `Έχεις ήδη ${REP_PER_CHAT} επαναλαμβανόμενες ειδοποιήσεις. Δες τες με /list και σταμάτα μία.`,
      }[m.why]);
      return;
    }
    const { a, n } = m, spec = a.spec;
    const at = [...new Set(spec.lines.flatMap(l => l.variants.map(v => `• ${l.line} στη στάση ${v.name}`)))].join("\n");
    const near = n === 1 ? "στην προηγούμενη στάση" : `έως ${n} στάσεις πριν`;
    if (a.rep) this.send(chat, `🔁 ${repDays(a.rep.days)} ${hhmm(a.rep.start)}–${hhmm(a.rep.start + a.rep.len)} θα σου γράφω όταν ένα λεωφορείο είναι ${near}:\n${at}\n` +
      "Σταμάτα με το κουμπί ή με /stop.", a.id);
    else this.send(chat, `🔔 Θα σου γράψω όταν ένα λεωφορείο είναι ${near}:\n${at}\nΈως ${clock(spec.until).slice(0, 5)}.`, a.id);
  }

  // The page's push API, behind bot/main.ts (which adds CORS, size and rate limits):
  //   POST /alerts {p: link payload, sub: PushSubscription} → 201 {id, until}; DELETE /alerts/{id} → 204.
  // The id is random and is the only way to stop an alert from outside.
  async web(req: { method: string; path: string; body: unknown }): Promise<{ status: number; body?: unknown }> {
    if (req.method === "POST" && req.path === "/alerts") {
      const b = req.body as { p?: unknown; sub?: unknown } | null;
      const sub = pushSub(b?.sub);
      if (!sub || typeof b?.p !== "string") return { status: 400, body: { error: "bad" } };
      const m = await this.create(b.p, sub.endpoint, { push: sub });
      if (!m.ok) return { status: { data: 503, updating: 503, bad: 400, old: 409, soon: 429, busy: 503, full: 409 }[m.why], body: { error: m.why } };
      return { status: 201, body: { id: m.a.id, until: m.a.spec.until } };
    }
    const id = req.method === "DELETE" && /^\/alerts\/([^/]{1,64})$/.exec(req.path)?.[1];
    if (id) {
      const before = this.state.alerts;
      if (before.some(a => a.id === id && a.push)) {
        this.state.alerts = before.filter(a => a.id !== id);
        // Not saved: a restart would bring it back, so it stays, and the page tries again.
        if (!this.save()) { this.state.alerts = before; return { status: 503, body: { error: "save" } }; }
        this.watches.delete(id);
        this.queue = this.queue.filter(q => q.body.alert !== id);   // its pushes not sent yet
      }
      return { status: 204 };
    }
    return { status: 404, body: { error: "not found" } };
  }

  // A new alert from a link payload, for one chat or push subscription (owner: what the limits count).
  private async create(payload: string, owner: number | string, to: { chat: number } | { push: PushSub }): Promise<Made> {
    await this.loadData();
    if (!this.ix) return { ok: false, why: "data" };
    let d = decodeAlert(this.ix, payload);
    if (!d.ok && d.why === "old" && this.d.now() - this.forcedAt > FORCE_GAP_MS) {   // the page may be newer than the bot
      this.forcedAt = this.d.now();
      await this.loadData(true);
      d = decodeAlert(this.ix, payload);
    }
    if (!d.ok) return { ok: false, why: d.why };
    if (d.rep && "push" in to) return { ok: false, why: "bad" };   // recurring is for Telegram only
    const ix = this.ix;
    if (this.staticVer !== ix.v) return { ok: false, why: "updating" };
    const now = this.d.now();
    if (now - (this.lastStart.get(owner) ?? -Infinity) < START_GAP_MS) return { ok: false, why: "soon" };
    // The oldest one-off alerts of this owner make room (recurring ones have their own limit); then the limits for everyone.
    const mine = this.state.alerts.filter(a => owns(a, owner));
    if (d.rep && mine.filter(a => a.rep).length >= REP_PER_CHAT) return { ok: false, why: "full" };
    const oneOff = mine.filter(a => !a.rep);
    const drop = new Set(d.rep ? [] : oneOff.slice(0, Math.max(0, oneOff.length - PER_CHAT + 1)));
    const rest = this.state.alerts.filter(a => !drop.has(a));
    const lines = new Set([...rest.flatMap(a => a.spec.lines.map(l => l.line)), ...d.lines.map(l => l.line)]);
    if (rest.length >= MAX_ALERTS || lines.size > MAX_LINES) return { ok: false, why: "busy" };
    this.lastStart.set(owner, now);
    const before = this.state.alerts;
    this.remove(a => drop.has(a));
    const name = (line: string, id: string, i: number) => ix.s[ix.l[line][id][i]][0];
    const spec: AlertSpec = {
      n: d.n, until: d.rep ? windowEnd(d.rep, now) ?? Math.floor(now / 1000) : Math.floor((now + ALERT_MS) / 1000),
      lines: d.lines.map(l => ({ line: l.line, variants: l.variants.map(v => ({ ...v, name: name(l.line, v.id, v.i) })) })),
    };
    const id = "push" in to ? crypto.randomUUID().replaceAll("-", "") : Math.random().toString(36).slice(2, 10);
    const a: SavedAlert = { id, ...to, ver: ix.v, spec, label: spec.lines[0].variants[0].name!, ...(d.rep && { rep: d.rep }), watch: new AlertWatch().snapshot() };
    this.state.alerts.push(a);
    this.watches.set(a.id, new AlertWatch());
    // Telegram saves it with the update offset (handle()); a push alert is answered now, so saved now.
    // On a failed save all is as before (the dropped alerts' watches come back from their snapshots).
    if ("push" in to && !this.save()) { this.watches.delete(a.id); this.state.alerts = before; return { ok: false, why: "busy" }; }
    return { ok: true, a, n: d.n };
  }

  private onCallback(q: Callback) {
    const user = q.from.id, data = q.data ?? "";
    let text = "Τίποτα για σταμάτημα.";
    if (data === "all" || data.startsWith("stop:")) {
      const id = data.slice(5);
      const mine = (a: SavedAlert) => a.chat === user && (data === "all" || a.id === id);
      if (this.state.alerts.some(mine)) {
        this.remove(mine);
        text = data === "all" ? "Σταμάτησαν όλες." : "Σταμάτησε.";
        if (q.message && q.message.chat.id === user)
          this.queue.push({ method: "editMessageReplyMarkup", body: { chat_id: user, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } } });
      }
    }
    this.queue.push({ method: "answerCallbackQuery", body: { callback_query_id: q.id, text } });
  }

  // trips.json and the backend's static version, every 6 h (now, when forced). A new version ends the
  // alerts made from the old one: their stop positions may not hold.
  private loadData(force = false): Promise<void> {
    if (!force && this.d.now() - this.ixAt < (this.ix && this.staticVer !== this.ix.v ? MISMATCH_MS : REFRESH_MS)) return Promise.resolve();
    this.loading ??= (async () => {
      const [t, s] = await Promise.all([this.d.get(this.d.urls.trips), this.d.get(`${this.d.urls.static}/lines.json`)]);
      if (t.status !== 200 || s.status !== 200 || !isIndex(t.body)) return;
      const sv = (s.body as { gtfs_version?: unknown }).gtfs_version;
      this.ix = t.body;
      this.ixAt = this.d.now();
      if (typeof sv === "string" && sv !== this.staticVer) { this.staticVer = sv; this.statics.clear(); }
      const ix = this.ix, same = this.staticVer === ix.v;
      const old: SavedAlert[] = [];
      let carried = false;
      for (const a of this.state.alerts) {
        if (a.rep && !same) continue;   // left as it is until the static data catches up
        if (a.ver === ix.v && same) continue;
        if (a.rep && carry(a, ix)) {
          this.watches.set(a.id, new AlertWatch());
          a.watch = new AlertWatch().snapshot();
          carried = true;
        } else old.push(a);
      }
      if (old.length || carried) {
        this.remove(a => old.includes(a));
        if (this.save()) for (const a of old) this.tell(a, `Τα δρομολόγια του ΟΑΣΑ άλλαξαν: η ειδοποίηση για ${lineList(a)} σταμάτησε. Φτιάξε νέα από τον χάρτη.`);
      }
    })().catch(e => console.error("data:", (e as Error).message)).finally(() => (this.loading = null));
    return this.loading;
  }

  // One line: one request at a time, at the line's next update (2 s after), never within 5 s.
  private async poll(line: string) {
    const now = this.d.now();
    let st = this.lines.get(line);
    if (!st) this.lines.set(line, (st = { next: 0, busy: false, errors: 0 }));
    if (st.busy || now < st.next) return;
    st.busy = true;
    try {
      let stat = this.statics.get(line);
      if (!stat) {
        const r = await this.d.get(`${this.d.urls.static}/lines/${encodeURIComponent(line)}.json`);
        if (r.status !== 200 || !r.body || typeof r.body !== "object") throw new Error(`static ${r.status}`);
        this.statics.set(line, (stat = r.body as LineStatic));
      }
      const r = await this.d.get(`${this.d.urls.api}/v1/lines/${encodeURIComponent(line)}`);
      const body = r.body as LineLive | null;
      if (r.status !== 200 || !body || !Array.isArray(body.vehicles)) throw new Error(`live ${r.status}`);
      const after = this.d.now(), skew = r.date != null ? r.date - after : 0;
      st.errors = 0;
      st.next = Math.max(body.next_update_at * 1000 - skew + 2000, after + MIN_POLL_MS);
      this.check(line, body, stat, (after + skew) / 1000);
    } catch (e) {
      st.errors++;
      st.next = this.d.now() + Math.min(60_000, 10_000 * 2 ** (st.errors - 1));
      console.error(`line ${line}:`, (e as Error).message);
    } finally {
      st.busy = false;
    }
  }

  private check(line: string, live: LineLive, stat: LineStatic, nowS: number) {
    const out: { a: SavedAlert; text: string }[] = [];
    for (const a of this.state.alerts) {   // read now: alerts stopped during the request are gone
      if (!a.spec.lines.some(l => l.line === line) || !this.live(a, this.d.now())) continue;
      const w = this.watches.get(a.id) ?? new AlertWatch(a.watch);
      this.watches.set(a.id, w);
      for (const h of w.check(a.spec, { [line]: live }, { [line]: stat }, nowS))
        out.push({ a, text: `🚌 ${hitText(h, stat.stops[h.stop]?.name.trim() ?? a.label)}` });
      a.watch = w.snapshot();
    }
    if (out.length && this.save()) for (const m of out) this.tell(m.a, m.text);
  }

  // To the alert's chat (with its stop buttons) or push subscription.
  private tell(a: SavedAlert, text: string) {
    if (a.push) this.queue.push({ method: "push", body: { alert: a.id, sub: a.push, data: JSON.stringify({ title: "Λεωφορείο", body: text, tag: a.id }) } });
    else if (a.chat != null) this.send(a.chat, text, a.id);
  }

  // 404/410: the browser dropped the subscription, so its alerts go.
  private async pushOne(sub: PushSub, data: string) {
    const status = await this.d.push(sub, data);
    if (status === 404 || status === 410) {
      this.remove(a => a.push?.endpoint === sub.endpoint);
      this.queue = this.queue.filter(q => (q.body.sub as PushSub | undefined)?.endpoint !== sub.endpoint);
      this.save();
    } else if (status < 200 || status >= 300) console.error(`push: ${status || "network"}`);
  }

  private send(chat: number, text: string, alertId?: string) {
    const body: Record<string, unknown> = { chat_id: chat, text, disable_web_page_preview: true };
    if (alertId) body.reply_markup = { inline_keyboard: [[
      { text: "Σταμάτα", callback_data: `stop:${alertId}` }, { text: "Απεγγραφή από όλα", callback_data: "all" },
    ]] };
    this.queue.push({ method: "sendMessage", body });
  }

  private remove(f: (a: SavedAlert) => boolean) {
    for (const a of this.state.alerts) if (f(a)) this.watches.delete(a.id);
    this.state.alerts = this.state.alerts.filter(a => !f(a));
  }

  private save(): boolean {
    try {
      this.d.save(this.state);
      return true;
    } catch (e) {
      console.error("save failed:", (e as Error).message);
      return false;
    }
  }
}

const owns = (a: SavedAlert, owner: number | string) => (typeof owner === "number" ? a.chat === owner : a.push?.endpoint === owner);

// A subscription the bot may send to: https, a known push service, keys of the right size.
function pushSub(x: unknown): PushSub | null {
  const s = x as PushSub | null;
  if (!s || typeof s.endpoint !== "string" || s.endpoint.length > 1024 || !s.keys) return null;
  const { p256dh, auth } = s.keys;
  if (typeof p256dh !== "string" || !/^[A-Za-z0-9_-]{87}$/.test(p256dh) || typeof auth !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(auth)) return null;
  let u: URL;
  try { u = new URL(s.endpoint); } catch { return null; }
  if (u.protocol !== "https:" || u.port || u.username || !PUSH_HOSTS.some(h => h.test(u.hostname))) return null;
  return { endpoint: s.endpoint, keys: { p256dh, auth } };
}

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const DAYS = ["Δευ", "Τρί", "Τετ", "Πέμ", "Παρ", "Σάβ", "Κυρ"];
const repDays = (days: number) => days === 31 ? "Τις καθημερινές" : days === 127 ? "Κάθε μέρα" : days === 96 ? "Τα Σαββατοκύριακα" :
  "Κάθε " + DAYS.filter((_, k) => days & (1 << k)).join(", ");

const athens = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Athens", weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit", day: "2-digit" });
const parts = (f: Intl.DateTimeFormat, t: number) => Object.fromEntries(f.formatToParts(t).map(x => [x.type, x.value]));

// Athens wall time (that day, `min` minutes after midnight) as Unix s. One answer for a time that
// comes twice when the clocks go back, so a window keeps one end (the watch would fire again).
function athensAt(day: { year: string; month: string; day: string }, min: number): number {
  const wall = Date.UTC(+day.year, +day.month - 1, +day.day, 0, min);
  const offset = (t: number) => {   // Athens minus UTC at t
    const d = parts(ymd, t), h = parts(athens, t);
    return Date.UTC(+d.year, +d.month - 1, +d.day, +h.hour, +h.minute) - Math.floor(t / 60_000) * 60_000;
  };
  let t = wall - 2 * 3600_000;   // Athens is UTC+2 or +3
  t = wall - offset(t);
  return Math.floor((wall - offset(t)) / 1000);
}

// The end (Unix s) of the recurring alert's window if it is in it at `now` (ms), else null.
export function windowEnd(r: Rep, now: number): number | null {
  const p = parts(athens, now);
  const day = WEEK.indexOf(p.weekday), min = +p.hour * 60 + +p.minute;
  if (day < 0 || !(r.days & (1 << day)) || min < r.start || min >= r.start + r.len) return null;
  return athensAt(parts(ymd, now) as { year: string; month: string; day: string }, r.start + r.len);
}

// A recurring alert on the new index: every entry keeps its line, variant and stop name (at its old
// position if the name is still there, else the first stop of that name). False, and unchanged, if not.
function carry(a: SavedAlert, ix: TripIndex): boolean {
  const lines: AlertSpec["lines"] = [];
  for (const l of a.spec.lines) {
    const variants: AlertSpec["lines"][number]["variants"] = [];
    for (const v of l.variants) {
      const seq = ix.l[l.line]?.[v.id];
      if (!seq || v.name == null) return false;
      const at = (i: number) => ix.s[seq[i]]?.[0] === v.name;
      const i = v.i < seq.length && at(v.i) ? v.i : seq.findIndex((_, k) => at(k));
      if (i < 0) return false;
      variants.push({ ...v, i });
    }
    lines.push({ line: l.line, variants });
  }
  a.spec.lines = lines;
  a.ver = ix.v;
  return true;
}

const lineList = (a: SavedAlert) => a.spec.lines.map(l => l.line).join(", ");

function isIndex(b: unknown): b is TripIndex {
  const x = b as TripIndex | null;
  return !!x && typeof x.v === "string" && Array.isArray(x.s) && !!x.l && typeof x.l === "object";
}
