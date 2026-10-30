// MapKit JS tokens: an ES256 JWT signed with the Apple Maps key (.p8), bound to the page's origin.
// https://developer.apple.com/documentation/mapkitjs/creating-and-using-tokens-with-mapkit-js
// The key lives only in the MAPKIT_PRIVATE_KEY secret. Nothing here logs it or returns it.

export interface Env {
  TEAM_ID?: string;
  KEY_ID?: string;
  MAPKIT_PRIVATE_KEY?: string;   // the .p8 file's text (PKCS#8 PEM)
  ALLOWED_ORIGINS?: string;      // comma-separated exact origins, e.g. "https://bus.haroldpoi.dev"
}

const TTL_S = 30 * 60;   // MapKit JS asks again through authorizationCallback when a token expires

const enc = new TextEncoder();
const b64url = (b: Uint8Array) => {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const b64urlJson = (o: unknown) => b64url(enc.encode(JSON.stringify(o)));

// Exact match only: no wildcards, no prefixes, never the opaque "null" origin.
export function allowedOrigin(origin: string | null, allowed: string): boolean {
  if (!origin || origin === "null") return false;
  return allowed.split(",").map(s => s.trim()).filter(Boolean).includes(origin);
}

function pkcs8(pem: string): ArrayBuffer {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export async function signMapkitToken(o: { teamId: string; keyId: string; privateKeyPem: string; origin: string; now: number; ttlS: number }) {
  const key = await crypto.subtle.importKey("pkcs8", pkcs8(o.privateKeyPem), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signed = `${b64urlJson({ alg: "ES256", kid: o.keyId, typ: "JWT" })}.${b64urlJson({ iss: o.teamId, iat: o.now, exp: o.now + o.ttlS, origin: o.origin })}`;
  // WebCrypto's ECDSA signature is r||s (IEEE P1363), the form JWS wants.
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(signed));
  return `${signed}.${b64url(new Uint8Array(sig))}`;
}

const text = (body: string | null, status: number, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", Vary: "Origin", ...headers } });

export async function handle(req: Request, env: Env, now = Math.floor(Date.now() / 1000)): Promise<Response> {
  const origin = req.headers.get("Origin");
  if (!allowedOrigin(origin, env.ALLOWED_ORIGINS ?? "")) return text("origin not allowed", 403);
  const cors = { "Access-Control-Allow-Origin": origin!, "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Max-Age": "600" };
  if (req.method === "OPTIONS") return text(null, 204, cors);
  if (req.method !== "GET") return text("method not allowed", 405, { ...cors, Allow: "GET, OPTIONS" });
  if (!env.TEAM_ID || !env.KEY_ID || !env.MAPKIT_PRIVATE_KEY) return text("mapkit token not configured", 503, cors);
  try {
    const jwt = await signMapkitToken({ teamId: env.TEAM_ID, keyId: env.KEY_ID, privateKeyPem: env.MAPKIT_PRIVATE_KEY, origin: origin!, now, ttlS: TTL_S });
    return text(jwt, 200, cors);
  } catch {
    return text("mapkit token signing failed", 500, cors);   // never echo the error: it can quote the key
  }
}
