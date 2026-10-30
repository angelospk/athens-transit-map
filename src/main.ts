import { mount } from "svelte";
import App from "./App.svelte";
import { reloadOnStaleChunk } from "./lib/stale";
import { installDiag } from "./lib/diag";
import "./app.css";

installDiag();
reloadOnStaleChunk();
mount(App, { target: document.getElementById("app")! });
