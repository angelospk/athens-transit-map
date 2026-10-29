import { mount } from "svelte";
import App from "./App.svelte";
import { reloadOnStaleChunk } from "./lib/stale";
import "./app.css";

reloadOnStaleChunk();
mount(App, { target: document.getElementById("app")! });
