// «Μέρη» in the search modal (B8, web#18): the geocoder, asked after a pause in typing and only for 3
// letters or more (public Photon asks to be used fairly). Each new text aborts the request before it, and
// a late answer to an older text is dropped. Pure: no Svelte, the geocoder is passed in.

import type { Place } from "./trip";

export const PLACE_MIN = 3;
export const PLACE_DELAY_MS = 300;

// q: the trimmed text the places answer; busy: a request is waiting or in flight for it.
export interface PlaceAnswer { q: string; places: Place[]; busy: boolean }

export function placeSearch(ask: (q: string, signal: AbortSignal) => Promise<Place[]>, onAnswer: (a: PlaceAnswer) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ctl: AbortController | null = null;
  const stop = () => {
    clearTimeout(timer);
    ctl?.abort();
    ctl = null;
  };
  const set = (text: string) => {
    stop();
    const q = text.trim();
    if (q.length < PLACE_MIN) return onAnswer({ q, places: [], busy: false });
    onAnswer({ q, places: [], busy: true });
    timer = setTimeout(() => {
      const c = (ctl = new AbortController());
      ask(q, c.signal).then(
        places => { if (ctl === c) onAnswer({ q, places, busy: false }); },
        () => { if (ctl === c) onAnswer({ q, places: [], busy: false }); },
      );
    }, PLACE_DELAY_MS);
  };
  return { set, stop };
}
