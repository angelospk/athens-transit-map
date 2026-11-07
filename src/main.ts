import { mount } from "svelte";
import App from "./App.svelte";
import { reloadOnStaleChunk } from "./lib/stale";
import { installDiag } from "./lib/diag";
import "./app.css";

installDiag();
reloadOnStaleChunk();
// A prerendered page (scripts/seo.ts) holds its text in #app for search engines and no-script readers: the map replaces it.
const target = document.getElementById("app")!;
target.replaceChildren();
mount(App, { target });
// The service worker (public/sw.js) keeps the app, the timetables and the map for use without a connection; it
// also carries stop alerts. Not in development: it would serve old code.
if (import.meta.env.PROD && "serviceWorker" in navigator)
  addEventListener("load", () => void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {}));
