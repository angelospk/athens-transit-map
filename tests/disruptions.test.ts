import { describe, expect, it } from "vitest";
import {
  athensDay, dateRange, forLine, forStop, isActive, parseAlerts, shortTitle, strikes, type Disruption,
} from "../src/lib/disruptions";

// Tue 2026-11-03 12:00 Athens (UTC+2 in November).
const NOW = Date.UTC(2026, 10, 3, 10, 0);
const DAY = 86_400;

const alert = (id: string, extra: Partial<Disruption> = {}): Disruption => ({
  id, source: "oasa", title: "Μερική προσωρινή τροποποίηση της λεωφορειακής γραμμής 112", url: "https://www.oasa.gr/blog/x/",
  published: NOW / 1000 - DAY, from: null, until: null, modes: ["bus"], lines: [], stops: [], urgent: false, ...extra,
});

describe("athensDay", () => {
  it("is the calendar day in Athens, not in UTC", () => {
    expect(athensDay(NOW)).toBe("2026-11-03");
    expect(athensDay(Date.UTC(2026, 10, 3, 22, 30))).toBe("2026-11-04");   // 00:30 in Athens
  });
});

describe("isActive", () => {
  it("shows a dated alert from its first to its last day, both included", () => {
    expect(isActive(alert("a", { from: "2026-11-03", until: "2026-11-03" }), NOW)).toBe(true);
    expect(isActive(alert("a", { from: "2026-11-01", until: "2026-11-05" }), NOW)).toBe(true);
    expect(isActive(alert("a", { from: "2026-11-04", until: "2026-11-04" }), NOW)).toBe(false);   // tomorrow
    expect(isActive(alert("a", { from: "2026-11-01", until: "2026-11-02" }), NOW)).toBe(false);   // over
  });
  it("checks one date alone as an open range: from that day, or up to that day", () => {
    expect(isActive(alert("a", { from: "2026-11-02" }), NOW)).toBe(true);
    expect(isActive(alert("a", { from: "2026-11-04" }), NOW)).toBe(false);
    expect(isActive(alert("a", { until: "2026-11-05" }), NOW)).toBe(true);
    expect(isActive(alert("a", { until: "2026-11-02" }), NOW)).toBe(false);
  });
  it("shows an alert with no dates for 3 days after it was published", () => {
    expect(isActive(alert("a", { published: NOW / 1000 - 2 * DAY }), NOW)).toBe(true);
    expect(isActive(alert("a", { published: NOW / 1000 - 3 * DAY - 1 }), NOW)).toBe(false);
  });
});

describe("forLine / forStop", () => {
  const list = [
    alert("1", { lines: ["oasa:724", "oasa:727"] }),
    alert("2", { lines: ["oasa:724"], from: "2026-11-10", until: "2026-11-10" }),   // later
    alert("3", { stops: ["oasa:400012"] }),
    alert("4", { lines: [], stops: [], modes: ["bus", "trolley"] }),                 // network-wide: no line, no stop
  ];
  it("gives the active alerts that name the line", () => {
    expect(forLine(list, "oasa:724", NOW).map(a => a.id)).toEqual(["1"]);
    expect(forLine(list, "oasa:040", NOW)).toEqual([]);
  });
  it("gives a stop the alerts that name it or one of its lines, each once", () => {
    expect(forStop(list, "oasa:400012", ["oasa:040"], NOW).map(a => a.id)).toEqual(["3"]);
    expect(forStop(list, "oasa:1", ["oasa:727", "oasa:724"], NOW).map(a => a.id)).toEqual(["1"]);
    expect(forStop(list, "oasa:400012", ["oasa:724"], NOW).map(a => a.id)).toEqual(["1", "3"]);
    expect(forStop(list, "oasa:9", ["oasa:040"], NOW)).toEqual([]);
  });
});

describe("strikes", () => {
  const list = [
    alert("s1", { source: "athenstransport", urgent: true, title: "Hellenic Train: Απεργία την Παρασκευή" }),
    alert("s2", { source: "athenstransport", urgent: true, published: NOW / 1000 - 5 * DAY }),   // over
    alert("o1", { lines: ["oasa:112"] }),                                                         // not urgent
  ];
  it("gives the urgent alerts of today that were not closed", () => {
    expect(strikes(list, NOW, []).map(a => a.id)).toEqual(["s1"]);
    expect(strikes(list, NOW, ["s1"])).toEqual([]);
  });
});

describe("dateRange", () => {
  it("writes day/month, one day once, a range with an en dash", () => {
    expect(dateRange(alert("a", { from: "2026-10-31", until: "2026-11-01" }))).toBe("31/10–1/11");
    expect(dateRange(alert("a", { from: "2026-11-04", until: "2026-11-04" }))).toBe("4/11");
    expect(dateRange(alert("a", { from: "2026-11-04" }))).toBe("4/11");
    expect(dateRange(alert("a"))).toBe("");
  });
});

describe("shortTitle", () => {
  it("names a route change, a strike or a work stoppage in one word", () => {
    expect(shortTitle(alert("a"))).toBe("Εκτροπή");
    expect(shortTitle(alert("a", { title: "Παράταση προσωρινής τροποποίησης της διαδρομής της γραμμής 109" }))).toBe("Εκτροπή");
    expect(shortTitle(alert("a", { title: "Hellenic Train: ΑΠΕΡΓΙΑ στο σιδηρόδρομο" }))).toBe("Απεργία");
    expect(shortTitle(alert("a", { title: "Στάση εργασίας στα λεωφορεία" }))).toBe("Στάση εργασίας");
  });
  it("keeps any other title as it is", () => {
    expect(shortTitle(alert("a", { title: "Νέα γραμμή 899" }))).toBe("Νέα γραμμή 899");
  });
});

describe("parseAlerts", () => {
  it("keeps the well-formed alerts with an http(s) link and drops the rest", () => {
    const good = alert("ok");
    const body = { alerts: [good, { ...good, id: "bad-url", url: "javascript:alert(1)" }, { id: 3 }, null], updated_at: 1 };
    expect(parseAlerts(body).map(a => a.id)).toEqual(["ok"]);
    expect(parseAlerts({ alerts: "x" })).toEqual([]);
    expect(parseAlerts(null)).toEqual([]);
  });
});
