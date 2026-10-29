---
version: 1
slug: "pages-dashboard-dashboardoverviewpage-tsx-70cde235"
primary_target: "Frontend/src/pages/dashboard/DashboardOverviewPage.tsx"
related_targets: ["Frontend/src/components/WaterQuality/DashboardLayout.tsx","Frontend/src/pages/LandingPage.tsx"]
---

Scope: whole AquaSense web frontend. Dashboard console (Operate) is the primary surface; auth (Operate) and public pages (Persuade, inheriting the same world) follow.
Audience: farm operators on phones at the tank, owners on desktop. Task: know if the tank is safe, which readings to trust, what to do next.
Constraints: keep every sensor/trust state and limitation's meaning; demo controls must say so; no invented claims.

## Direction contract

THESIS: Readings are plotted on a hydrographic chart: guidance range as shaded water, outside it as shoal tint, trust state as a printed magenta chart note. Refuses the white-card-with-coloured-icon-tile KPI grid and pill-badge soup.

OWN-WORLD: Ink navy #0f2a3d rail and text; white "deep water" ground; chart blue tints (#e6f1f7 band, #9cc6dd contour); shoal buff #f1e9d2 for out-of-range; magenta #b0124f reserved for data-trust notes; red/amber only for real alarms. Archivo with tabular numerals, one family. 1px hairlines, 6px radius, no shadows except overlays, no icon tiles.

STORY: Operator opens the overview, reads one "Next" line, scans the reading strip (value, trust note, last seen), checks the chart bands, acts (feed, log TAN, acknowledge alert).

FIRST VIEWPORT: Desktop: 240px navy rail; header with tank name, last reading time, connection; full-width Next line whose items link to the page that resolves them; six-cell reading strip in one row from xl (NH₃ cell added per PRODUCT.md positioning); band charts for series with data, empty series collapsed to one printed line; side panels (feeding, risk model, limitations). Phone: navy top bar + left slide-in drawer (adaptation: 7 destinations plus account and tank context exceed a comfortable bottom sheet; drawer mirrors the desktop rail), Next line, strip as 2-column whole cells, charts stacked.

FORM: Hydrographic chart, position 5 of 7 grounded list. seed:7bcbaf318b348a97. Signature move: guidance range drawn as depth band with dashed contour edges on every time-series chart. Raises: next-action line (wayfinding); whole-cell reflow with fixed furniture (character goods); 1px hairlines and states as printed marks (centre rail); tight scale, rank by weight/case (timetable).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
