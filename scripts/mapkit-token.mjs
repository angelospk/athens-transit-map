// A MapKit JS token for Apple's base map in 2D (src/lib/map/appleBase.ts), signed with your Apple Developer key.
// Nothing leaves your computer: the key stays where it is, the token is printed.
//
// 1. developer.apple.com → Certificates, Identifiers & Profiles → Identifiers: a «Maps ID» (maps.your.domain).
// 2. Keys: a new key with «MapKit JS» enabled, for that Maps ID. Download its .p8 file (only once) and note its Key ID.
// 3. node scripts/mapkit-token.mjs --team TEAMID --key KEYID --p8 ./AuthKey_KEYID.p8 --origin https://your.site --days 365
//    (--origin: the site the token works on; leave it out for a token that works anywhere, e.g. localhost.)
// 4. Put the printed token in .env.local as VITE_MAPKIT_TOKEN=… (and as the repository secret VITE_MAPKIT_TOKEN for
//    the deploy), then build.
//
// The token ends after --days; make a new one before then. Apple counts 250,000 map views a day free.

import { readFileSync } from "node:fs";
import { createPrivateKey, sign } from "node:crypto";

const arg = name => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const team = arg("team"), kid = arg("key"), p8 = arg("p8"), origin = arg("origin"), days = Number(arg("days") ?? 365);
if (!team || !kid || !p8) {
  console.error("Χρήση: node scripts/mapkit-token.mjs --team TEAMID --key KEYID --p8 ./AuthKey.p8 [--origin https://site] [--days 365]");
  process.exit(1);
}

const b64 = v => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const head = b64({ alg: "ES256", kid, typ: "JWT" });
const body = b64({ iss: team, iat: now, exp: now + days * 86400, ...(origin ? { origin } : {}) });
const key = createPrivateKey(readFileSync(p8, "utf8"));
const sig = sign("sha256", Buffer.from(`${head}.${body}`), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
console.log(`${head}.${body}.${sig}`);
