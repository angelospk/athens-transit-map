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
// The offset is the router's, saved with the chats' cities. An update goes on only when its city saved what
// it changed (Bot.handle); else the offset stays before it and Telegram sends it again.

import type { Bot, Button } from "./bot";

export interface TgCity { code: string; name: string; bot: Bot }   // code: 3 letters; the first city is Athens
export interface RouterState { offset: number; city?: Record<string, string> }   // chat → the code of its city
export interface RouterDeps { cities: TgCity[]; save(s: RouterState): void }

interface Msg { chat: { id: number; type: string }; text?: string }
interface Callback { id: string; from: { id: number }; data?: string; message?: { chat: { id: number }; message_id: number } }
interface Update { update_id: number; message?: Msg; callback_query?: Callback }

const MAX_LIST = 50;   // lines and buttons of the joint /list (Telegram: 100 buttons, 4096 characters)

export class Router {
  private state: RouterState;

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
      let ok = true;
      try {
        ok = await this.one(u);
      } catch (e) {
        console.error("route failed:", (e as Error).message);
      }
      if (!ok) break;
      this.state.offset = Math.max(this.state.offset, u.update_id + 1);
    }
    try { this.d.save(this.state); } catch (e) { console.error("router save failed:", (e as Error).message); }
  }

  // True when the update is done (its city saved it, or the router answered it).
  private async one(u: Update): Promise<boolean> {
    if (u.message) {
      const m = u.message, chat = m.chat.id;
      if (m.chat.type !== "private") return this.athens.bot.handle([u]);
      const [cmd, arg] = (m.text ?? "").trim().split(/\s+/);
      if (cmd === "/list") return this.list(chat), true;
      if (cmd === "/stop") return this.stop(chat), true;
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
    if (data === "all") return this.stopAll(q), true;
    const pick = /^city:([a-z]{3})$/.exec(data);
    if (pick) return this.pick(q, pick[1]), true;
    const p = /^([a-z]{3}):(.+)$/.exec(data);
    const c = p ? this.byCode(p[1]) : undefined;
    if (c && p) return c.bot.handle([{ ...u, callback_query: { ...q, data: p[2] } }]);
    return this.athens.bot.handle([u]);
  }

  private say(chat: number, text: string, inline_keyboard?: Button[][]) {
    this.athens.bot.out("sendMessage", { chat_id: chat, text, disable_web_page_preview: true, ...(inline_keyboard && { reply_markup: { inline_keyboard } }) });
  }

  private list(chat: number) {
    const parts = this.d.cities.map(c => ({ c, ...c.bot.chatAlerts(chat) })).filter(p => p.lines.length);
    if (!parts.length) return this.say(chat, "Δεν έχεις ειδοποιήσεις.");
    const many = parts.length > 1;
    const lines = parts.flatMap(p => p.lines.map(l => (many ? `${p.c.name} · ${l}` : l))).slice(0, MAX_LIST);
    const buttons = parts.flatMap(p => p.buttons).slice(0, MAX_LIST);
    this.say(chat, lines.join("\n"), [...buttons, [{ text: "Απεγγραφή από όλα", callback_data: "all" }]]);
  }

  // Every city, none skipped: each one saves its own.
  private stopEverywhere(chat: number): boolean {
    return this.d.cities.map(c => c.bot.stopChat(chat)).some(Boolean);
  }

  private stop(chat: number) {
    this.say(chat, this.stopEverywhere(chat) ? "Σταμάτησαν όλες οι ειδοποιήσεις." : "Δεν είχες ειδοποιήσεις.");
  }

  private stopAll(q: Callback) {
    const user = q.from.id, had = this.stopEverywhere(user);
    if (had && q.message && q.message.chat.id === user)
      this.athens.bot.out("editMessageReplyMarkup", { chat_id: user, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } });
    this.athens.bot.out("answerCallbackQuery", { callback_query_id: q.id, text: had ? "Σταμάτησαν όλες." : "Τίποτα για σταμάτημα." });
  }

  private menu(chat: number) {
    const rows: Button[][] = [];
    const all = this.d.cities.map(c => ({ text: c.name, callback_data: `city:${c.code}` }));
    for (let i = 0; i < all.length; i += 3) rows.push(all.slice(i, i + 3));
    this.say(chat, `Πόλη τώρα: ${this.cityOf(chat).name}. Διάλεξε πόλη για τις στάσεις:`, rows);
  }

  private pick(q: Callback, code: string) {
    const c = this.byCode(code);
    if (!c) return this.athens.bot.out("answerCallbackQuery", { callback_query_id: q.id, text: "Δεν βρήκα αυτή την πόλη." });
    this.setCity(q.from.id, c);
    this.athens.bot.out("answerCallbackQuery", { callback_query_id: q.id, text: `Πόλη: ${c.name}` });
    this.say(q.from.id, `Πόλη: ${c.name}. Γράψε όνομα στάσης ή πάτα 📍 Κοντά μου.`);
  }
}
