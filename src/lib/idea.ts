// The "app is coming" idea box, a tab of the ⓘ sheet. Ideas go to a Google Form field straight from the page
// (no-cors: the reply cannot be read, only a network failure shows).

export const FORM_URL = "https://docs.google.com/forms/d/e/1FAIpQLSdBJSeu7xzH0ma5GWn7hIlcaaPPmOSTP9bD5D_NA-f1FhHyLQ/formResponse";
export const FORM_FIELD = "entry.560097671";
export const FOLLOW_URL = "https://x.com/intent/follow?screen_name=twiceuponatimes";
export const MIN_IDEA = 3;
export const MAX_IDEA = 1000;
export type IdeaStatus = "edit" | "sending" | "failed" | "done";

export function canSend(text: string): boolean {
  const n = text.trim().length;
  return n >= MIN_IDEA && n <= MAX_IDEA;
}

/** Posts the idea to the form. True unless the request failed (offline) or the text is not sendable. */
export async function sendIdea(text: string, fetchFn: typeof fetch = fetch): Promise<boolean> {
  if (!canSend(text)) return false;
  try {
    await fetchFn(FORM_URL, { method: "POST", mode: "no-cors", body: new URLSearchParams({ [FORM_FIELD]: text.trim() }) });
    return true;
  } catch { return false; }
}
