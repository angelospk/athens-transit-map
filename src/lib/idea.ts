// The old idea form: a Google Form field posted from the page (no-cors). feedback.ts falls back to it
// while no Apps Script URL is set. The follow link closes the feedback thanks.

export const FORM_URL = "https://docs.google.com/forms/d/e/1FAIpQLSdBJSeu7xzH0ma5GWn7hIlcaaPPmOSTP9bD5D_NA-f1FhHyLQ/formResponse";
export const FORM_FIELD = "entry.560097671";
export const FOLLOW_URL = "https://x.com/intent/follow?screen_name=twiceuponatimes";
export type IdeaStatus = "edit" | "sending" | "failed" | "done";
