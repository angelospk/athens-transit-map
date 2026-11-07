// The panel's warnings about the data: no connection to the server, a server problem, stale lines.
import type { Status } from "./types";

export function bannerMessages(statusFailed: boolean, status: Status | null, stale: string[], noNet = false) {
  const out: string[] = [];
  // No network at all: what the app kept still works, the timetables; no live positions until it is back.
  if (noNet) return { offline: true, messages: ["Χωρίς σύνδεση · δείχνω το πρόγραμμα. Οι ζωντανές θέσεις έρχονται μόλις συνδεθείς."] };
  // The last /v1/status call failed (also after earlier successes): the cached status is old news.
  if (statusFailed) out.push("Δεν υπάρχει σύνδεση με τον διακομιστή δεδομένων. Νέα προσπάθεια σε λίγο.");
  else if (status && !status.ok) out.push("Ο διακομιστής δεδομένων έχει προσωρινό πρόβλημα. Τα στοιχεία μπορεί να μην είναι ενημερωμένα.");
  if (stale.length) out.push(`Χωρίς ενημέρωση πάνω από 2 λεπτά: ${stale.join(", ")}.`);
  return { offline: statusFailed, messages: out };
}
