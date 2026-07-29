---
name: figma-edm
description: >-
  Use when turning a Figma design into an email/eDM/newsletter as HTML that
  matches the design faithfully — including when the user says "피그마 디자인
  그대로 이메일 HTML로 만들어줘", "eDM 만들어줘", "뉴스레터 HTML", "이메일로 보낼
  HTML", or shares a figma.com design URL for an email/newsletter frame. Covers
  the full pipeline: pull the Figma frame, build email-safe table HTML with
  self-contained assets and embedded Pretendard, VERIFY pixel-fidelity against
  the Figma export with an objective PASS bar (not eyeballing), add a
  responsive (tablet/mobile) variant, and package a Figma-identical file + a
  responsive file + a compact (<200KiB) preview. Also use when an existing eDM
  built this way needs a copy/design tweak — the bundled scripts regenerate and
  re-verify. Skip for non-email web pages, for app UI implementation, or when
  the user only wants a quick screenshot of a Figma node.
---

# Figma → Email (eDM) HTML

Turn a Figma email/newsletter frame into **send-ready HTML that provably matches
the design**, then package desktop / responsive / preview variants.

Answer the user in Korean. This guide is in English on purpose (procedural logic
is followed more reliably in English); keep it that way when editing.

## Why this skill exists

A modern model can produce plausible email HTML from a Figma screenshot without
help. The value here is **guarantees, not vibes**:

1. **Objective fidelity** — a headless-Chrome render is compared band-by-band
   against the Figma export with a numeric PASS bar. "Looks the same" is
   replaced by "text 100%, images 100%, every text band ≥93%, height Δ≤±5px".
   Never claim parity from eyeballing a screenshot.
2. **Email-safe by construction** — table layout + inline styles + self-contained
   base64 assets + subsetted embedded Pretendard. Renders in Apple Mail / Outlook
   desktop / most ESPs the same way a year later.
3. **Reproducible on edits** — copy/design tweaks are a script edit + one verify
   run away, not a rebuild from scratch.

## Prerequisites

- **Figma MCP** tools: `get_screenshot`, `get_design_context`, `get_metadata`
  (claude.ai Figma server). Extract `fileKey` + `nodeId` from the URL:
  `figma.com/design/:fileKey/...?node-id=2219-8` → fileKey, nodeId `2219-8`.
- **Local Chrome** for the headless render. `compare.py` finds it per platform;
  set `CHROME_BIN` to override (the Letterpress app passes it in).
- **Python**: `PIL numpy fonttools brotli` (`python3 -m pip install ...`).
  On Windows `python3` does not exist — use `py -3` for every `python3` command
  in this skill (the bundled scripts call `sys.executable` internally, so they
  are fine either way).
- A working directory (the "EDM_DIR"). The bundled scripts read/write there via
  the `EDM_DIR` env var (default: cwd). Set it once: `export EDM_DIR=/path/to/work`.

## Bundled files

- `scripts/build_email.py` — the builder. Emits `*_figma.html` (fixed 700px,
  pixel-identical) and `*_responsive.html` to `~/Downloads`; `--compact --minify`
  emits a single-line `<200KiB` `aisurfer_compact.html` for Notion/preview.
- `scripts/compare.py` — the verification harness (render + band diff + PASS/FAIL).
- `scripts/make_fonts.py` — subsets Pretendard to the glyphs used → `pretendard_faces.css`.
- `references/workflow.md` — the full step-by-step with every command.
- `references/gotchas.md` — the non-obvious failures and their fixes. **Read this
  before debugging a mismatch** — most "bugs" are test-harness artifacts, not real.

The bundled scripts are the **AISURFER eDM reference implementation** (the design
first built with this skill). For a new design or a copy tweak, edit the marked
content in place — see "Adapting" below.

## Workflow (summary — full detail in references/workflow.md)

1. **Pull the frame.** `get_screenshot(nodeId)` at high `maxDimension` for the
   full reference (e.g. 700×2181 → save as `figma_full.png`). `get_design_context`
   for exact text, color tokens, per-element coordinates, and asset download URLs.
2. **Get assets.** Download the asset URLs. **Render layered sections (hero, dark
   banner with gradients/glow/overlays) as ONE flat image** via `get_screenshot`
   of that section's node — do not reconstruct layers in email HTML. Fetch every
   raster asset (flat sections included) at **2× display size** for retina
   screens. Standalone illustrations/logos must come from the ORIGINAL image
   source, never from `get_screenshot` (it flattens the canvas background in —
   gotchas #6); alpha-check every non-flat asset after download.
3. **Fonts.** Run `make_fonts.py` to subset every Pretendard weight used down to
   only the glyphs in the copy (~130KB for 5 weights) → embedded @font-face.
4. **Build.** `python3 build_email.py` → figma + responsive files. Images are
   base64-inlined; layout is nested `<table>` with inline styles. **Never rely
   on background images** (Outlook drops them — gotchas #7): bake overlay text
   into the flat section image, or use the VML fallback + `bgcolor` when the
   text must stay live.
5. **VERIFY (the point of this skill).** `python3 compare.py <html> <out.png>`.
   It renders at a **820px window** (see gotchas: avoids the 700px scrollbar
   artifact), crops to the container, aligns each band, and prints per-band
   similarity + a PASS/FAIL. Iterate the build until PASS. Fix real diffs
   (heights, image geometry, colors), and confirm colors by sampling pixels
   against the Figma token hex.
6. **Responsive + package.** The responsive file adds media-query breakpoints.
   **Test responsiveness with an iframe at a fixed width in a real browser**, not
   headless (see gotchas). Then produce the compact `<200KiB` variant for Notion.

## The PASS bar (criteria)

| # | Check | How | Pass |
|---|-------|-----|------|
| A | Text | Figma strings ↔ HTML strings | 100% |
| B | Color | rendered pixels ↔ Figma token hex (sample) | key elements exact |
| C | Pixel | band-by-band similarity (shift-tolerant) | image bands ≥99%, text bands ≥93%, overall ≥93% |
| D | Size | section y-positions + total height | Δ ≤ ±5px |

`compare.py` prints C and D and a final `RESULT: PASS/FAIL`, and writes the
same verdict machine-readably to `$EDM_DIR/verify.json` (`result`, `overall`,
`height_delta`, per-band results) — downstream tools (e.g. the Letterpress
quality gate) read that file. A and B are quick manual/scripted checks. Do not
declare "identical" until C+D pass and A+B hold.

## Adapting when copy or design changes

Most edits are small. In order of likelihood:

- **Copy text change** → edit the strings in `build_email.py` (the `card(...)`
  calls and section `<div>`s) AND the `TEXT` block in `make_fonts.py` (so new
  glyphs get subset), rerun `make_fonts.py` then `build_email.py`, then verify.
- **Color/spacing tweak** → edit inline styles in `build_email.py`; re-verify.
- **New/replaced illustration** → drop the new asset, update the `b64(...)` name
  and the card image `iw/ih`/align to the Figma coords; re-verify.
- **Structural change (added/removed section)** → update the section markup AND
  the `BANDS` y-ranges in `compare.py` (get fresh y-ranges from the new
  `figma_full.png`); re-fetch the reference with `get_screenshot`; re-verify.

If the *file/fileKey/node* changed, that's a new design: re-run step 1 to get a
fresh `figma_full.png` and design context, then adapt content.

## Notion / delivery notes

- Email HTML with base64 assets works in Apple Mail / Outlook / most ESPs.
  **Gmail web ignores embedded fonts and `data:` images** — for Gmail bulk sends,
  host images on a server/CDN and swap `<img src>` to URLs.
- **Gmail clips bodies over ~102KB** (gotchas #8) — the send/hosted variant must
  also swap the embedded `@font-face` block for the Pretendard CDN `@import`
  (the Letterpress hosting step does both swaps automatically). Embedded fonts
  are for the preview/fidelity variants only.
- **Dark mode** (gotchas #9): declare `color-scheme: light` metas; Gmail/Outlook
  force-recolor anyway, so transparent logos and section boundaries must
  survive a background flip — manual dark-mode check before send.
- Notion attachment API caps inline uploads at **200KiB** and otherwise needs a
  public HTTPS URL; the browser `file_upload` tool no longer accepts host paths.
  So a 1.4MB self-contained file can't be auto-uploaded — either drag-drop it
  into Notion manually, or host it and embed the URL. The compact `<200KiB`
  variant exists for this reason.
