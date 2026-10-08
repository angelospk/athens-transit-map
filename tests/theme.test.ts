import { describe, expect, it } from "vitest";
import { applyTheme, isTheme, resolveDark } from "../src/lib/theme";

describe("theme", () => {
  it("system follows the device; light and dark do not", () => {
    expect(resolveDark("system", true)).toBe(true);
    expect(resolveDark("system", false)).toBe(false);
    expect(resolveDark("dark", false)).toBe(true);
    expect(resolveDark("light", true)).toBe(false);
  });

  it("knows the three themes", () => {
    for (const t of ["system", "light", "dark"]) expect(isTheme(t)).toBe(true);
    for (const t of ["sepia", "", null, undefined, 1]) expect(isTheme(t)).toBe(false);
  });

  it("marks the page for light and dark, and leaves system to the device", () => {
    const root = { dataset: {} as Record<string, string>, removeAttribute(n: string) { if (n === "data-theme") delete this.dataset.theme; } };
    applyTheme("dark", root as unknown as HTMLElement);
    expect(root.dataset.theme).toBe("dark");
    applyTheme("light", root as unknown as HTMLElement);
    expect(root.dataset.theme).toBe("light");
    applyTheme("system", root as unknown as HTMLElement);
    expect(root.dataset.theme).toBeUndefined();
  });
});
