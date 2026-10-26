// Smoke test the built app and its Worker/DO path: bun scripts/check-cloudflare.ts <base URL>
const base = (process.argv[2] ?? "http://localhost:8791").replace(/\/$/, "");
const html = await fetch(`${base}/`);
if (html.status !== 200 || !(await html.text()).includes("<html")) throw new Error("Static app failed");

const boards = await Promise.all([fetch(`${base}/oasa/stops/340109`), fetch(`${base}/oasa/stops/340109`)]);
for (const response of boards) {
  const b = await response.json();
  if (response.status !== 200 || !Array.isArray(b.arrivals) || !b.routes?.some((r: { code: string; line: string }) => r.code === "5205" && r.line === "130"))
    throw new Error(`OASA board failed: ${JSON.stringify(b)}`);
  console.log(`OASA: ${response.status}, ${b.arrivals.length} arrivals; route 5205 maps to 130`);
}

for (const [path, method, expected] of [
  ["/oasa/stops/foo", "GET", 404],
  ["/oasa/stops/340109?extra=1", "GET", 404],
  ["/oasa/stops/340109", "POST", 405],
] as const) {
  const r = await fetch(base + path, { method });
  if (r.status !== expected) throw new Error(`${method} ${path}: ${r.status}, expected ${expected}`);
}
console.log(`Passed: static app, concurrent boards, route mapping, invalid paths, methods (${base})`);
