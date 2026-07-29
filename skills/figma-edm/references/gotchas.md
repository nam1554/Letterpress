# Gotchas — read this BEFORE debugging a fidelity mismatch

Most "the render is wrong" moments in this pipeline are **test-harness artifacts**,
not real HTML bugs. Check these first.

## 1. Headless Chrome scrollbar-gutter artifact (the big one)

Rendering at exactly `--window-size=700` (the container width) makes the reserved
vertical-scrollbar width distort layout: content shifts ~16px left, the right
padding gets eaten, and text appears clipped at the right edge. `--hide-scrollbars`
does not fully fix it.

**Fix:** render at a **wider window (820px)** so the 700px container centers with
real gray gutters, then crop to the container's non-background bounds before
comparing. `compare.py` already does this (renders 820, `autocrop` trims gutters).
If you see a uniform ~16px horizontal shift with only-left-padding, this is why —
it is NOT a real CSS bug.

## 2. Responsive testing: headless lies, iframes tell the truth

Headless Chrome **does** respect `--window-size` for media queries (probe: a
`max-width:700px` rule fires at window 700, not at 900). BUT the scrollbar-gutter
artifact above makes a 390px headless screenshot look badly clipped even when the
layout is correct.

**Fix:** test responsiveness with an **iframe of fixed width in a real browser**,
then read ground truth via JS:
```js
const ifr = document.querySelector('iframe'); const d = ifr.contentDocument, w = ifr.contentWindow;
JSON.stringify({ innerWidth: w.innerWidth, scrollWidth: d.documentElement.scrollWidth,
  pageOverflowX: d.documentElement.scrollWidth > w.innerWidth,
  titleFont: getComputedStyle(d.querySelector('.sec-h')).fontSize })
```
If `pageOverflowX` is false and `scrollWidth === innerWidth`, the layout is fine
regardless of what a headless screenshot appears to show.

Also note: the claude-in-chrome `resize_window` may report success without actually
changing the viewport (`window.innerWidth` stayed 1512 after a "resize to 414").
Always confirm the real viewport via JS before trusting a responsive screenshot.

## 3. The pixel metric must be shift-tolerant

A raw per-pixel diff punishes a 3px vertical offset as if the content were wrong
(a shared image dropped to ~40% "similarity" from a +3px shift). `compare.py`
searches a small vertical shift (−8..+8) per band and takes the best — this
measures *content* difference, not sub-pixel drift. Keep this when editing the
harness; otherwise you will chase phantom failures.

Also: **card bands are mostly text** (title+desc on the left, illustration only on
the right ~173px). Score them against the text threshold (~93%), not the image
threshold (99%). Only the pure-image sections (hero, dark banner) get 99%.

## 4. Fonts: system fallback ≠ Figma

Figma renders Pretendard; a bare email HTML falls back to a system Korean font, so
text bands plateau ~88–90% no matter what. Embedding Pretendard (subset) pushes
text bands to 95%+. Even with the *same* font, a text band never hits ~100% —
Chrome's text layout differs subtly from Figma's — so ~93–97% on text is
"visually identical", not a defect.

- Subset with `python3 -m fontTools.subset` (the CLI `pyftsubset` may not be on
  PATH). Feed it exactly the glyphs in the copy → ~26KB/weight, ~130KB for 5.
- Download Pretendard from the **npm** CDN, not the gh mirror
  (`cdn.jsdelivr.net/npm/pretendard@1.3.9/...`); the gh mirror returns
  "Package size exceeded" for this repo.

## 5. Card heights and image geometry are load-bearing

- Figma cards are a **fixed 136px** tall. If you let the table auto-size, cards
  compress ~14px each and the whole page ends up ~34px short → cumulative drift
  fails band alignment. Pin `height:136px` on the card table and its cell.
- Place each illustration with the **exact Figma coordinates** from
  `get_design_context` (per-card width/height + right/bottom anchor). Guessing
  size/centering drops the card image-area to ~76–86%. Right+bottom anchored with
  the exact px sizes gets 95–97%.

## 6. Screenshots flatten transparency — never use them for illustration assets

`get_screenshot` (and even a node-level `download_assets` **export**) rasterizes
the node **as displayed on canvas**: whatever sits behind it — the white card
surface, the dark footer — gets baked in and alpha is gone. Verification will
NOT catch this (the baked background matches the surroundings by construction),
but the asset is contaminated: re-hosted on a CDN or placed on any other
background it shows a solid box. Confirmed case: card illustrations screenshotted
at their card position came out fully opaque with white corners; the original
image fills were 512×512 PNGs with 71% transparent pixels.

**Rules:**
- Screenshots are ONLY for (a) the full-frame reference (`figma_full.png`) and
  (b) intentionally-flat section renders (hero, dark banner) where the baked
  background IS the content.
- Standalone illustrations / logos / icons must come from the **original image
  source**: `download_assets` → `rawImages` (original uploaded fills, alpha
  preserved), or the asset URLs in `get_design_context`. REST fallback:
  `GET /v1/files/:fileKey/images` (getImageFills) returns the original fill
  URLs.
- **Alpha-check every non-flat asset after download** — takes one line:
  ```python
  from PIL import Image; import numpy as np
  a = np.asarray(Image.open(p).convert("RGBA"))[:, :, 3]
  print(p, "transparent%", ((a < 255).mean() * 100).round(1))
  ```
  If an asset that shows transparency in Figma reports 0%, you fetched a
  flattened render — re-fetch from the raw source before building.

## 7. Outlook desktop drops background images

CSS `background-image`, shorthand `background:url()`, and the `background=`
attribute all render as **nothing** in Outlook desktop (Word engine) — the
section falls back to its `bgcolor`, so overlay text floats on a flat color and
the art silently disappears for a large share of B2B recipients. Pixel-verify
(headless Chrome) can NOT catch this. Confirmed in production: a CTA section
built as live text over `background="images/cta_bg.png"` verified PASS but
would have shipped art-less to every Outlook desktop reader.

**Rules:**
- Default: **bake overlay text into the flat section render** — one `<img>`,
  identical everywhere.
- Only when the overlay copy must remain live HTML text (planned copy edits,
  translation): keep the background image but add the bulletproof VML fallback
  (`<!--[if gte mso 9]><v:rect ...><v:fill src="..."/><v:textbox>` around the
  content) AND a solid `bgcolor` matching the art's dominant color.
- Never ship a background image with neither fallback.

## 8. Gmail clips the message at 102KB — embedded fonts blow the budget

Gmail truncates any HTML body over ~102KB ("[Message clipped]"), hiding the
rest — including the footer/unsubscribe link (a compliance problem, not just
cosmetic). A subset Pretendard embed alone is ~70–130KB, so a send file that
keeps fonts embedded is clipped even after images move to a CDN.

**Rules:**
- Embedded `@font-face` (base64) belongs to the **preview/fidelity variants**
  (`*_figma.html`, `*_responsive.html`, self-contained preview) only.
- The **send/hosted variant** must swap the embedded block for the CDN import
  (`@import url('https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/static/pretendard.min.css')`)
  — Apple Mail/iOS still get Pretendard; Gmail/Outlook fall back to the system
  stack already present in every `font-family`. Target: send HTML < 102KB.
- Keep the embedded block recognizable (standard `@font-face` + `data:` URI in
  a `<style>`) — the Letterpress hosting step detects and swaps it
  automatically when generating `hosted/` variants.

## 9. Compact (<200KiB) variant for Notion/preview

To fit Notion's 200KiB inline cap:
- Re-encode opaque sections (hero, dark banner) as **JPEG** (q~58).
- **Flatten** transparent card illustrations onto the card background color
  (`#f4f7ff`) and save as JPEG — no transparency needed, blends invisibly.
- Keep logos/arrow as small PNG (need transparency on colored bg).
- Swap embedded fonts for a **CDN `@import`** (progressive enhancement; falls back
  to system font). Total ≈ 120–150KiB.
- `--minify` collapses to a single line.

## 10. Notion upload reality

- `notion-create-attachment` inline `content` ≤ 200KiB; otherwise needs a public
  HTTPS URL. `Read` truncates ~25K tokens so you can't even feed a 120KB file's
  content into a tool call cleanly.
- The browser `file_upload` tool **no longer accepts host filesystem paths**
  (it wants file bytes inline, which isn't exposed). So you cannot programmatically
  push a local 1.4MB file into Notion. Options: (a) user drag-drops from Finder,
  (b) host the file and embed the URL, (c) upload the compact variant if it fits
  a working path-based uploader.
- Uploading HTML to Notion via the UI creates a **download attachment**, not a
  live render. Live in-page render requires `<embed src="file-upload://...">` via
  the API (needs the ≤200KiB inline path) or a public URL in the embed's "link" tab.
