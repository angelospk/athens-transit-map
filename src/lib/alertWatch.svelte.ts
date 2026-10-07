// Runs the app's stop alert (alerts.ts) on every new line data; loaded with the first alert. Each hit:
// a card in the panel until dismissed, a system notification when allowed, a vibration.

import { untrack } from "svelte";
import { AlertWatch } from "./alerts";
import type { AppState } from "./state.svelte";

export function watchAlerts(app: AppState) {
  const watch = new AlertWatch();
  return $effect.root(() => {
    $effect(() => {
      const a = app.alert, live = app.live, statics = app.statics;
      if (!a) return;
      for (const h of watch.check(a, live, statics, untrack(app.serverMs) / 1000))
        void notify(untrack(() => app.alertHit(h, statics[h.line]?.stops[h.stop]?.name ?? a.label)));
    });
  });
}

async function notify(text: string) {
  navigator.vibrate?.([200, 100, 200]);
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const opts = { body: text, tag: text, icon: `${import.meta.env.BASE_URL}favicon.svg` };
  try {
    // The worker registered with the alert may still be starting: wait for it a little.
    const reg = await navigator.serviceWorker?.getRegistration();
    const ready = reg && (reg.active ? reg : await Promise.race([navigator.serviceWorker.ready, new Promise<null>(r => setTimeout(r, 5000, null))]));
    if (ready) await ready.showNotification("Λεωφορείο", opts);
    else if (!reg) new Notification("Λεωφορείο", opts);
  } catch { /* the card in the page is still there */ }
}
