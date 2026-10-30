# Feedback endpoint (Google Apps Script)

The ⓘ sheet's feedback form posts JSON (`text`, `version`, `page`, `ua`, optional `image` as
base64 JPEG) to a Google Apps Script web app. The script ([Code.gs](Code.gs)) adds a row to the
"Feedback" tab of a Sheet and saves the screenshot to a Drive folder. Google Forms itself takes no
files from users who are not signed in, hence the script.

## Setup (once, about 5 minutes)

1. Sheet: open the response Sheet of the existing idea form (or any Sheet). Copy its id from the
   URL: `docs.google.com/spreadsheets/d/<SHEET_ID>/edit`.
2. Folder: make a Drive folder for screenshots. Copy its id: `drive.google.com/drive/folders/<FOLDER_ID>`.
3. In the Sheet: Extensions → Apps Script. Replace `Code.gs` with this repo's `Code.gs`. Save.
4. Project Settings → Script properties: add `SHEET_ID` and `FOLDER_ID`.
5. Deploy → New deployment → type "Web app". Execute as: **Me**. Who has access: **Anyone**.
   Allow the Drive and Sheets permissions. Copy the web app URL (`https://script.google.com/macros/s/…/exec`).
6. Set it as the GitHub Actions variable `VITE_FEEDBACK_URL` of this repo (Settings → Secrets and
   variables → Actions → Variables). The next deploy shows the screenshot button.

Without `VITE_FEEDBACK_URL` the form still works: the text, version and page go to the old idea
form field, without the image.

A code change needs Deploy → Manage deployments → edit → New version; the URL stays the same.

Limits: request 2 MB, text 2000 characters, image 1.5 MB, 20 sends per minute and 50 images a
day for everyone together (counted in the script properties as `images_<day>`; old keys can be
deleted by hand). A send over a limit is refused whole, so the page keeps the text and the image. The
script answers `{"ok": true}` or `{"ok": false, "error": "…"}`; the page reads it (CORS) and keeps
the draft when it is not ok.
