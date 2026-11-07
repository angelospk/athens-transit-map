// The app's transitions: short, eased, and none at all for people who ask their system for less motion (Svelte's
// transitions run as Web Animations, which the CSS media query does not reach).
import { fade, fly, scale, slide, type FadeParams, type FlyParams, type ScaleParams, type SlideParams } from "svelte/transition";
import { cubicOut, backOut } from "svelte/easing";

export const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const calm = <P extends { duration?: number }>(p: P): P => (reduced() ? { ...p, duration: 0, delay: 0 } : p);

// Up from below, as a sheet or a card comes in.
export const rise = (node: Element, p: FlyParams = {}) => fly(node, calm({ y: 24, duration: 280, easing: cubicOut, opacity: 0, ...p }));
// A list item, a little after the one before it (i: its place).
export const item = (node: Element, p: FlyParams & { i?: number } = {}) =>
  fly(node, calm({ y: 8, duration: 220, delay: Math.min(p.i ?? 0, 8) * 35, easing: cubicOut, ...p }));
export const pop = (node: Element, p: ScaleParams = {}) => scale(node, calm({ start: 0.92, duration: 220, easing: backOut, ...p }));
export const soft = (node: Element, p: FadeParams = {}) => fade(node, calm({ duration: 180, ...p }));
export const open = (node: Element, p: SlideParams = {}) => slide(node, calm({ duration: 220, easing: cubicOut, ...p }));
