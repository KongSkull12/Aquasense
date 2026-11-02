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

## [1.2.0] - 2026-11-02

### Added
- Ammonia calculator page (Dashboard → Ammonia calculator) that walks through all seven steps:
  sensor temperature and pH (live or entered manually), pKa, NH₃ fraction, NH₃ percentage, the
  ammonia measurement, the resulting concentrations, and a results summary.
- Option B: a measured NH₃-N gives TAN = NH₃-N / fNH₃. Option A (NH₃-N = TAN × fNH₃) is also
  available in the calculator.
- `POST /api/v1/water/ammonia/calculate` with `temperature`, `ph` and optionally `tan` or `nh3N`
  (mg/L as N).

### Changed
- pKa now uses T + 273.15 (was 273.2), matching the documented formula
  pKa = 0.09018 + 2729.92 / (T + 273.15). At 25 °C, pKa moves from 9.2448 to 9.2464.
- Live speciation and the calculator share one implementation (`ammoniaCalculator.ts`).

## [1.1.3] - 2026-11-02

### Fixed
- Sign-in failed with "CSRF token validation failed" when the browser still had an older
  session cookie. Sign-in and sign-up no longer require the CSRF token (they start a new
  session), and the dashboard fetches a fresh token and retries once after a CSRF rejection.

## [1.1.2] - 2026-11-02

### Added
- `/health` reports `mqtt.lastPublicFrameRejectedReason` (`no_device_key`, `bad_signature` or
  `invalid_frame`) and the backend logs a warning when ESP32 frames are dropped. A
  `bad_signature` means `DEVICE_KEYS` on the server does not match `DEVICE_KEY` in the firmware.

## [1.1.1] - 2026-11-02

### Fixed
- Logout, saving SMS numbers, feeding schedules, relays, calibration and thresholds failed with
  "CSRF token validation failed" when the frontend and backend are on different domains
  (Vercel + Render). The backend now also returns the CSRF token from login, signup and
  session checks, and the dashboard sends it from there.
- Logout always returns to the sign-in page, even if the server cannot be reached.
- Dashboards stopped refreshing after ~10-15 minutes because polling exceeded the API rate
  limit (500 per 15 min). The limit is now 3000, configurable with `API_RATE_LIMIT_MAX`.
- Sidebar showed "Signed in" instead of the account after a failed request cleared it.

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
