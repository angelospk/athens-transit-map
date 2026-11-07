// The map's own icons, drawn at four times their size (crisp on any screen, and close in, in 3D, where they are seen
// large): the metro's and the tram's glyphs (white, on a disc in the line's colour), and the bus stop's sign (OASA
// blue, a white bus). Drawn on a canvas, so nothing to download.

const S = 128;   // the canvas (px); added with pixelRatio 4: 32 px on the map

function canvas(w = S, h = S) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return [c, c.getContext("2d")!] as const;
}
const data = (c: HTMLCanvasElement) => c.getContext("2d")!.getImageData(0, 0, c.width, c.height);

/** A train seen from the front: its body with a rounded roof, the windscreen, two lamps, the coupler; white. */
export function metroGlyph(): ImageData {
  const [c, g] = canvas();
  g.fillStyle = "#fff"; g.strokeStyle = "#fff"; g.lineJoin = "round"; g.lineCap = "round";
  g.beginPath(); g.roundRect(38, 30, 52, 58, [18, 18, 8, 8]); g.fill();
  g.globalCompositeOperation = "destination-out";            // the windscreen and lamps cut out: the disc shows
  g.beginPath(); g.roundRect(45, 40, 38, 22, 6); g.fill();
  g.beginPath(); g.arc(50, 75, 5, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(78, 75, 5, 0, Math.PI * 2); g.fill();
  g.globalCompositeOperation = "source-over";
  g.lineWidth = 6;
  g.beginPath(); g.moveTo(48, 90); g.lineTo(40, 100); g.moveTo(80, 90); g.lineTo(88, 100); g.stroke();   // the rails it stands on
  return data(c);
}

/** A tram: a lower, longer front with a pantograph on its roof; white. */
export function tramGlyph(): ImageData {
  const [c, g] = canvas();
  g.fillStyle = "#fff"; g.strokeStyle = "#fff"; g.lineJoin = "round"; g.lineCap = "round"; g.lineWidth = 5;
  g.beginPath(); g.moveTo(52, 34); g.lineTo(76, 22); g.moveTo(64, 34); g.lineTo(64, 28); g.stroke();   // the pantograph
  g.beginPath(); g.roundRect(36, 36, 56, 52, [12, 12, 8, 8]); g.fill();
  g.globalCompositeOperation = "destination-out";
  g.beginPath(); g.roundRect(43, 44, 42, 20, 5); g.fill();
  g.beginPath(); g.arc(49, 76, 4.5, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(79, 76, 4.5, 0, Math.PI * 2); g.fill();
  g.globalCompositeOperation = "source-over";
  g.lineWidth = 6;
  g.beginPath(); g.moveTo(48, 90); g.lineTo(40, 100); g.moveTo(80, 90); g.lineTo(88, 100); g.stroke();
  return data(c);
}

/** The bus stop's sign, as OASA's: a blue square with rounded corners, a white edge, a white bus; a soft shadow under
 *  it so it stands off the map. */
// A bus stop: OASA's «α» on a white tile (a shadow under it, so it reads on the dark map and the light one). The
// logo (public/icons/oasa.png) loads once; until it has, a plain blue dot on the tile stands in, and MapView swaps
// the image when it comes (oasaLogo).
let logo: HTMLImageElement | null = null;
let logoP: Promise<HTMLImageElement | null> | null = null;
export function oasaLogo(base = import.meta.env?.BASE_URL ?? "/"): Promise<HTMLImageElement | null> {
  return (logoP ??= new Promise(ok => {
    if (typeof Image === "undefined") { ok(null); return; }
    const img = new Image();
    img.onload = () => { logo = img; ok(img); };
    img.onerror = () => ok(null);
    img.src = `${base}icons/oasa.png`;
  }));
}
export function stopSign(): ImageData {
  const [c, g] = canvas();
  g.shadowColor = "rgba(0,0,0,.35)"; g.shadowBlur = 10; g.shadowOffsetY = 4;
  g.fillStyle = "#ffffff";
  g.beginPath(); g.roundRect(20, 16, 88, 88, 24); g.fill();
  g.shadowColor = "transparent";
  if (logo) g.drawImage(logo, 33, 29, 62, 62);
  else { g.fillStyle = "#00498f"; g.beginPath(); g.arc(64, 60, 22, 0, Math.PI * 2); g.fill(); }
  return data(c);
}
