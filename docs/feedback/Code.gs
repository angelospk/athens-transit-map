// Feedback endpoint for bus.haroldpoi.dev (src/lib/feedback.ts). Each POST adds a row to the
// "Feedback" tab of a Sheet and saves the screenshot, if any, to a Drive folder.
// Setup: docs/feedback/README.md. Script properties: SHEET_ID, FOLDER_ID.

const MAX_TEXT = 2000;
const MAX_BODY = 2 * 1024 * 1024; // the whole request, checked before parsing
const MAX_IMAGE = 1.5 * 1024 * 1024; // bytes after decoding; the page sends ~100-400 KB JPEGs
const PER_MINUTE = 20; // sends, all senders together: a flood stops here, not in the Sheet
const IMAGES_PER_DAY = 50; // at most ~75 MB of Drive a day, whatever happens
const TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

function doPost(e) {
  try {
    if (!e.postData || e.postData.length > MAX_BODY) return reply({ ok: false, error: "too_big" });
    const f = JSON.parse(e.postData.contents);
    const text = String(f.text || "").trim().slice(0, MAX_TEXT);
    if (text.length < 3) return reply({ ok: false, error: "empty" });
    if (!underLimit("n" + Math.floor(Date.now() / 60000), PER_MINUTE, 120)) return reply({ ok: false, error: "busy" });
    const props = PropertiesService.getScriptProperties();

    let imageUrl = "";
    const data = f.image && typeof f.image.data === "string" ? f.image.data : "";
    if (data) {
      // base64 is 4/3 of the bytes: check before decoding. A refused image refuses the whole send,
      // so the page keeps the draft and the image instead of losing the image silently.
      if (!TYPES[f.image.type] || data.length > MAX_IMAGE * 4 / 3 + 4) return reply({ ok: false, error: "bad_image" });
      if (!imagesLeftToday()) return reply({ ok: false, error: "busy" });
      const bytes = Utilities.base64Decode(data);
      const name = Utilities.formatDate(new Date(), "Europe/Athens", "yyyy-MM-dd_HH-mm-ss") + "." + TYPES[f.image.type];
      imageUrl = DriveApp.getFolderById(props.getProperty("FOLDER_ID"))
        .createFile(Utilities.newBlob(bytes, f.image.type, name)).getUrl();
    }

    const book = SpreadsheetApp.openById(props.getProperty("SHEET_ID"));
    const tab = book.getSheetByName("Feedback") || book.insertSheet("Feedback");
    if (tab.getLastRow() === 0) tab.appendRow(["Ώρα", "Κείμενο", "Έκδοση", "Σελίδα", "Συσκευή", "Εικόνα"]);
    tab.appendRow([new Date(), cell(text), cell(f.version), cell(f.page), cell(f.ua), imageUrl]);
    return reply({ ok: true });
  } catch (err) {
    console.error(err);
    return reply({ ok: false, error: "failed" });
  }
}

// Text that starts with = + - @ would run as a formula in the Sheet: store it as plain text.
function cell(v) {
  const s = String(v == null ? "" : v).slice(0, MAX_TEXT);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

// Counts one use of key and reports whether it is still within max (cache lives ttl seconds).
function underLimit(key, max, ttl) {
  const cache = CacheService.getScriptCache();
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const n = Number(cache.get(key) || 0) + 1;
    cache.put(key, String(n), ttl);
    return n <= max;
  } finally {
    lock.releaseLock();
  }
}

// The daily image budget lives in the script properties: the cache may drop a counter early.
function imagesLeftToday() {
  const props = PropertiesService.getScriptProperties();
  const key = "images_" + Utilities.formatDate(new Date(), "Europe/Athens", "yyyy-MM-dd");
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const n = Number(props.getProperty(key) || 0) + 1;
    if (n > IMAGES_PER_DAY) return false;
    props.setProperty(key, String(n));
    return true;
  } finally {
    lock.releaseLock();
  }
}

function reply(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
