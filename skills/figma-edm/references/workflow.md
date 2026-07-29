# Workflow — full step-by-step

Set the working dir first: `export EDM_DIR=/path/to/work` (all scripts read/write
here; default is cwd). Put the bundled `scripts/` on hand.

## 1. Pull the Figma frame

From the URL `figma.com/design/:fileKey/Name?node-id=2219-8`: `fileKey`, nodeId `2219-8`.

- `get_screenshot(nodeId, fileKey, maxDimension=<≥ node's long edge>)` → full
  reference. Download to `$EDM_DIR/figma_full.png`. Note its size (e.g. 700×2181)
  — this is the canvas the comparison uses.
- `get_design_context(nodeId, fileKey)` → returns reference code with **exact
  text**, **color tokens** (e.g. `#20283f`, `#0e4dff`), **per-element absolute
  x/y/w/h**, and **asset download URLs** (`const imgX = "https://.../asset/..."`).
  This is the source of truth for copy, colors, and geometry.
- `get_screenshot` on **each layered section node** (hero cover, dark banner) →
  flat images. These sections have gradients/glow/overlapping device mockups that
  are not worth rebuilding in email HTML; render them once as an image.

## 2. Assets

- `curl -sL -o` each asset URL into `$EDM_DIR/assets/`.
- **Transparency rule (see gotchas #6):** illustrations/logos/icons must come
  from the ORIGINAL image source (`download_assets` → `rawImages`, or the
  design-context asset URLs; REST: `GET /v1/files/:fileKey/images`) — never
  from `get_screenshot`, which flattens the canvas background into the asset.
  After downloading, alpha-check each non-flat asset (one-liner in gotchas #6);
  0% transparency on an asset that is transparent in Figma = flattened render,
  re-fetch.
- Resize illustrations to ~2× their display size and compress (`sips -Z` or PIL
  — keep RGBA; JPEG/RGB conversion belongs to the compact build only).
- Flat section images (hero/banner) at native width (e.g. 700) are fine as PNG for
  the full build; JPEG versions are made later for the compact build.

## 3. Fonts

Edit the `TEXT` block in `make_fonts.py` so it contains **all copy that renders as
real HTML text** (not text baked into images). Then:
```
python3 make_fonts.py    # → $EDM_DIR/pretendard_faces.css  (base64 @font-face, ~130KB)
```
It downloads Pretendard weights from the npm CDN into `assets/../fonts/`… actually
into `$EDM_DIR/fonts/` — pre-download them there if offline:
`Pretendard-{Light,Regular,SemiBold,Bold,ExtraBold}.woff2` from
`cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/static/woff2/`.

## 4. Build

```
python3 build_email.py             # → ~/Downloads/aisurfer_newsletter_{figma,responsive}.html
```
- `figma` variant: fixed 700px, the pixel-identical reference.
- `responsive` variant: same content + media-query breakpoints (700/600/480/360).
- Layout is nested `<table role="presentation">` with all styles inline; images
  are base64 `data:` URIs; fonts from `pretendard_faces.css`.

## 5. Verify (iterate here)

```
python3 compare.py ~/Downloads/aisurfer_newsletter_figma.html my_full.png
```
Reads `$EDM_DIR/figma_full.png` as reference. Prints:
- overall similarity + per-band table (`sim%`, mean Δ, best vertical shift, OK/FAIL),
- `height Δ` and a final `RESULT: PASS/FAIL` (height Δ beyond ±5px fails),
- writes `side_by_side.png` and `diff_heat.png` for visual inspection, and
  `verify.json` (machine-readable verdict: result/overall/height_delta/bands).

Fixing failures:
- **Height Δ / drift** → a section is the wrong height. Detect where by finding
  strong color boundaries (hero start/end, dark-band start/end, footer start) in
  both `figma_full.png` and the render; pin the offending section's height/padding.
- **A text band low** → font not embedded, or wrong size/leading, or a horizontal
  offset (see gotchas #1). Confirm the container isn't scrollbar-shifted.
- **A card band low** → illustration geometry. Set exact Figma px size + right/
  bottom anchor.
- **Color** → sample the rendered pixel vs the Figma token hex:
  ```python
  # patch mean of a small region in my_crop.png vs figma_full.png at a known (x,y)
  ```
  Fix the inline color if off.

Repeat build→compare until `RESULT: PASS`.

## 6. Responsive + package

- Verify the responsive file at real mobile/tablet widths with an **iframe** (see
  gotchas #2), confirming `pageOverflowX === false` and the expected font sizes.
- Compact build for Notion/preview:
  ```
  # first make JPEG assets: c_hero.jpg, c_dark.jpg, c_card{1..4}.jpg (flattened onto #f4f7ff)
  python3 build_email.py --compact --minify   # → $EDM_DIR/aisurfer_compact.html (<200KiB, 1 line)
  ```

## Deliverables produced

- `~/Downloads/aisurfer_newsletter_figma.html` — Figma-identical, fixed 700px.
- `~/Downloads/aisurfer_newsletter_responsive.html` — desktop→tablet→mobile.
- `$EDM_DIR/aisurfer_compact.html` — `<200KiB` preview (CDN font, JPEG images).
