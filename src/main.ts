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
