// One Telegram poller for every city's bot (web#56): bot/main.ts reads getUpdates once and hands each
// update here; the router picks the city and passes the update on to that city's Bot.
//
// - A start link names its city before its payload: start=<code>_<payload> ("pat_1…"). No prefix is
//   Athens, so the links already shared keep working. The link's city becomes the chat's city.
// - A button names its city before its data: "<code>:b:<stop>" (Bot adds it, BotDeps.prefix). No prefix
//   is Athens (its buttons have none, also those of old messages).
// - Free text, a location, /stasi, /fav and /start alone go to the chat's city: the last link's, or the one
//   picked from /city. Default: Athens.
// - /list, /stop and «Απεγγραφή από όλα» ("all") see every city: one message, one answer.
//
// The offset is the router's, saved with the chats' cities after each update. An update goes on only when
// its city saved what it changed (Bot.handle) and the router saved its offset; else the offset stays before
// it and Telegram sends it again. The router's own answers go out only after that save. A crash between a
// city's save and the router's replays that one update.

import type { Bot, Button } from "./bot";

export interface TgCity { code: string; name: string; bot: Bot }   // code: 3 letters; the first city is Athens
export interface RouterState { offset: number; city?: Record<string, string> }   // chat → the code of its city
export interface RouterDeps { cities: TgCity[]; save(s: RouterState): void }

interface Msg { chat: { id: number; type: string }; text?: string }
interface Callback { id: string; from: { id: number }; data?: string; message?: { chat: { id: number }; message_id: number } }
interface Update { update_id: number; message?: Msg; callback_query?: Callback }

// One /list message: Telegram takes 4096 characters and 100 buttons; the rest goes in the next message.
const LIST_CHARS = 4000, LIST_BUTTONS = 90;

export class Router {
  private state: RouterState;
  private pending: [string, Record<string, unknown>][] = [];   // this update's answers, sent once it is saved

  // offset0: where to start without a saved state (the Athens bot's offset, from before the router).
  constructor(private d: RouterDeps, saved?: RouterState, offset0 = 0) {
    this.state = { offset: saved?.offset ?? offset0, city: { ...saved?.city } };
  }

  get offset() { return this.state.offset; }

  private get athens(): TgCity { return this.d.cities[0]; }
  private byCode(code: string | undefined): TgCity | undefined { return this.d.cities.find(c => c.code === code); }
  private cityOf(chat: number): TgCity { return this.byCode(this.state.city![String(chat)]) ?? this.athens; }
  private setCity(chat: number, c: TgCity) { this.state.city![String(chat)] = c.code; }

  async handle(updates: Update[]) {
    for (const u of updates) {
      const before = { offset: this.state.offset, city: { ...this.state.city } };
      this.pending = [];
      let ok = true;
      try {
        ok = await this.one(u);
      } catch (e) {
        console.error("route failed:", (e as Error).message);
      }
      if (ok) {
        this.state.offset = Math.max(this.state.offset, u.update_id + 1);
        try { this.d.save(this.state); } catch (e) { console.error("router save failed:", (e as Error).message); ok = false; }
      }
      if (!ok) { this.state = before; this.pending = []; break; }
      for (const [method, body] of this.pending) this.athens.bot.out(method, body);
      this.pending = [];
    }
  }

  // True when the update is done (its city saved it, or the router answered it).
  private async one(u: Update): Promise<boolean> {
    if (u.message) {
      const m = u.message, chat = m.chat.id;
      if (m.chat.type !== "private") return this.athens.bot.handle([u]);
      const [cmd, arg] = (m.text ?? "").trim().split(/\s+/);
      if (cmd === "/list") return this.list(chat), true;
      if (cmd === "/stop") return this.stop(chat);
      if (cmd === "/city") return this.menu(chat), true;
      if (cmd === "/start" && arg) {
        const p = /^([a-z]{3})_(.+)$/.exec(arg);
        const c = p ? this.byCode(p[1]) : this.athens;
        if (!c) return this.athens.bot.handle([u]);   // an unknown prefix: Athens says the link is bad
        this.setCity(chat, c);
        return c.bot.handle([p ? { ...u, message: { ...m, text: `/start ${p[2]}` } } : u]);
      }
      return this.cityOf(chat).bot.handle([u]);
    }
    const q = u.callback_query;
    if (!q) return true;
    const data = q.data ?? "";
    if (data === "all") return this.stopAll(q);
    const pick = /^city:([a-z]{3})$/.exec(data);
    if (pick) return this.pick(q, pick[1]), true;
    const p = /^([a-z]{3}):(.+)$/.exec(data);
    const c = p ? this.byCode(p[1]) : undefined;
    if (c && p) return c.bot.handle([{ ...u, callback_query: { ...q, data: p[2] } }]);
    return this.athens.bot.handle([u]);
  }

  private out(method: string, body: Record<string, unknown>) { this.pending.push([method, body]); }

  private say(chat: number, text: string, inline_keyboard?: Button[][]) {
    this.out("sendMessage", { chat_id: chat, text, disable_web_page_preview: true, ...(inline_keyboard && { reply_markup: { inline_keyboard } }) });
  }

  private list(chat: number) {
    const parts = this.d.cities.map(c => ({ c, ...c.bot.chatAlerts(chat) })).filter(p => p.lines.length);
    if (!parts.length) return this.say(chat, "Δεν έχεις ειδοποιήσεις.");
    const many = parts.length > 1;
    // chatAlerts gives one button row per line, in the same order.
    const rows = parts.flatMap(p => p.lines.map((l, i) => ({ line: many ? `${p.c.name} · ${l}` : l, buttons: p.buttons[i] ?? [] })));
    let text: string[] = [], keys: Button[][] = [], size = 0;
    for (const r of rows) {
      if (text.length && (size + r.line.length + 1 > LIST_CHARS || keys.length >= LIST_BUTTONS)) {
        this.say(chat, text.join("\n"), keys);
        text = []; keys = []; size = 0;
      }
      text.push(r.line); keys.push(r.buttons); size += r.line.length + 1;
    }
    this.say(chat, text.join("\n"), [...keys, [{ text: "Απεγγραφή από όλα", callback_data: "all" }]]);
  }

  // Every city, none skipped: each one saves its own. "failed" if any could not.
  private stopEverywhere(chat: number): "none" | "stopped" | "failed" {
    const all = this.d.cities.map(c => c.bot.stopChat(chat));
    return all.includes("failed") ? "failed" : all.includes("stopped") ? "stopped" : "none";
  }

  // False when a city could not save: no answer, and the update comes again.
  private stop(chat: number): boolean {
    const r = this.stopEverywhere(chat);
    if (r === "failed") return false;
    this.say(chat, r === "stopped" ? "Σταμάτησαν όλες οι ειδοποιήσεις." : "Δεν είχες ειδοποιήσεις.");
    return true;
  }

  private stopAll(q: Callback): boolean {
    const user = q.from.id, r = this.stopEverywhere(user);
    if (r === "failed") return false;
    if (r === "stopped" && q.message && q.message.chat.id === user)
      this.out("editMessageReplyMarkup", { chat_id: user, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } });
    this.out("answerCallbackQuery", { callback_query_id: q.id, text: r === "stopped" ? "Σταμάτησαν όλες." : "Τίποτα για σταμάτημα." });
    return true;
  }

  private menu(chat: number) {
    const rows: Button[][] = [];
    const all = this.d.cities.map(c => ({ text: c.name, callback_data: `city:${c.code}` }));
    for (let i = 0; i < all.length; i += 3) rows.push(all.slice(i, i + 3));
    this.say(chat, `Πόλη τώρα: ${this.cityOf(chat).name}. Διάλεξε πόλη για τις στάσεις:`, rows);
  }

  private pick(q: Callback, code: string) {
    const c = this.byCode(code);
    if (!c) return this.out("answerCallbackQuery", { callback_query_id: q.id, text: "Δεν βρήκα αυτή την πόλη." });
    this.setCity(q.from.id, c);
    this.out("answerCallbackQuery", { callback_query_id: q.id, text: `Πόλη: ${c.name}` });
    this.say(q.from.id, `Πόλη: ${c.name}. Γράψε όνομα στάσης ή πάτα 📍 Κοντά μου.`);
  }
}
