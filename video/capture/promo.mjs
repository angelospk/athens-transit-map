// Phone captures for the two promo films (promo/), same method as capture.mjs: Playwright's fake clock, one
// screenshot per 1/60 s of page time. Extra here: a phone viewport (390x844 CSS at 3x), CSS animations stepped with
// the fake clock (the refresh ring), geolocation, and an optional replay of a recorded weekday peak
// (capture/replay.mjs) for the city layer.
// Usage: node --dns-result-order=ipv4first capture/promo.mjs [city|speed|fav|plan|stats ...]   (no args: all)
// Output: capture/frames/p-<shot>/ (scratch), public/cap/p-<shot>.mp4 + .json (cursor/touch track, marks).
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadReplay } from "./replay.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://bus.haroldpoi.dev";
const VW = 390, VH = 844, DSF = 3, FPS = 60;
const OUT = join(ROOT, "public/cap");
// Tue 2026-10-20 09:05 Athens: ~1,020 vehicles in the backend's 5 min window (capture/replay_extract.py).
const PEAK = 1792476300;
const HOME = { latitude: 37.9928, longitude: 23.7635 };   // near Panormou, Ampelokipoi
mkdirSync(OUT, { recursive: true });

const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

async function shoot(name, url, script, { replay = false } = {}) {
  const rp = replay ? loadReplay(join(ROOT, "capture/replay")) : null;
  const browser = await chromium.launch({ args: ["--lang=el-GR", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DSF, locale: "el-GR", timezoneId: "Europe/Athens",
    colorScheme: "light", isMobile: true, hasTouch: true, geolocation: HOME, permissions: ["geolocation"], serviceWorkers: "block" });
  const p = await ctx.newPage();
  p.setDefaultTimeout(120_000);
  // Page time (ms): runs in real time until the clock is paused, then only by the frame steps.
  const t0 = replay ? PEAK * 1000 - 20_000 : Date.now(), real0 = Date.now();
  let paused = null, clock = 0;
  const pageNow = () => (paused == null ? t0 + (Date.now() - real0) : paused + clock);
  if (rp) {
    await p.route(/transit\.haroldpoi\.dev\/v1\/(vehicles|status)/, async route => {
      const now = pageNow() / 1000, u = route.request().url();
      const body = u.endsWith("/v1/status")
        ? { ok: true, gtfs_version: "2026-07-08", gtfs_expires: "2026-10-06", updated_at: Math.floor(now), lines_active: 245, budget_rps: 5 }
        : rp.answer(u, now);
      if (!body) return route.continue();
      await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*", "cache-control": "no-store" }, body: JSON.stringify(body) });
    });
  }
  await p.clock.install({ time: t0 });
  await p.goto(SITE + url, { waitUntil: "networkidle" });
  await p.waitForTimeout(6000);
  paused = Math.round(pageNow()) + 500;
  await p.clock.pauseAt(paused);

  const dir = join(ROOT, "capture/frames", "p-" + name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const track = [];
  let f = 0, cx = VW * 0.62, cy = VH * 0.62, click = false, down = 0, speed = 1, shown = false;

  const frame = async () => {
    const target = clock + (1000 / FPS) * speed, step = Math.round(target) - Math.round(clock);
    clock = target;
    if (step > 0) {
      await p.clock.runFor(step);
      // CSS animations and transitions run on the compositor's real clock; step them with the page clock.
      await p.evaluate(ms => {
        for (const a of document.getAnimations()) {
          if (a.playState === "running") a.pause();
          if (a.playState === "paused") a.currentTime = (a.currentTime ?? 0) + ms;
        }
      }, step);
    }
    await p.screenshot({ path: join(dir, String(f).padStart(5, "0") + ".jpg"), type: "jpeg", quality: 92, timeout: 180_000 });
    track.push({ x: +(cx * DSF).toFixed(1), y: +(cy * DSF).toFixed(1), c: click ? 1 : 0, d: down ? 1 : 0, s: shown ? 1 : 0 });
    click = false;
    if (down) down--;
    f++;
  };
  const s = {
    hold: async n => { for (let i = 0; i < n; i++) await frame(); },
    speed: k => { speed = k; },
    // The finger: moves (shown) to a point, taps there.
    move: async (x, y, n = 30) => {
      shown = true;
      const x0 = cx, y0 = cy;
      for (let i = 1; i <= n; i++) { const t = ease(i / n); cx = x0 + (x - x0) * t; cy = y0 + (y - y0) * t; await frame(); }
    },
    tap: async () => { await p.touchscreen.tap(cx, cy); click = true; down = 8; await frame(); },
    lift: () => { shown = false; },
    // Finger to the element (re-aimed at its box after the move: the list may scroll), then a real click on it.
    press: async (loc, n = 30) => {
      await s.moveTo(loc, n);
      const b = await loc.boundingBox();
      await s.move(b.x + b.width / 2, b.y + b.height / 2, 4);
      await loc.click({ force: true }); click = true; down = 8; await frame();
    },
    closeMenu: async () => {
      await p.keyboard.press("Escape"); await frame();
      await s.until(() => p.locator("#pop-layers").isHidden(), 30);
      if (await p.locator("#pop-layers").isVisible()) { await layers(p).click({ force: true }); await frame(); }
    },
    moveTo: async (loc, n = 30, dx = 0.5, dy = 0.5) => { const b = await loc.boundingBox(); await s.move(b.x + b.width * dx, b.y + b.height * dy, n); },
    type: async (text, every = 5) => { for (const ch of text) { await p.keyboard.type(ch); await frame(); await s.hold(every - 1); } },
    key: async k => { await p.keyboard.press(k); await frame(); },
    wheel: async (dy, n, every = 4) => { for (let i = 0; i < n; i++) { await p.mouse.move(cx, cy); await p.mouse.wheel(0, dy); await frame(); await s.hold(every - 1); } },
    until: async (cond, n = 600) => { for (let i = 0; i < n && !(await cond().catch(() => false)); i++) await frame(); },
    page: p,
    get frame() { return f; },
    now: () => pageNow(),
  };
  let marks;
  try { marks = await script(s) || {}; } finally { await browser.close(); }
  if (rp) marks.vehiclesAtStart = rp.count(t0 / 1000 + 20);
  writeFileSync(join(OUT, "p-" + name + ".json"), JSON.stringify({ name, url, w: VW * DSF, h: VH * DSF, frames: f, marks, track,
    capturedAt: new Date().toISOString(), pageTime: new Date(t0).toISOString(), replay }));
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-framerate", String(FPS), "-i", join(dir, "%05d.jpg"),
    "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-pix_fmt", "yuv420p", "-g", "30", join(OUT, "p-" + name + ".mp4")]);
  console.log(name, f, "frames");
}

const layers = p => p.getByLabel("Τι δείχνει ο χάρτης").first();
const sw = (p, text) => p.locator("label.switch", { hasText: text }).first();

const SHOTS = {
  // The peak city (replayed): the refresh ring fills at 6× and every fill moves the vehicles; zoom into the centre;
  // the filter "Μόνο με πρόσφατη θέση" hides the vehicles whose fix is old.
  city: () => shoot("city", "/", async s => {
    const p = s.page, m = {};
    await s.hold(20);
    s.speed(6);
    m.fast = s.frame;
    await s.hold(330);
    s.speed(1);
    m.slow = s.frame;
    await s.move(200, 470, 30);
    m.zoom = s.frame;
    await s.wheel(-120, 9, 5);
    s.lift();
    await s.hold(50);
    m.menu = s.frame;
    await s.press(layers(p));
    await s.hold(30);
    m.fresh = s.frame;
    await s.press(sw(p, "Μόνο με πρόσφατη θέση").locator("input"));
    await s.hold(40);
    s.lift();
    m.close = s.frame;
    await s.closeMenu();
    await s.hold(150);
    return m;
  }, { replay: true }),
  // Typical speed per road, then a metro line (replayed peak underneath).
  speed: () => shoot("speed", "/", async s => {
    const p = s.page, m = {};
    await s.hold(20);
    m.menu = s.frame;
    await s.press(layers(p));
    await s.hold(20);
    const speedSw = sw(p, "Τυπική ταχύτητα ανά δρόμο");
    await speedSw.scrollIntoViewIfNeeded();
    await s.hold(20);
    m.speed = s.frame;
    await s.press(speedSw.locator("input"));
    await s.hold(40);
    s.lift();
    await s.closeMenu();
    m.closed = s.frame;
    await s.hold(30);
    await s.move(205, 440, 24);
    await s.wheel(-120, 8, 6);
    s.lift();
    m.zoomed = s.frame;
    await s.hold(140);
    await s.press(layers(p));
    await s.hold(10);
    const metro = p.locator(".metro label.switch").nth(2);
    await metro.scrollIntoViewIfNeeded();
    await s.hold(20);
    m.metro = s.frame;
    await s.press(metro.locator("input"));
    await s.hold(30);
    s.lift();
    await s.closeMenu();
    m.metroShown = s.frame;
    await s.hold(150);
    return m;
  }, { replay: true }),
  // Favourites: star two lines, then a new visit to the bare address shows them under the search.
  fav: () => shoot("fav", "/", async s => {
    const p = s.page, m = {};
    const search = () => p.locator("button.find, input[aria-label='Αναζήτηση γραμμής']").first();
    await s.hold(20);
    for (const [i, id] of ["040", "A1"].entries()) {
      await s.press(search());
      await s.hold(12);
      await p.keyboard.press("Control+A");
      m["type" + i] = s.frame;
      await s.type(id, 6);
      await s.hold(24);
      const star = p.locator("#line-list li .star").first();
      m["star" + i] = s.frame;
      await s.press(star, 26);
      await s.until(() => star.getAttribute("aria-pressed").then(v => v === "true"), 30);
      await s.hold(30);
      await s.key("Escape");
      await s.hold(20);
    }
    s.lift();
    // A new visit to the bare address: the starred lines wait under the search.
    await p.goto(SITE + "/", { waitUntil: "load" });
    m.revisit = s.frame;
    await s.until(() => search().isVisible(), 600);
    await s.hold(60);
    const fold = p.getByLabel("Εμφάνιση λεπτομερειών");
    await s.press(fold);
    await s.until(() => p.locator(".quick .fav").first().isVisible(), 120);
    m.quick = s.frame;
    await s.hold(50);
    m.all = s.frame;
    await s.press(p.locator(".quick .all"));
    s.lift();
    await s.hold(200);
    return m;
  }),
  // Planner: my location → Syntagma, the lines, then a weekday 07:30 alert on Telegram.
  plan: () => shoot("plan", "/", async s => {
    const p = s.page, m = {};
    await s.hold(20);
    await s.moveTo(p.getByLabel("Διαδρομή: ποιες γραμμές με πάνε"), 30);
    m.open = s.frame;
    await s.tap();
    await s.until(() => p.getByLabel("Από", { exact: true }).isVisible(), 240);
    await s.hold(20);
    await s.moveTo(p.getByLabel("Από", { exact: true }), 26, 0.4);
    await s.tap();
    await s.hold(20);
    await s.moveTo(p.locator("#trip-from-list li").first(), 24, 0.3);
    m.me = s.frame;
    await s.tap();
    await s.hold(40);
    await s.moveTo(p.getByLabel("Προς", { exact: true }), 26, 0.4);
    await s.tap();
    m.toType = s.frame;
    await s.type("Σύνταγμα", 4);
    await s.until(() => p.locator("#trip-to-list li").first().isVisible());
    await s.hold(24);
    await s.moveTo(p.locator("#trip-to-list li").first(), 24, 0.3);
    m.toPick = s.frame;
    await s.tap();
    s.lift();
    await s.until(() => p.locator("button.summary").isVisible(), 300);
    m.results = s.frame;
    await s.hold(110);
    await s.moveTo(p.locator("button.summary"), 30);
    await s.tap();
    await s.until(() => p.locator("button.lead").isVisible(), 120);
    m.unfold = s.frame;
    await s.hold(70);
    await s.moveTo(p.locator("button.lead"), 30, 0.3);
    m.lead = s.frame;
    await s.tap();
    await s.hold(30);
    const rep = p.locator("#trip-alert label", { hasText: "Επανάληψη" }).locator("select");
    await s.moveTo(rep, 26);
    await s.tap().catch(() => {});
    await rep.selectOption("31");
    m.rep = s.frame;
    await s.hold(30);
    const time = p.locator("#trip-alert input[type=time]");
    await s.moveTo(time, 24, 0.3);
    await time.fill("07:30");
    await time.evaluate(el => el.blur());
    m.time = s.frame;
    await s.hold(30);
    await p.locator("a.tg").evaluate(el => el.scrollIntoView({ block: "center", behavior: "instant" }));
    await s.hold(10);
    await s.moveTo(p.locator("a.tg"), 30);
    m.tg = s.frame;
    await s.hold(120);
    return m;
  }),
  // The ⓘ dialog: network statistics of the newest day. Real-time stills (a modal <dialog> stalls screenshots on
  // the paused fake clock); the film moves a camera over them.
  stats: async () => {
    const browser = await chromium.launch({ args: ["--lang=el-GR", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
    try {
      const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DSF, locale: "el-GR", timezoneId: "Europe/Athens",
        colorScheme: "light", isMobile: true, hasTouch: true, serviceWorkers: "block" });
      const p = await ctx.newPage();
      await p.goto(SITE + "/", { waitUntil: "networkidle" });
      await p.waitForTimeout(4000);
      await p.locator(".maplibregl-ctrl-attrib-button").first().click({ force: true });
      await p.waitForTimeout(1500);
      await p.getByRole("tab", { name: "Στατιστικά δικτύου" }).click();
      await p.getByText(/Περισσότερα στις/).first().waitFor();
      await p.waitForTimeout(2500);
      await p.screenshot({ path: join(OUT, "p-stats.png"), timeout: 600_000 });
      console.log("stats still", await p.getByText(/λεωφορεία και τρόλεϊ σε/).first().textContent());
    } finally { await browser.close(); }
  },
};

const want = process.argv.slice(2);
for (const [k, run] of Object.entries(SHOTS)) if (!want.length || want.includes(k)) await run();
