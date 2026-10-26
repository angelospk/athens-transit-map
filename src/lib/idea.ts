// The "app is coming" idea box: a phone button under the map tools. Its label opens by itself at most twice
// (15 s into the first visit, 30 s into the second) and never once an idea was sent. Ideas go to a Google Form
// field straight from the page (no-cors: the reply cannot be read, only a network failure shows).

export const FORM_URL = "https://docs.google.com/forms/d/e/1FAIpQLSdBJSeu7xzH0ma5GWn7hIlcaaPPmOSTP9bD5D_NA-f1FhHyLQ/formResponse";
export const FORM_FIELD = "entry.560097671";
export const FOLLOW_URL = "https://x.com/intent/follow?screen_name=twiceuponatimes";
export const MIN_IDEA = 3;
export const MAX_IDEA = 1000;
/** How long the label stays open when it opens by itself. */
export const PEEK_MS = 6_000;

export type IdeaState = { sent: boolean; visits: number };
export type IdeaStatus = "edit" | "sending" | "failed" | "done";
type Store = Pick<Storage, "getItem" | "setItem">;

const SENT = "ideaSent", VISITS = "ideaVisits", COUNTED = "ideaVisitCounted";

/** Milliseconds of visible use before the label opens by itself, or null: not on this visit. */
export function peekDelayMs(s: IdeaState): number | null {
  if (s.sent) return null;
  return s.visits === 1 ? 15_000 : s.visits === 2 ? 30_000 : null;
}

export function canSend(text: string): boolean {
  const n = text.trim().length;
  return n >= MIN_IDEA && n <= MAX_IDEA;
}

export function loadIdea(local: Store): IdeaState {
  try {
    const sent = JSON.parse(local.getItem(SENT) ?? "false");
    const visits = JSON.parse(local.getItem(VISITS) ?? "0");
    return { sent: sent === true, visits: Number.isInteger(visits) && visits > 0 ? visits : 0 };
  } catch { return { sent: false, visits: 0 }; }
}

/** Counts this visit (once per tab session; a reload is the same visit). Blocked storage counts nothing. */
export function countVisit(local: Store, session: Store): IdeaState {
  const s = loadIdea(local);
  try {
    if (session.getItem(COUNTED)) return s;
    const visits = s.visits + 1;
    local.setItem(VISITS, JSON.stringify(visits));
    session.setItem(COUNTED, "1");
    return { ...s, visits };
  } catch { return s; }
}

export function markSent(local: Store) {
  try { local.setItem(SENT, "true"); } catch { /* private mode */ }
}

/** Posts the idea to the form. True unless the request failed (offline) or the text is not sendable. */
export async function sendIdea(text: string, fetchFn: typeof fetch = fetch): Promise<boolean> {
  if (!canSend(text)) return false;
  try {
    await fetchFn(FORM_URL, { method: "POST", mode: "no-cors", body: new URLSearchParams({ [FORM_FIELD]: text.trim() }) });
    return true;
  } catch { return false; }
}

const PEEKED = "ideaPeeked";
/** The label already opened by itself in this tab (a reload must not open it again). Blocked storage: true. */
export function wasPeeked(session: Store): boolean {
  try { return session.getItem(PEEKED) != null; } catch { return true; }
}
export function markPeeked(session: Store) {
  try { session.setItem(PEEKED, "1"); } catch { /* storage blocked */ }
}
