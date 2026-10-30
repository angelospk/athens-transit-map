// Case-, accent- and final-sigma-insensitive Greek matching.
export const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("el").replace(/ς/g, "σ");
