import { describe, expect, it } from "vitest";
import { bannerMessages } from "../src/lib/banner";
import type { Status } from "../src/lib/types";

const ok = { ok: true } as Status, bad = { ok: false } as Status;

describe("bannerMessages", () => {
  it("is quiet when the server answers and no line is stale", () => {
    expect(bannerMessages(false, ok, [])).toEqual({ offline: false, messages: [] });
  });
  it("says offline when the last status call failed, also after an earlier success", () => {
    const b = bannerMessages(true, ok, []);
    expect(b.offline).toBe(true);
    expect(b.messages[0]).toMatch(/σύνδεση/);
  });
  it("drops the old server-problem line while offline", () => {
    expect(bannerMessages(true, bad, []).messages).toHaveLength(1);
    expect(bannerMessages(false, bad, []).messages[0]).toMatch(/πρόβλημα/);
  });
  it("names stale lines", () => {
    expect(bannerMessages(false, ok, ["040", "Α1"]).messages).toEqual(["Χωρίς ενημέρωση πάνω από 2 λεπτά: 040, Α1."]);
  });
});
