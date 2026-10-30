import { describe, expect, it } from "vitest";
import { allowedOrigin, handle, signMapkitToken } from "../workers/mapkit-token/src/token";

const fromB64url = (s: string) => Buffer.from(s, "base64url");

// A throwaway P-256 key in the .p8 (PKCS#8 PEM) form Apple hands out.
async function testKey() {
  const k = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const der = Buffer.from(await crypto.subtle.exportKey("pkcs8", k.privateKey)).toString("base64");
  const pem = `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----\n`;
  return { pem, publicKey: k.publicKey };
}

function parts(jwt: string) {
  const [h, p, s] = jwt.split(".");
  return { header: JSON.parse(fromB64url(h).toString()), payload: JSON.parse(fromB64url(p).toString()), signed: `${h}.${p}`, sig: fromB64url(s) };
}

const ORIGINS = "https://bus.haroldpoi.dev, https://minipc.tail11f3d4.ts.net:10443";

describe("allowedOrigin", () => {
  it("accepts only exact listed origins", () => {
    expect(allowedOrigin("https://bus.haroldpoi.dev", ORIGINS)).toBe(true);
    expect(allowedOrigin("https://minipc.tail11f3d4.ts.net:10443", ORIGINS)).toBe(true);
    expect(allowedOrigin("https://evil.haroldpoi.dev", ORIGINS)).toBe(false);
    expect(allowedOrigin("https://bus.haroldpoi.dev.evil.com", ORIGINS)).toBe(false);
    expect(allowedOrigin("http://bus.haroldpoi.dev", ORIGINS)).toBe(false);
    expect(allowedOrigin("https://bus.haroldpoi.dev/", ORIGINS)).toBe(false);
    expect(allowedOrigin(null, ORIGINS)).toBe(false);
    expect(allowedOrigin("", ORIGINS)).toBe(false);
    expect(allowedOrigin("null", "null")).toBe(false);   // sandboxed/file pages send "null": never trusted
  });
});

describe("signMapkitToken", () => {
  it("makes an ES256 JWT that verifies, with Apple's header and claims", async () => {
    const { pem, publicKey } = await testKey();
    const jwt = await signMapkitToken({ teamId: "TEAM123456", keyId: "KEY1234567", privateKeyPem: pem,
      origin: "https://bus.haroldpoi.dev", now: 1_800_000_000, ttlS: 1800 });
    const { header, payload, signed, sig } = parts(jwt);
    expect(header).toEqual({ alg: "ES256", kid: "KEY1234567", typ: "JWT" });
    expect(payload).toEqual({ iss: "TEAM123456", iat: 1_800_000_000, exp: 1_800_001_800, origin: "https://bus.haroldpoi.dev" });
    expect(sig.length).toBe(64);   // JWS ES256: raw r||s, not DER
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, sig, new TextEncoder().encode(signed));
    expect(ok).toBe(true);
    expect(jwt).not.toMatch(/[+/=]/);   // base64url, no padding
  });

  it("accepts a PEM with CRLF line ends and surrounding space", async () => {
    const { pem } = await testKey();
    const jwt = await signMapkitToken({ teamId: "T", keyId: "K", privateKeyPem: `  ${pem.replace(/\n/g, "\r\n")}  `,
      origin: "https://bus.haroldpoi.dev", now: 1, ttlS: 60 });
    expect(jwt.split(".")).toHaveLength(3);
  });
});

describe("handle", () => {
  const env = async () => ({ TEAM_ID: "TEAM123456", KEY_ID: "KEY1234567", MAPKIT_PRIVATE_KEY: (await testKey()).pem, ALLOWED_ORIGINS: ORIGINS });
  const req = (origin: string | null, method = "GET") =>
    new Request("https://token.example/", { method, headers: origin ? { Origin: origin } : {} });

  it("gives an allowed origin a short-lived token bound to it, with CORS for that origin only", async () => {
    const r = await handle(req("https://bus.haroldpoi.dev"), await env(), 1_800_000_000);
    expect(r.status).toBe(200);
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe("https://bus.haroldpoi.dev");
    expect(r.headers.get("Vary")).toContain("Origin");
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    const { payload } = parts(await r.text());
    expect(payload.origin).toBe("https://bus.haroldpoi.dev");
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(3600);
  });

  it("refuses an unknown or missing origin without a token or CORS header", async () => {
    for (const o of ["https://evil.example", null]) {
      const r = await handle(req(o), await env(), 1_800_000_000);
      expect(r.status).toBe(403);
      expect(r.headers.get("Access-Control-Allow-Origin")).toBeNull();
      expect(await r.text()).not.toMatch(/^ey/);
    }
  });

  it("answers a preflight from an allowed origin", async () => {
    const r = await handle(req("https://bus.haroldpoi.dev", "OPTIONS"), await env(), 0);
    expect(r.status).toBe(204);
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe("https://bus.haroldpoi.dev");
    expect(r.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  });

  it("refuses other methods", async () => {
    const r = await handle(req("https://bus.haroldpoi.dev", "POST"), await env(), 0);
    expect(r.status).toBe(405);
  });

  it("says 503 when the secrets are not set, and leaks nothing", async () => {
    const r = await handle(req("https://bus.haroldpoi.dev"), { ALLOWED_ORIGINS: ORIGINS }, 0);
    expect(r.status).toBe(503);
    expect(await r.text()).toBe("mapkit token not configured");
  });

  it("says 500 without the key text when the key is broken", async () => {
    const r = await handle(req("https://bus.haroldpoi.dev"),
      { TEAM_ID: "T", KEY_ID: "K", MAPKIT_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----", ALLOWED_ORIGINS: ORIGINS }, 0);
    expect(r.status).toBe(500);
    expect(await r.text()).toBe("mapkit token signing failed");
  });
});
