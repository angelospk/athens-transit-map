// Light, dark, or whatever the device uses. The page is marked with data-theme for light and dark
// (app.css reads it); with "system" the mark is left off and the device's setting decides.

export type Theme = "system" | "light" | "dark";

export const isTheme = (v: unknown): v is Theme => v === "system" || v === "light" || v === "dark";

export const resolveDark = (t: Theme, systemDark: boolean) => (t === "system" ? systemDark : t === "dark");

export function applyTheme(t: Theme, root: HTMLElement = document.documentElement) {
  if (t === "system") root.removeAttribute("data-theme");
  else root.dataset.theme = t;
}
