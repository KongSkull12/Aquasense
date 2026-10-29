---
name: AquaSense
description: Water-quality monitoring and feeding control for redclaw crayfish tanks, drawn as a hydrographic chart.
colors:
  ink: "#0f2a3d"
  ink-soft: "#173a52"
  ink-2: "#3d566a"
  ink-3: "#5b7083"
  line: "#d6e2ea"
  line-soft: "#e8eff4"
  water: "#f4f8fb"
  deep-water: "#ffffff"
  band: "#e1eef6"
  contour: "#7aaecb"
  sounding: "#1d5d86"
  sounding-dark: "#164a6c"
  shoal: "#f1e9d2"
  note: "#a3124b"
  ok: "#1d6b47"
  ok-bg: "#e9f5ee"
  ok-ink: "#154f35"
  warn: "#a14e06"
  warn-bg: "#fcf1e1"
  warn-ink: "#6b3504"
  alarm: "#b42318"
  alarm-bg: "#fdecea"
  alarm-ink: "#7a1a12"
  rail: "#0f2a3d"
  rail-hover: "#173a52"
  rail-text: "#b6ccda"
typography:
  display:
    fontFamily: "Archivo, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "clamp(2.5rem, 5vw, 3.5rem)"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Archivo, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  reading:
    fontFamily: "Archivo, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "32px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.025em"
    fontFeature: "\"tnum\" 1"
  title-page:
    fontFamily: "Archivo, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Archivo, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.375
  body:
    fontFamily: "Archivo, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.625
  body-public:
    fontFamily: "Archivo, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.625
  lede:
    fontFamily: "Archivo, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.625
  label:
    fontFamily: "Archivo, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.375
  caption:
    fontFamily: "Archivo, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.625
rounded:
  swatch: "2px"
  md: "6px"
  lg: "8px"
spacing:
  cell-y: "14px"
  panel: "16px"
  panel-wide: "20px"
  stack: "20px"
  page-x-sm: "16px"
  page-x-md: "24px"
  page-x-lg: "32px"
  section-public: "64px"
  section-public-wide: "96px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.deep-water}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.ink-soft}"
  button-secondary:
    backgroundColor: "{colors.deep-water}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "36px"
  button-secondary-hover:
    backgroundColor: "{colors.water}"
  button-quiet:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "36px"
  button-quiet-hover:
    backgroundColor: "{colors.water}"
    textColor: "{colors.ink}"
  button-danger:
    backgroundColor: "{colors.deep-water}"
    textColor: "{colors.alarm}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "36px"
  button-danger-hover:
    backgroundColor: "{colors.alarm-bg}"
  field:
    backgroundColor: "{colors.deep-water}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "40px"
  field-disabled:
    backgroundColor: "{colors.water}"
    textColor: "{colors.ink-3}"
  panel:
    backgroundColor: "{colors.deep-water}"
    rounded: "{rounded.lg}"
    padding: "{spacing.panel-wide}"
  reading-cell:
    backgroundColor: "{colors.deep-water}"
    textColor: "{colors.ink}"
    typography: "{typography.reading}"
    padding: "16px 20px"
  next-line-info:
    backgroundColor: "{colors.band}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
  next-line-warn:
    backgroundColor: "{colors.warn-bg}"
    textColor: "{colors.warn-ink}"
  next-line-alarm:
    backgroundColor: "{colors.alarm-bg}"
    textColor: "{colors.alarm-ink}"
  notice-info:
    backgroundColor: "{colors.water}"
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "10px 14px"
  notice-warn:
    backgroundColor: "{colors.warn-bg}"
    textColor: "{colors.warn-ink}"
  notice-alarm:
    backgroundColor: "{colors.alarm-bg}"
    textColor: "{colors.alarm-ink}"
  notice-ok:
    backgroundColor: "{colors.ok-bg}"
    textColor: "{colors.ok-ink}"
  rail-link:
    textColor: "{colors.rail-text}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "40px"
  rail-link-active:
    textColor: "{colors.deep-water}"
---

# Design System: AquaSense

## Overview

**Creative North Star: "The Hydrographic Chart"**

AquaSense reads like a nautical chart of the tank. White is deep water, the ground everything is printed on. Guidance ranges are drawn as pale blue depth bands with dashed contour edges; anything outside them falls on buff shoal tint. Trust is printed in the margin as a chart note: a small mark plus words, magenta when the reading itself cannot be relied on. Ink navy carries text, the rail, and the plotted line. Nothing glows, floats, or tiles.

The system is dense and quiet. One family (Archivo) ranks everything by size and weight, with tabular numerals wherever numbers line up or update. Structure comes from 1px hairlines and shared-border grids rather than cards with shadows, so the dashboard's reading strip, the public capability grid, and the How-it-works step grid all read as one ruled sheet subdivided into whole cells. Status never relies on colour alone: each state has its own printed shape.

The public site inherits the same world at a larger scale: ink-on-white editorial headings, the same hairline grids, the navy rail reappearing as the footer and the auth aside, and a static sample band chart standing in for the console.

**Key Characteristics:**
- White deep-water ground, ink navy text and rail, hairline structure.
- Guidance ranges drawn as depth bands with dashed contour edges on every time-series chart.
- State shown as a printed mark: shape plus colour plus words.
- Magenta is reserved for data-trust notes; red and amber only for real alarms and warnings.
- One family, tabular numerals, rank by weight and size, never by case.
- Flat at rest; a single soft shadow exists only for things that float over other content.

## Colors

A cool chart palette of navy ink and pale water tints, with one warm buff for out-of-range and three reserved signal colours.

### Primary
- **Chart Ink** (ink): body text, headings, the dashboard rail, the primary button, and the plotted line on every chart. Ink Soft (ink-soft) is its hover step.
- **Sounding Blue** (sounding): inline links, focus outline, caret colour, step ordinals and informational marks. The only interactive blue; Sounding Dark (sounding-dark) is its pressed/deep step.

### Secondary
- **Depth Band** (band): the guidance-range fill on charts, the band key swatch, and the calm (info) background of the Next line.
- **Contour Blue** (contour): the dashed edge of every depth band, chart cursor, and the hover border of fields and secondary buttons.
- **Shoal Buff** (shoal): the out-of-range zone on charts (drawn at 60-70% opacity) and its key swatch. Never used as a general surface colour.

### Tertiary
- **Chart-Note Magenta** (note): the trust state. Readings whose sensor needs calibration, or values the system will not vouch for ("Not commissioned"). Its rarity is its meaning.

### Signal
- **Safe Green** (ok, with ok-bg and ok-ink): calibrated, in-guidance, online.
- **Amber Warning** (warn, with warn-bg and warn-ink): stale data, outside guidance, connection errors.
- **Alarm Red** (alarm, with alarm-bg and alarm-ink): lost connection, active alarms, destructive actions.

### Neutral
- **Deep Water** (deep-water): the page ground, panel and cell fills.
- **Still Water** (water): quiet hover fills, info notices, disabled fields, alternating public sections.
- **Hairline** (line) and **Faint Hairline** (line-soft): panel borders and shared-border grids; line-soft divides rows inside a panel and draws the chart grid.
- **Ink 2** (ink-2) and **Ink 3** (ink-3): secondary text and captions, axis ticks, units, empty values.
- **Rail Text** (rail-text): text and inactive links on the navy rail and footer.

### Named Rules
**The Chart-Note Rule.** Magenta means "this value is not trustworthy as shown" and nothing else. It is never a brand accent, link, or decoration.

**The Real-Alarm Rule.** Red and amber appear only when a reported state warrants them (lost connection, outside guidance, active alert, destructive action). Calm screens are ink, white, and blue.

**The Shoal Rule.** Buff marks the water outside a guidance range. If a series has no validated range, draw no band and no shoal; say so in the guidance text instead.

## Typography

**Display Font:** Archivo (with system-ui, -apple-system, Segoe UI, sans-serif)
**Body Font:** Archivo
**Label/Mono Font:** Archivo with tabular numerals (`font-variant-numeric: tabular-nums`)

**Character:** A single workmanlike grotesque doing everything, like the lettering on a printed chart: semibold for anything you scan, regular for anything you read, slightly tightened tracking on headings.

### Hierarchy
- **Display** (600, 2.5rem to 3rem to 3.5rem by breakpoint, 1.05, -0.025em): the landing hero only. Public page intros use 2.25rem to 3rem at 1.08, -0.02em.
- **Headline** (600, 1.875rem to 2.25rem, 1.25): public section headings, max ~42rem wide.
- **Reading** (600, 28px to 32px, 1, tight tracking, tabular): live values in the reading strip; the unit sits beside it at 16px, 500, ink-3.
- **Page title** (600, 22px to 24px, 1.25): dashboard page heads.
- **Title** (600, 15px, 1.375): panel and section titles; chart titles at 14px.
- **Body** (400, 14px, 1.625): dashboard copy and descriptions, max ~48rem. Public body is 15px; public ledes 18px in ink-2, max ~42rem.
- **Label** (500, 13px): reading-cell labels, state marks, notices, field labels (600).
- **Caption** (400, 12px): meta labels, chart guidance and notes, band key, footers.

### Named Rules
**The Weight-Not-Case Rule.** Hierarchy comes from size and weight. No uppercase labels, no letter-spaced eyebrows above headings.

**The Tabular Rule.** Any number that updates live or aligns in a column (readings, meta times, key-value values, schedule times, indices) uses tabular numerals.

## Layout

Dashboard: a 240px navy rail beside a scrolling main column (max 1440px; padding 16/24/32px by breakpoint), stacked at 20px. Below 1024px the rail becomes a 56px navy top bar with a 272px slide-in drawer over an ink scrim. The page head sits on a hairline rule with meta items (label over tabular value) to the right.

The reading strip is a shared-border grid: cells sit on a hairline-coloured background with a 1px gap, so borders are drawn once. It reflows in whole cells: 2 columns on phones, 3 from 768px, 6 in one row from 1280px. Each cell has fixed furniture: label, value with unit, state mark. Below it, trends and a 340px side column split from 1280px; charts pair two-up from 768px, an odd last chart spans the row, and series without data collapse into one printed "No trend yet" list instead of empty charts.

Public pages: a 1152px container, 64px section padding (96px from 640px), two-column hero and intros from 1024px, alternating white and still-water sections separated by hairlines. Capability and step lists reuse the shared-border grid.

Spacing rhythm: 14px cell/header vertical, 16px panel and grid gap, 20px panel padding on wider screens and page stack.

## Elevation & Depth

Flat. Depth is tonal (white on still water, band on white) and drawn with hairlines. One soft, navy-tinted shadow exists, for things that genuinely float over other content: chart tooltips and the sample reading card overlapping the landing hero photo.

### Shadow Vocabulary
- **Overlay** (`box-shadow: 0 8px 24px -6px rgba(15, 42, 61, 0.18), 0 2px 6px -2px rgba(15, 42, 61, 0.12)`): tooltips, popovers, a card laid over an image.

### Named Rules
**The Overlay-Only Rule.** Panels, cells, buttons and fields have no shadow. If it does not overlap something else, it does not cast one.

## Shapes

Gently squared corners: 6px for buttons, fields, notices, tooltips, the Next line and the empty-chart label; 8px for panels, the reading strip and photographs; 2px for band-key swatches. The only capsules are thin progress bars (the password-strength meter). Borders are 1px hairlines; dashed hairlines are reserved for contour edges and empty states. The logo is the one round badge (a circular mascot). State marks are 10px printed glyphs: filled circle (ok), open diamond (trust), filled triangle (warn), filled square (alarm), ringed dot (info), open circle (off).

## Components

### Buttons
Plain, compact, confident.
- **Shape:** gently squared (6px), 36px tall, 14px horizontal padding, 14px semibold. Small: 32px, 13px. Large: 44px, 15px (public CTAs).
- **Primary:** ink on white text; hover steps to ink-soft. One per view region.
- **Secondary:** white with a hairline border; hover shifts the border to contour and the fill to still water.
- **Quiet:** text-only in ink-2; hover fills still water and darkens to ink.
- **Danger:** white with hairline border and alarm text; hover tints alarm-bg.
- **Focus / Disabled:** global 2px sounding-blue outline offset 2px; disabled at 45% opacity, not-allowed cursor. Colour transitions 150ms.

### Cards / Containers (Panel)
- **Corner Style:** 8px.
- **Background:** white.
- **Shadow Strategy:** none (see Elevation).
- **Border:** 1px hairline; optional header (15px title, 13px ink-3 description, actions right) separated by a faint hairline.
- **Internal Padding:** 16px, 20px from 640px.
- Key-value lists inside panels are hairline-divided rows: ink-2 label left, tabular ink value right.

### Inputs / Fields
- **Style:** 40px tall, white, 1px hairline, 6px radius, 12px padding, 14px ink text, ink-3 placeholder; hover border contour.
- **Focus:** border becomes sounding blue with a 2px sounding ring at 20%.
- **Disabled:** still-water fill, ink-3 text. Labels are 13px semibold ink above; hints 12px ink-3 below.

### Navigation
- **Dashboard rail:** navy, logo and farm name at top, 40px links with 18px line icons; inactive rail-text, hover white on 5% white, active white semibold on 9% white with a pale contour-tinted icon. Tank name, user and an outlined Log out at the foot.
- **Public header:** sticky, white at 85-95% with light blur, hairline bottom; 14px ink-2 links, the active one ink with a 2px ink rule on the header's bottom edge. Phone: a stacked hairline-divided list plus Sign in / Create account buttons.
- **Footer:** the navy rail colour, rail-text links that turn white on hover.

### State Mark (signature)
The printed chart note. A 10px glyph aligned to the first line of 13px medium text, both in the state colour (ok, trust/magenta, warn, alarm, info/sounding, off/ink-3). Used under every reading, in meta items, in risk status and on the landing trust list. Never rendered as a pill, badge or icon tile.

### Band Chart (signature)
Recharts line chart on a horizontal-only faint-hairline grid: guidance range as a band-filled area with a dashed contour stroke (4 3), shoal tint at 60% above and below when the domain is fixed, a 1.6px ink line without dots, 11px ink-3 axis ticks, and the overlay tooltip with tabular values. Framed by a Chart Panel: title and guidance on one baseline, chart, then a 12px printed note. A Band Key explains band and shoal. Empty series print a sentence instead of an axis.

### Next Line
A full-width 6px-radius strip that opens the overview with the word "Next" in semibold and one or more plain-sentence steps, each linking to the page that resolves it. Band tint when calm, warn or alarm tints when the reported state warrants.

### Notice
A 6px-radius bordered message (13px) in four tones: info (still water), warn, alarm, ok; alarm uses role="alert". The connection notice is the one shared wording for a lost live link.

### Motion
Sparse and functional: 150ms colour transitions, a 200ms drawer slide, a 260ms "reading settle" (fade from 35% and 2px rise) when a live value changes, and a 420ms directional slide for auth panels, all on cubic-bezier(0.16, 1, 0.3, 1). Reduced motion collapses all of it.

## Do's and Don'ts

### Do:
- **Do** draw every time series with a fixed guidance range as a depth band with dashed contour edges and shoal tint outside it.
- **Do** pair every reading with a State Mark that names its trust state in words and shape, not colour alone.
- **Do** build grids of equal items as shared-border grids (1px gap over the hairline colour) that reflow in whole cells.
- **Do** use tabular numerals for live and aligned numbers.
- **Do** keep calm screens to ink, white, water tints and sounding blue; bring in amber, red or magenta only when the data says so.
- **Do** collapse empty series into a printed sentence rather than drawing empty charts.

### Don't:
- **Don't** use white cards with coloured icon tiles as KPI grids.
- **Don't** show states as pill badges; use the printed State Mark.
- **Don't** use magenta for anything other than data trust.
- **Don't** put shadows on panels, cells, buttons or fields; the overlay shadow is for floating elements only.
- **Don't** add uppercase or letter-spaced eyebrow labels above headings.
- **Don't** introduce a second typeface.
