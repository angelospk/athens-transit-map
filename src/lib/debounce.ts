// Calls fn once, `ms` after the last call, with the last arguments.
export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const d = (...a: A) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...a), ms);
  };
  d.cancel = () => clearTimeout(timer);
  return d;
}

// Calls fn at most once per `ms`, `ms` after the first call of a window, with the last arguments.
// Unlike debounce it still fires when calls never pause.
export function throttle<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last: A;
  const t = (...a: A) => {
    last = a;
    timer ??= setTimeout(() => { timer = undefined; fn(...last); }, ms);
  };
  t.cancel = () => { clearTimeout(timer); timer = undefined; };
  return t;
}
