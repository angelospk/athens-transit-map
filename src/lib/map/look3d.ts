// How the 3D city looks (scene3d.ts): «Ρεαλιστική», the street as it is, or «Μινιατούρα», a toy town in warm
// daylight. Its own module, so the app's state keeps the choice without loading the 3D code.
export type Look3D = "real" | "toon";
export const isLook3D = (v: unknown): v is Look3D => v === "real" || v === "toon";
export const LOOKS: [Look3D, string][] = [["real", "Ρεαλιστική"], ["toon", "Μινιατούρα"]];
