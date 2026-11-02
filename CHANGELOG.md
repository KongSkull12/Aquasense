# Changelog

All notable changes to AquaSense. Versions follow [Semantic Versioning](https://semver.org/):
MAJOR for breaking API or firmware-protocol changes, MINOR for new features, PATCH for fixes.

The running version is shown in the dashboard sidebar (App = frontend, API = backend) and in
`GET /health` and `GET /api/v1/health` under `data.release`.

## How to release

1. Add the changes under a new version heading below.
2. Set the same `version` in `Frontend/package.json` and `Backend/package.json`.
3. Commit, tag and push: `git tag vX.Y.Z && git push kongskull main --tags`.
   Vercel and Render redeploy `main` automatically.

## [1.1.0] - 2026-11-02

### Added
- Calibration page for pH, turbidity and ORP from the dashboard.
- Thresholds, Prediction model and SMS alerts pages.
- Risk scoring service and risk assessment panel.
- SMS recipient settings per user.
- Release version and commit shown in the dashboard sidebar and health endpoints.
- `Frontend/vercel.json` so dashboard routes survive a page refresh.

### Fixed
- Startup on an empty database (schema upgrades no longer run before tables exist).

## [1.0.0] - 2026-10-25

- First deployed version: water-quality monitoring, sensor health, feeding schedules,
  aerator and water-change control, SMS alerts.
