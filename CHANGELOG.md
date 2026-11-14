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

## [1.9.1] - 2026-11-12

### Fixed
- Firmware: pH, ORP and turbidity captures no longer refuse a settled probe because of a single
  ESP32 ADC spike. A capture is now steady when the first and last second agree within the limit
  and the noise (standard deviation) is below it; the Serial Monitor prints both values.

### Upgrade notes
- Flash the new firmware. If pH reads far off in a known buffer (e.g. negative in 6.86), press
  Reset to default on the pH card first, then capture 6.86, 4.01 and 9.18.

## [1.9.8] - 2026-11-14

### Changed
- SMS default provider is now **MensaheKo**. Set `SMS_PROVIDER=mensaheko` and `MENSAHEKO_API_KEY`
  (blast: `POST /api/v1/blast` with `X-Api-Key`). Philippine numbers are sent as `09XXXXXXXXX`.
  IPROG, Semaphore and UniSMS remain available when `SMS_PROVIDER` is set accordingly.

## [1.9.7] - 2026-11-14

### Fixed
- IPROG SMS: Smart/TNT/Sun numbers are now reported as **rejected** with a clear sender-name
  message instead of a vague “unknown” status. Globe/DITO sends poll status once so the test
  page can show Sent when IPROG has completed delivery.

## [1.9.6] - 2026-11-13

### Changed
- Automatic SMS now covers **WARNING** as well as CRITICAL and EMERGENCY for each water-quality
  sensor rule (temperature, pH, turbidity, dissolved oxygen). Each sensor category has its own
  cooldown so one parameter does not block texts for another.

## [1.9.5] - 2026-11-13

### Changed
- SMS default provider is now **IPROG SMS**. Set `SMS_PROVIDER=iprogsms` and `IPROG_SMS_API_TOKEN`
  (token from https://www.iprogsms.com/account/token). Optional `IPROG_SMS_NETWORK_PROVIDER=2` for
  broad Philippine network coverage. Alerts, test SMS, message log and pending-status checks use
  IPROG’s `/sms_messages` and `/sms_messages/status` APIs. Semaphore and UniSMS remain available
  when `SMS_PROVIDER` is set to `semaphore` or `unisms`.

## [1.9.0] - 2026-11-11

### Added
- Semaphore SMS provider. Set `SMS_PROVIDER=semaphore` and `SEMAPHORE_API_KEY` on the backend
  (optionally `SEMAPHORE_SENDER_NAME`; blank uses the account's default approved sender name).
  Alerts, the test SMS, the message log and pending-status checks work the same as with UniSMS.
  Numbers are sent as `63XXXXXXXXXX`; non-Philippine numbers and messages starting with the word
  TEST (which Semaphore drops) are refused before sending. Invalid key or sender name errors are
  explained on the SMS alerts page.

### Changed
- The SMS alerts page shows which provider is active and only shows the Unisoft network warning
  when UniSMS is in use. `GET/PUT /api/v1/sms/recipients` now include `provider`.

### Fixed
- pH could not be calibrated from the dashboard: the Calibration page still marked pH as
  "Serial Monitor only" although the firmware and backend accept `CAL_CAPTURE ph:<buffer>`.
  The pH card now has the 6.86 / 4.01 / 9.18 buttons and Capture, Read, Clear and Reset, and
  shows progress until the third buffer saves the fit. Overview links to it instead of Serial.
- Relay pins confirmed on the board: aerator GPIO25, fill GPIO26, drain GPIO27 (pressing each
  button showed which load it switched). A test build with fill/drain/aerator on 25/26/27
  switched the wrong loads and was not released.

### Upgrade notes
- UniSMS stays the default; nothing changes until `SMS_PROVIDER=semaphore` is set on Render.
- Flash the new firmware (app-only `.ino.bin`) with the pumps and aerator unplugged, then check
  each relay with `relay test`.

## [1.8.0] - 2026-11-11

### Added
- Staff accounts can control the aerator: the Aerator page is in their menu and the server
  accepts `AERATOR_ON`, `AERATOR_OFF` and `AERATOR_AUTO` from them. Automatic water exchange,
  thresholds, calibration, SMS and settings stay owner-only; viewers are unchanged.

## [1.7.0] - 2026-11-11

### Added
- Viewer accounts: a farm owner creates read-only sign-ins from Settings → Staff and viewer
  accounts (choose **Viewer**). A viewer sees only Overview, Parameters and Alerts & logs for the
  owner's tank, live updates included. Every feed, pump, aerator, threshold, calibration, alert
  action and settings route rejects them on the server, not only in the menu. Viewers are stored
  as the existing `guest` role, so no database migration is needed.

### Changed
- Farmer accounts can now create and remove staff and viewer accounts, not only admins.
  `POST /api/v1/staff` takes an optional `access: "staff" | "viewer"` (default `staff`).
- Viewers and staff can read TAN measurements; viewers can read the feeding schedule list.

## [1.6.0] - 2026-11-11

### Added
- Automatic low-water fill: with automatic exchange on, a water depth that stays below the
  Thresholds normal range for about 1 minute (Warning or Alert) is filled to the calibrated
  target depth, at most every 30 min, and never drained. It runs before any water-quality
  exchange, so a pH or turbidity exchange is no longer blocked by a tank that is already low.

### Changed
- Automatic exchange can be turned on with only the tank depth calibrated (empty + target).
  The partial exchange still needs `exchange volume|drain|fill`; without it only the
  low-water fill runs.
- Water change page: the policy table shows the low-water step; Calibration and device-result
  texts describe the automatic fill.

### Upgrade notes
- Flash the new firmware (app-only `.ino.bin`), then turn automatic exchange on from the Water
  change page. Relay pins are unchanged (aerator 25, fill 26, drain 27).

## [1.5.1] - 2026-11-11

### Fixed
- Feeder servo moved during the boot self-test but not for dashboard buttons. The servo channel
  is now attached once and kept, with pulses paused between moves instead of detaching, so every
  move uses the same path as the self-test. Wi-Fi transmit power is lowered while the horn moves
  (the self-test runs before Wi-Fi starts) and restored afterwards. Each move is logged in the
  Serial Monitor with its pulse width.

### Upgrade notes
- Flash the new firmware (app-only `.ino.bin`). If the servo still does not move with Wi-Fi on,
  power it from its own 5 V 2 A+ supply with a shared GND and a 470–1000 µF 16 V capacitor.

## [1.5.0] - 2026-11-11

### Added
- Water alarm buzzer: an Alert plays 3 beeps on repeat and a Warning 2 beeps on repeat until
  every trusted reading is normal again. It uses the dashboard Thresholds, which the backend now
  sends in the hardware sync reply; the board keeps the last copy so it works offline. Serial
  Monitor: `alarm`, `alarm off|on`.
- Automatic partial water exchange by water condition: Normal 0%, Warning 5% (at most every 6 h),
  Critical 10% (at most every 2 h) with the aerator held on until the water recovers; the backend
  SMS covers Critical. Never more than 30% in 24 h, never drains when depth is already low, and
  pumps start only while online. Set the tank volume and measured pump flows with
  `exchange volume|drain|fill`. Water change page: on/off control and the policy table.
- DFRobot SEN0189 turbidity sensor support (manufacturer curve, one- or two-point correction).
- Simpler Thresholds page: normal range first, alert limits behind "Change alert limits",
  recommended values and inline validation.

### Changed
- Feeder commands (Feed now, Feeder on/off) are dropped within 1 minute when the device is off:
  they expire after 60 s instead of 120 s, the backend cancels pending ones as soon as the device
  stops reporting, and the firmware refuses any feed command sent before its last power-up.
- pH uses Serial Monitor buffer calibration (`ph 4.01|6.86|9.18`) with trimmed ADC averaging.
- Automatic exchange stays on across restarts, network drops and manual pump runs; Stop pumps,
  All off or a fault turn it off.

### Fixed
- Sensor calibration: recapturing the same reference, out-of-range readings counted as usable,
  and divider hints in `status`.
- SMS: an unconfirmed test no longer blocks later tests (retry after 60 s, or 5 min if uncertain).
- Provisional pH is published while calibration is pending; probe sensors are typed separately
  from tank calibration on the Calibration page.

### Upgrade notes
- Flash the new firmware (app-only `.ino.bin`). The SEN0189 change clears only the old turbidity
  calibration: capture clear water as 0 NTU afterwards. Set `exchange volume|drain|fill` before
  turning on automatic exchange.

## [1.4.0] - 2026-11-03

### Added
- Optional temperature calibration (Dashboard → Calibration → Temperature). Capture what a trusted
  thermometer reads in the same water: one point corrects the offset, a second point at least
  5 °C away also fits the slope. The DS18B20 stays counted as calibrated without it, so readings
  and the ammonia calculator work whether or not it is done.
- Calibration commands accept `temp` (`CAL_CAPTURE temp:<°C>`, `CAL_STATUS`/`CAL_CLEAR`/`CAL_RESET temp`).
- Firmware: the temperature correction is applied to the DS18B20 reading and saved under its own
  flash key `calT`, leaving the pH, ORP and turbidity calibration untouched. A capture averages
  5 conversions and is refused if they spread more than 0.25 °C; slopes outside 0.8–1.25 are
  rejected. Serial Monitor: `temp <°C>`, `clear temp`, `reset temp`, `set temp <slope> <offset>`.

### Upgrade notes
- Flash the new firmware (app-only `.ino.bin`) to use temperature calibration. Older firmware
  answers `temp` commands with `rejected_bad_param`.

## [1.3.1] - 2026-11-03

### Fixed
- Firmware update page: flashing stopped right after the chip was detected with "Failed to
  fetch dynamically imported module …/stub_flasher/esp32.json". Vite left esptool-js's flasher
  stubs unbundled; the build now bundles them as small per-chip chunks.
- Firmware: the sketch did not compile in v1.3.0 (`'FeederStep' was not declared`). The new
  `turbidityFromVoltage()` sat above the shared types, where the Arduino builder inserts its
  function prototypes; it now lives in the SENSORS section.

## [1.3.0] - 2026-11-03

### Added
- Firmware update page (Dashboard → Firmware update) that flashes the ESP32 over USB from Chrome
  or Edge, without the Arduino IDE. It recognizes app-only (`.ino.bin`, written at `0x10000`) and
  full merged images (`.ino.merged.bin`, written at `0x0`), refuses bootloader, partition-table
  and wrong-chip files, verifies the written data by MD5, and restarts the board. The file stays
  in the browser and is never uploaded. Uses Espressif's `esptool-js` 0.7.0, loaded only on Connect.
- Staff accounts: an admin creates staff logins (`GET/POST /api/v1/staff`,
  `DELETE /api/v1/staff/:id`) that share the admin's tank devices. Staff see Overview, Parameters,
  Feeding, Water change and Alerts only. Device access for readings, alerts, commands and the
  live socket goes through one shared check (`deviceAccess.ts`).

### Changed
- Firmware: "Feeder on" holds the gate open until "Feeder off", with a 60 s safety close; the servo
  signal switches off once the horn arrives, so it stops buzzing.
- Firmware: turbidity uses the DFRobot SEN0189 voltage curve with a gain and offset calibration,
  and pH accepts a one- or two-buffer calibration.
- Firmware: an `https://` `BACKEND_HTTP_URL` (such as Render) is verified against the root
  certificates in `RootCerts.h`; plain LAN calls time out after 3 s instead of stalling MQTT.

### Upgrade notes
- Calibration is now saved under the flash key `cal2`. pH and ORP calibration carry over, but
  turbidity resets to defaults on first boot, so recalibrate it (`turb 0`, then a known standard).

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
