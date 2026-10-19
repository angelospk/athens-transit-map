// Frame-stepped screen capture of the live site (https://bus.haroldpoi.dev).
// The page runs on Playwright's fake clock: each video frame advances it by 1/60 s (× speed) and takes
// one screenshot, so the footage is smooth 60 fps however slow the software renderer is.
// Usage: node --dns-result-order=ipv4first capture/capture.mjs [api|city|follow|vehicle|planner ...]   (no args: all)
// Output: capture/frames/<shot>/NNNNN.jpg (scratch), public/cap/<shot>.mp4, public/cap/<shot>.json
//   (per frame: cursor x/y in capture pixels, click flag, optional tracked box), public/cap/api.json.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://bus.haroldpoi.dev";
const API = "https://transit.haroldpoi.dev";
const VW = 1600, VH = 900, DSF = 1.5, FPS = 60;
const OUT = join(ROOT, "public/cap");
mkdirSync(OUT, { recursive: true });

const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

async function shoot(name, url, script, { mobile = false } = {}) {
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const vp = mobile ? { width: 390, height: 844 } : { width: VW, height: VH };
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: mobile ? 3 : DSF, locale: "el-GR", timezoneId: "Europe/Athens",
    colorScheme: "light", isMobile: mobile, hasTouch: mobile });
  const p = await ctx.newPage();
  await p.clock.install();
  await p.goto(SITE + url, { waitUntil: "networkidle" });
  await p.waitForTimeout(6000);
  await p.clock.pauseAt(Date.now() + 500);

  const dir = join(ROOT, "capture/frames", name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const track = [];
  let f = 0, clock = 0, cx = vp.width * 0.62, cy = vp.height * 0.62, click = false, speed = 1, box = null, tracked = null;

  const frame = async () => {
    // Playwright advances whole milliseconds; step to the rounded running target so 60 frames = 1000 ms.
    const target = clock + (1000 / FPS) * speed, step = Math.round(target) - Math.round(clock);
    clock = target;
    if (step > 0) await p.clock.runFor(step);
    if (tracked) box = await tracked().catch(() => null);
    await p.screenshot({ path: join(dir, String(f).padStart(5, "0") + ".jpg"), type: "jpeg", quality: 92 });
    track.push({ x: +(cx * (mobile ? 3 : DSF)).toFixed(1), y: +(cy * (mobile ? 3 : DSF)).toFixed(1), c: click ? 1 : 0, ...(box ? { b: box } : {}) });
    click = false;
    f++;
  };
  const s = {
    hold: async n => { for (let i = 0; i < n; i++) await frame(); },
    speed: k => { speed = k; },
    move: async (x, y, n = 36) => {
      const x0 = cx, y0 = cy;
      for (let i = 1; i <= n; i++) { const t = ease(i / n); cx = x0 + (x - x0) * t; cy = y0 + (y - y0) * t; await p.mouse.move(cx, cy); await frame(); }
    },
    click: async () => { await p.mouse.down(); await p.mouse.up(); click = true; await frame(); },
    moveTo: async (loc, n = 36, dx = 0.5, dy = 0.5) => { const b = await loc.boundingBox(); await s.move(b.x + b.width * dx, b.y + b.height * dy, n); },
    type: async (text, every = 5) => { for (const ch of text) { await p.keyboard.type(ch); await frame(); await s.hold(every - 1); } },
    key: async k => { await p.keyboard.press(k); await frame(); },
    wheel: async (dy, n, every = 4) => { for (let i = 0; i < n; i++) { await p.mouse.wheel(0, dy); await frame(); await s.hold(every - 1); } },
    // Step frames until the condition holds (max n frames); the edit trims any dead wait.
    until: async (cond, n = 600) => { for (let i = 0; i < n && !(await cond().catch(() => false)); i++) await frame(); },
    track: fn => { tracked = fn; },
    page: p,
    get frame() { return f; },
  };
  let marks;
  try { marks = await script(s) || {}; } finally { await browser.close(); }
  writeFileSync(join(OUT, name + ".json"), JSON.stringify({ name, url, w: vp.width * (mobile ? 3 : DSF), h: vp.height * (mobile ? 3 : DSF), frames: f, marks, track, capturedAt: new Date().toISOString() }));
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-framerate", String(FPS), "-i", join(dir, "%05d.jpg"),
    "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-pix_fmt", "yuv420p", "-g", "30", join(OUT, name + ".mp4")]);
  console.log(name, f, "frames");
}

// The 040 vehicle closest to the given point (CSS px), as a box.
const busNear = (p, line, x, y) => p.evaluate(([line, x, y]) => {
  let best = null, bd = Infinity;
  for (const el of document.querySelectorAll(".bus")) {
    if (el.textContent.trim() !== line) continue;
    const r = el.getBoundingClientRect();
    const d = Math.hypot(r.x + r.width / 2 - x, r.y + r.height / 2 - y);
    if (r.width && d < bd) { bd = d; best = { x: r.x, y: r.y, w: r.width, h: r.height }; }
  }
  return best;
}, [line, x, y]);
const mustBus = async (...a) => { const b = await busNear(...a); if (!b) throw new Error(`no ${a[1]} vehicle on screen`); return b; };

const SHOTS = {
  // The whole city, then a zoom into the centre; vehicles glide at 4× speed.
  city: () => shoot("city", "/", async s => {
    await s.hold(30);
    await s.move(821, 448, 50);
    await s.wheel(-120, 14, 4);
    const zoomed = s.frame;
    await s.hold(40);
    s.speed(4);
    await s.hold(240);
    return { zoomed, fast: zoomed + 40 };
  }),
  // Search a line and add it, three times: each gets its own colour.
  follow: () => shoot("follow", "/", async s => {
    const input = s.page.getByLabel("Αναζήτηση γραμμής").first();
    const m = {};
    await s.hold(20);
    for (const [i, id] of ["040", "Α1", "Χ95"].entries()) {
      await s.moveTo(input, i ? 24 : 40, 0.3);
      await s.click();
      m["type" + i] = s.frame;
      await s.type(id, 7);
      await s.hold(24);
      m["enter" + i] = s.frame;
      await s.key("Enter");
      await s.hold(i === 2 ? 200 : 110);
    }
    return m;
  }),
  // One followed line: zoom in on a vehicle, open its card.
  vehicle: () => shoot("vehicle", "/?l=040", async s => {
    const p = s.page;
    await s.hold(20);
    let b = await mustBus(p, "040", 800, 450);
    await s.move(b.x + b.w / 2, b.y + b.h / 2, 40);
    const zoom = s.frame;
    await s.wheel(-120, 9, 5);
    await s.hold(50);
    let target = await mustBus(p, "040", s.page.viewportSize().width / 2, 450);
    s.track(() => busNear(p, "040", target.x + target.w / 2, target.y + target.h / 2).then(r => (target = r || target, r && { x: r.x * DSF, y: r.y * DSF, w: r.w * DSF, h: r.h * DSF })));
    await s.move(target.x + target.w / 2, target.y + target.h / 2, 40);
    await s.hold(60);
    const click = s.frame;
    await s.click();
    await s.hold(240);
    return { zoom, click };
  }),
  // Planner: from Syntagma to Piraeus, then the stop alert with the bell.
  planner: () => shoot("planner", "/", async s => {
    const p = s.page, m = {};
    await s.hold(20);
    await s.moveTo(p.getByLabel("Διαδρομή: ποιες γραμμές με πάνε"), 45);
    m.open = s.frame;
    await s.click();
    await s.hold(30);
    for (const [k, label, q] of [["from", "Από", "Σύνταγμα"], ["to", "Προς", "Πειραιάς"]]) {
      const field = p.getByLabel(label, { exact: true });
      await s.moveTo(field, 30, 0.4);
      await s.click();
      m[k + "Type"] = s.frame;
      await s.type(q, 5);
      await s.until(() => p.locator(`#trip-${k}-list li`).first().isVisible());
      await s.hold(30);
      await s.moveTo(p.locator(`#trip-${k}-list li`).first(), 24, 0.3);
      m[k + "Pick"] = s.frame;
      await s.click();
      await s.hold(30);
    }
    await s.until(() => p.locator("button.lead").first().isVisible());
    m.results = s.frame;
    await s.hold(150);
    await s.moveTo(p.locator("button.lead").first(), 40, 0.3);
    m.alert = s.frame;
    await s.click();
    await s.hold(40);
    await s.wheel(120, 4, 6);   // scroll the planner so the bell and Telegram buttons are in view
    m.scrolled = s.frame;
    await s.hold(30);
    await s.moveTo(p.locator("button.bell").first(), 40);
    m.bell = s.frame;
    await s.hold(90);
    return m;
  }),
};

async function api() {
  const get = async path => ({ path, body: await (await fetch(API + path)).json() });
  const out = { at: new Date().toISOString(), status: await get("/v1/status"), line: await get("/v1/lines/040") };
  // The film shows the first vehicle of 040; keep the previous answer if the line has none right now.
  if (!out.line.body.vehicles?.length) { console.log("api: 040 has no vehicles now, api.json kept"); return; }
  writeFileSync(join(OUT, "api.json"), JSON.stringify(out));
  console.log("api", out.line.body.vehicles?.length, "vehicles of 040");
}

const want = process.argv.slice(2);
if (!want.length || want.includes("api")) await api();
for (const [k, run] of Object.entries(SHOTS)) if (!want.length || want.includes(k)) await run();
