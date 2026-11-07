import { describe, expect, it } from "vitest";
import { MotionStops, nearestStationM, rideByClock, rideGo, rideOver, rideStart, rideStop, type RideStop } from "../src/lib/metroRide";

const S = (k: number, at: number): RideStop => ({ stop: `s${k}`, name: `Σταθμός ${k}`, at, lat: 38 + k * 0.01, lon: 23.7 });
const stops = [S(0, 100), S(1, 220), S(2, 340), S(3, 460)];

// A ride sampled at 10 Hz: [seconds, shaking] segments; shaking 0.3 is a train running, 0.01 a platform, 3 a walk.
function feed(segs: [number, number][]) {
  const ev: [string, number][] = [];
  const m = new MotionStops((k, t) => ev.push([k, t]));
  let t = 0, flip = false;
  for (const [dur, amp] of segs) for (const end = t + dur; t < end; t += 0.1) { flip = !flip; m.push(t, 9.8 + (flip ? amp : -amp)); }
  return { ev, m };
}

describe("MotionStops", () => {
  it("sees a stop after a run, and the start after it", () => {
    const { ev, m } = feed([[60, 0.3], [30, 0.01], [60, 0.3]]);
    expect(ev.map(e => e[0])).toEqual(["stop", "go"]);
    expect(ev[0][1]).toBeGreaterThan(55);
    expect(ev[0][1]).toBeLessThan(70);
    expect(m.trainLike).toBe(true);
  });
  it("takes no short shake for a run, and no walk for a train", () => {
    expect(feed([[15, 0.3], [30, 0.01]]).ev).toEqual([]);
    const walk = feed([[60, 3], [30, 0.01]]);
    expect(walk.ev).toEqual([]);
    expect(walk.m.trainLike).toBe(false);
  });
  it("lying still at home is never a train", () => {
    const { ev, m } = feed([[600, 0.01]]);
    expect(ev).toEqual([]);
    expect(m.trainLike).toBe(false);
  });
});

describe("a ride", () => {
  it("matches a stop to the station nearest in time, then moves on", () => {
    let r = rideStart(stops, 50);
    expect([r.i, r.at]).toEqual([0, false]);
    r = rideStop(r, 130);                       // 30 s late at the first station
    expect([r.i, r.at, r.offset, r.matched]).toEqual([0, true, 30, 1]);
    r = rideGo(r);
    expect([r.i, r.at]).toEqual([1, false]);
    r = rideStop(r, 380);                       // a station missed: the next stop is the third
    expect([r.i, r.offset]).toEqual([2, 40]);
  });
  it("a stop between stations (a signal) moves nothing", () => {
    const r = rideStop(rideStart(stops, 50), 900);
    expect([r.i, r.at, r.seen, r.matched]).toEqual([0, false, 1, 0]);
  });
  it("goes by the clock without motion, with the delay seen", () => {
    const r = rideByClock({ ...rideStart(stops, 0), offset: 30 }, 260);
    expect([r.i, r.at]).toEqual([1, true]);
    expect(rideByClock(rideStart(stops, 0), 300).i).toBe(2);
  });
  it("ends at the last station", () => {
    expect(rideOver({ ...rideStart(stops, 0), i: 3, at: true }, 460)).toBe(true);
    expect(rideOver({ ...rideStart(stops, 0), i: 3 }, 400)).toBe(false);
  });
  it("tells how far the rider is from the line", () => {
    const r = rideStart(stops, 0);
    expect(nearestStationM(r, [38.01, 23.7])).toBeLessThan(1);
    expect(nearestStationM(r, [38.01, 23.75])).toBeGreaterThan(4000);
  });
});
