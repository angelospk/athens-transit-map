// The bus ids of this page load: its city's namespace (/v2 id prefix). Athens and Thessaloniki send "oasa:",
// a citybus.gr city its backend code ("pat:"). A city switch reloads the page, so one namespace per load.
import { CITIES } from "./cities";
import { PAGE_CITY } from "./config";

export const BUS_NS = CITIES[PAGE_CITY].ns;
export const busId = (native: string) => `${BUS_NS}:${native}`;
export const isBusId = (id: string) => id.startsWith(BUS_NS + ":");
