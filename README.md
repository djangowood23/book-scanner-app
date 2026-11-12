# Book Scanner

A phone-first web app for cataloguing used books. Photograph a book, let Claude
read the photos into a listing form, check it, and export the batch as a CSV for
The Art of Books (AOB).

## How it works

1. Take up to four photos (cover, copyright page, title page, back) or pick them
   from the photo library. On browsers with built-in barcode reading (Chrome on
   Android) the ISBN is picked up from the barcode automatically.
2. **Read book** sends the photos to a Netlify Function, which asks Claude for
   the title, author, ISBN, publisher, year, edition, binding, visible condition
   points and a suggested price. The price is an estimate, not market data.
3. The reading also locates the front cover, which is straightened and placed
   on a white background as the main listing image (at least 1000 px on the
   long side). Tap any photo to adjust the corners by hand or go back to the
   original.
4. Review the form, then **Add to list**. The list is kept in the browser on
   that device until it is cleared.
5. **Export CSV for AOB** downloads `aob_export_<timestamp>.csv`.

The model used for reading is chosen in the app's Settings under Quality:
Best (Claude Opus 5.5, the default), Balanced (Claude Sonnet 5.5) or Cheapest
(Claude Haiku 5.5).

Photos are stored in Netlify Blobs when a book is added and served from `/img/<name>`, so the CSV
carries public image links.

## Shelving

`shelve.html` records which shelf or tub each book is in. Enter the location
(or read its label with the camera), photograph the handwritten SKU slips, and
each SKU is checked against a loaded AOB inventory export so misread
handwriting is flagged with the closest real SKUs. Saved shelves export as
`aob_locations_<timestamp>.csv` with two columns, `sku` and `location`.

## Layout

| Path | What it is |
| --- | --- |
| `frontend/` | The static site (no build step) |
| `frontend/lib.js` | SKU, ISBN, CSV and image-straightening helpers |
| `netlify/functions/scan.mts` | `POST /api/scan`: reads photos with Claude, or stores them |
| `frontend/shelve.html`, `shelve.js` | The shelving page |
| `netlify/functions/skus.mts` | `POST /api/skus`: reads SKU slips or a location label |
| `netlify/functions/send.mts` | `POST /api/send`: delivers an export file to AOB over SFTP |
| `netlify/functions/image.mts` | `GET /img/:name`: serves a stored photo |
| `tests/` | `npm test` |

## Netlify setup

`netlify.toml` sets the publish directory to `frontend` and the functions
directory to `netlify/functions`. The site's base directory in Netlify must be
the repository root for this to take effect.

Environment variables (scope must include Functions; redeploy after changing).
On plans without scope selection, leave "Contains secret values" unticked so
"All scopes" can be chosen:

| Name | Required | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` (or `CLAUDE_ACCESS`) | yes | Lets the scan function call Claude. Without it the app still works for manual entry. |
| `APP_PASSCODE` | no | If set, the app must be given the same passcode in Settings before it can read or save photos. Recommended, since the site is public and each read spends API credit. |
| `AOB_FTP_USER`, `AOB_FTP_PASSWORD` | no | The AOB SFTP login. With these and `APP_PASSCODE` set, Send to AOB delivers files straight to AOB. `AOB_FTP_HOST` (default `ftp.theartofbooks.com`) and `AOB_FTP_PORT` (default 22) and `AOB_FTP_DIR` (default: an inventory folder if the account has one, otherwise the main directory) are optional. |

## Development

```
npm install
npm test          # unit tests for the helpers and the scan function
npm run typecheck
```

To run the whole thing locally, use the Netlify CLI (`netlify dev`) with
`ANTHROPIC_API_KEY` set.
