// Feedback from the ⓘ sheet: text, an optional screenshot, the version and the page. It goes to a
// Google Apps Script web app (docs/feedback/Code.gs), which writes a row to a Sheet and the image to
// Drive (it answers {ok}). Google Forms takes no files from anonymous users, hence the script. Without its URL
// (VITE_FEEDBACK_URL unset) the text alone goes to the old idea form.
import { FORM_FIELD, FORM_URL } from "./idea";

export const FEEDBACK_URL: string = import.meta.env.VITE_FEEDBACK_URL || "";
export const MIN_TEXT = 3;
export const MAX_TEXT = 2000;
export const MAX_SIDE = 1600; // px: a phone screenshot stays readable at ~200-400 KB as JPEG

export interface Feedback {
  text: string;
  version: string;
  page: string;
  ua: string;
  image?: { type: string; data: string }; // base64, no data: prefix
}

export function canSendFeedback(text: string): boolean {
  const n = text.trim().length;
  return n >= MIN_TEXT && n <= MAX_TEXT;
}

export function feedbackBody(f: Feedback): string {
  const { image, ...rest } = f;
  return JSON.stringify({ ...rest, text: f.text.trim(), ...(image ? { image } : {}) });
}

/** True only when the script answered {ok: true} (the old form: unless the request failed). */
export async function sendFeedback(f: Feedback, url = FEEDBACK_URL, fetchFn: typeof fetch = fetch): Promise<boolean> {
  if (!canSendFeedback(f.text)) return false;
  try {
    if (url) {
      // A string body is sent as text/plain: no CORS preflight, and Apps Script's reply is readable.
      const res = await fetchFn(url, { method: "POST", body: feedbackBody(f) });
      return res.ok && (await res.json())?.ok === true;
    }
    // The Google Form answers no CORS: no-cors, so only a network failure shows.
    await fetchFn(FORM_URL, { method: "POST", mode: "no-cors",
      body: new URLSearchParams({ [FORM_FIELD]: `${f.text.trim()}\n\n[${f.version} · ${f.page}]` }) });
    return true;
  } catch { return false; }
}

/** The size that fits w×h inside max×max, ratio kept, never larger. */
export function fitInside(w: number, h: number, max: number): [number, number] {
  const k = Math.min(1, max / Math.max(w, h));
  return [Math.round(w * k), Math.round(h * k)];
}

/** A picked image as a JPEG of at most MAX_SIDE px (browser only). */
export async function shrinkImage(file: Blob): Promise<{ type: string; data: string }> {
  const bmp = await createImageBitmap(file);
  const [w, h] = fitInside(bmp.width, bmp.height, MAX_SIDE);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const url = c.toDataURL("image/jpeg", 0.82);
  return { type: "image/jpeg", data: url.slice(url.indexOf(",") + 1) };
}
