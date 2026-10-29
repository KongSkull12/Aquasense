# Backend connection and commissioning

**Active firmware note:** the current `src/main.cpp` is a sensor monitor. It
publishes signed, timestamped telemetry on the public-dev MQTT path and rejects
actuator commands because it has no actuator implementation. The command and
HTTP sync details below describe the broader retained Backend protocol, not
features currently operated by this main firmware.

The integrated `water-monitor` publishes its sensor telemetry on MQTT. Actuator
commands are sent only after authenticated API authorization, then delivered by
signed, device-scoped MQTT. The device publishes a signed acknowledgement and
logical output state. Authenticated HTTPS device sync is used for schedule
delivery and state heartbeat; it does not deliver or acknowledge actuator
commands. In the public development profile, control topics use
`aquasense-control-dev/<deviceId>/command` and
`aquasense-control-dev/<deviceId>/state`, separate from the telemetry namespace.
HiveMQ public MQTT has no ACL or TLS. HMAC authenticates signed payloads but does
not hide them or prevent an observer from replaying a captured, not-yet-processed
command. Use this only on a controlled development network; use a private,
authenticated TLS broker for deployment.

## Connect

1. Register the device to the intended farmer/admin through existing
   POST /api/v1/devices (deviceId, name). Confirm it is active. Match
   DeviceConfig::DEVICE_ID. Only one board may consume that ID.
2. Configure Backend's device key:
   DEVICE_KEYS=esp32-feeder-1:YOUR_RANDOM_DEVICE_KEY.
   Multiple entries are comma-separated deviceId:key pairs; keys cannot contain
   commas or colons. Match ignored Secrets::DEVICE_KEY.
3. Set BACKEND_API_BASE_URL to the server's reachable HTTPS host and actual port,
   ending /api/v1. The committed URL is an invalid placeholder and intentionally
   cannot connect. ESP32 localhost is not the backend computer. Confirm LAN
   binding, firewall access, and that the configured certificate covers this host.
4. HTTPS with certificate verification is the default and requires the trusted
   PEM root certificate in DeviceConfig::BACKEND_ROOT_CA as a C++ raw string.
   Certificate verification is mandatory and needs valid system time. Plain HTTP
   is disabled by default. For isolated local development only, HTTP requires a
   non-release build explicitly compiled with both
   `AQUASENSE_DEVELOPMENT_BUILD` and `AQUASENSE_ALLOW_INSECURE_HTTP`; it is also
   disabled when `NDEBUG` or `AQUASENSE_PRODUCTION_BUILD` is defined. Defining
   the production and insecure-HTTP flags together is a compile error. Do not
   enable this development opt-in for deployment: HTTP exposes the device key.
   If the URL, CA, or transport policy is invalid, backend control remains
   disconnected.
5. The public development profile uses `mqtt://broker.hivemq.com:1883` for
   telemetry and signed feeder control. Keep the namespace settings aligned
   between `Backend/.env.public-dev` and `DeviceConfig.h`. Deployment requires
   private authenticated TLS transport and a separate telemetry-security review.
6. Rebuild/restart Backend using its existing workflow. Startup adds nullable
   sensor_readings.orp and creates hardware_commands/hardware_device_states via
   existing model initialization and non-destructive sync. No live database
   migration or server restart was performed in this task.
7. Build/upload following [deployment](deployment.md). Verify telemetry/state with
   relay loads disconnected from power before commissioning.

## API and MQTT contract

User routes use the existing JWT/session authentication, farmer/admin role and
device ownership checks. Cookie-authenticated POST requests also require the
existing CSRF cookie/header pair.

| Method/topic | Direction | Purpose |
| --- | --- | --- |
| `POST /api/v1/hardware/commands` | Frontend → Backend | Validate and queue water/aerator/buzzer actions |
| `POST /api/v1/feeding/commands` | Frontend → Backend | Validate and queue manual feeder actions |
| `GET /api/v1/hardware/state?deviceId=...` | Frontend → Backend | Read latest device state and command history |
| `POST /api/v1/hardware/device/sync` | Device → Backend HTTPS | Schedule delivery and state heartbeat only |
| `aquasense-control-dev/{deviceId}/command` | Backend → ESP32 MQTT | Signed command, QoS 1, always non-retained |
| `aquasense-control-dev/{deviceId}/state` | ESP32 → Backend MQTT | Signed acknowledgement plus resulting logical state, QoS 1, non-retained |
| Existing `aquasense/...` sensor topics | ESP32 → Backend MQTT | Retained readings and sensor connection state |

Command JSON fields are `v`, `deviceId`, `id` (UUID), `source` (`hardware` or
`feeding`), `action`, `durationMs`, `expiresAt` (UTC epoch milliseconds), and
`signature`. HMAC-SHA256 signs the canonical UTF-8 string:
`v1|deviceId|id|source|action|durationMs|expiresAt`.

State/ack JSON fields are `v`, `deviceId`, `id`, `source`, `action`, `result`,
`reportedAt`, `state`, and `signature`. State contains `fillPump`, `drainPump`,
`aerator`, `feederBusy`, `buzzer`, `automation`, `waterPhase`, `fault`,
`relaysReady`, `timeValid`, `wifiConnected`, `mqttConnected`, and `uptimeMs`.
Backend verifies the signature, registered device, command ID/action/source and
topic device ID before marking a command acknowledged and updating state.

The API returns HTTP 202 with `PENDING` after successful queue/publish. That is
command acceptance, not actuation confirmation. The UI can distinguish pending,
device acknowledgement/rejection and stale/offline state. An `accepted` device
result means accepted by firmware logic; it does not prove electrical relay
operation or water flow. State is the firmware's logical output state.

Backend republishes pending command records every five seconds until an ACK or
expiry. Commands expire after two minutes. Firmware validates HMAC, device ID,
UUID, source/action, expiry and configured RTC/system time; malformed, expired,
unauthenticated or unsupported commands are not actuated. It deduplicates IDs
in non-volatile storage before dispatch. Feeding commands and other one-shot
actions are not retained. The firmware MQTT library callback does not expose the
MQTT RETAIN flag, so non-retained publication, clean-session reconnect behavior,
expiry and durable ID deduplication are the protection layers; a broker-side
retained-command misconfiguration should still be prevented.

## Actions and precedence

| Action | Behavior |
| --- | --- |
| FILL, DRAIN | Timed single-pump run; durationMs required and bounded by that pump's configured target and hard maximum |
| WATER_EXCHANGE | Uses configured drain target, settling interval, then configured fill target; API durationMs remains required for contract compatibility but does not set either phase |
| WATER_STOP | Stop water, disable its automation, cancel pending hardware work |
| AERATOR_ON, AERATOR_OFF | Manual relay operation; exits aerator automatic mode |
| AERATOR_AUTO | Enable commissioned temperature hysteresis |
| AUTOMATION_ON, AUTOMATION_OFF | Enable/disable commissioned water exchange policy |
| BUZZER_ON, BUZZER_OFF | Manual pattern; latched water-fault alarm has priority |
| ALL_OFF | Cancel waiting hardware/feeding work and stop active outputs on receipt |
| CLEAR_FAULT | Clear stopped water fault; does not re-enable automation |

Pump command `durationMs` values are positive integers up to 60,000 ms at the
API and dashboard boundary. FILL and DRAIN also require commissioned
per-pump targets and hard limits; a manual request may shorten its target but
cannot extend it. WATER_EXCHANGE requires `durationMs` for API compatibility,
but firmware uses its independently commissioned drain and fill targets.
Firmware rejects any configured hard maximum above 300,000 ms. These are
software limits, not proof that a runtime is safe for a particular tank.
Stops bypass a full hardware queue, but remote stops depend on network and MQTT
delivery and are not physical emergency stops. ALL_OFF leaves faults latched.

Firmware relay polarity is configured active-LOW from the reported module
intent, but the output commissioning gate remains false pending electrical
verification. The MCU cannot control relay inputs while held in reset, so verify
the module's hardware OFF bias and GPIO-to-channel wiring before connecting pump
power. Loss of Wi-Fi or MQTT stops relay-controlled loads; rejected commands
also force those outputs off.

Automatic water exchange is disabled by default. Set
`DRAIN_TARGET_RUNTIME_MS`, `DRAIN_MAX_RUNTIME_MS`, `FILL_TARGET_RUNTIME_MS`,
`FILL_MAX_RUNTIME_MS`, `WATER_EXCHANGE_SETTLING_MS`, `PUMP_COOLDOWN_MS`,
reviewed thresholds, and `WATER_POLICY_CONFIGURED` only after commissioning.
It requires fresh, valid settled pH, turbidity, and ORP data. ORP is not
dissolved oxygen. Aerator automation is separately configured and uses
temperature only; it must not be interpreted as oxygen measurement.

## Feeding and RTC

There are no float switches: this is **timed water exchange**, not measured or
precise automatic water-level control. Configure these values only after flow
testing on the installed pumps, tubing, head height and source conditions:

- `DRAIN_TARGET_RUNTIME_MS` and `DRAIN_MAX_RUNTIME_MS`
- `FILL_TARGET_RUNTIME_MS` and `FILL_MAX_RUNTIME_MS`
- `WATER_EXCHANGE_SETTLING_MS` and `PUMP_COOLDOWN_MS`

All are milliseconds. Target must be positive and strictly less than its pump's
hard maximum; maximum is limited to five minutes. Defaults are zero, so pump
requests fail closed until commissioning. Fill and drain cannot run together.
Each pump has a local nonblocking hard timeout; timeout turns it off and latches
a fault. Duplicate starts do not restart a running timer. A manual stop cancels
the sequence immediately and starts cooldown. During exchange the reported
phases are `DRAINING`, `SETTLING_AFTER_DRAIN`, `REFILLING`, then `COOLDOWN`.
Local timers continue during network loss; no cloud connection is needed to
enforce pump limits. Fault recovery requires an explicit clear command.

### Fill and drain flow calibration

Calibrate the fill and drain pumps separately using the actual installation;
do not copy pump nameplate flow or use one pump's result for the other.

1. Keep relay loads safely isolated while verifying wiring, then test each pump
   with its installed hose length, vertical head, fittings, and actual water
   source/reservoir conditions.
2. Prepare a measured collection volume for the fill test and a measured source
   volume for the drain test. Confirm the destination can safely accept the
   transferred water.
3. Run one pump for a measured interval, then measure the actual volume moved.
   Repeat each pump test 3–5 times under the same installation conditions.
4. For every trial calculate `flow rate = transferred volume / elapsed time`.
   Use consistent units and select a representative rate only after reviewing
   trial variation; investigate unstable results before commissioning.
5. For the intended exchange volume calculate each pump independently:
   `target runtime = intended volume / that pump's measured flow rate`.
   Use the measured installed fill rate for fill and drain rate for drain.
6. Determine the maximum safe run time from physical hazard limits (such as
   source depletion, overflow, or loss of required water), then set each hard
   maximum above its target but below that hazard duration. The firmware also
   rejects maximum values over 300,000 ms. Never use the maximum as the normal
   target.
7. Record the installation, tested pump, hose/head/source conditions, units,
   each trial's volume and elapsed time, calculated rates, chosen intended
   volume, per-pump target and hard maximum, settling interval, cooldown, date,
   and responsible operator.
8. Enter the separately reviewed values in `DRAIN_TARGET_RUNTIME_MS`,
   `DRAIN_MAX_RUNTIME_MS`, `FILL_TARGET_RUNTIME_MS`, and
   `FILL_MAX_RUNTIME_MS`. Set settling and cooldown only after defining the
   operating procedure. Keep all values at zero until physical calibration and
   safety review are complete.

These timers estimate transferred volume; they do not sense water level or
guarantee an exact final volume. Recalibrate after changing pumps, tubing,
vertical height, fittings, water source, or installation conditions. No
production runtime values are supplied here.

Automatic timed water exchange also requires the commissioned per-pump target
and hard-maximum runtimes, settling and cooldown, meaningful
pH/raw-turbidity/ORP thresholds and
WATER_POLICY_CONFIGURED=true, followed by AUTOMATION_ON. It waits for ten samples
and fresh valid pH/turbidity/ORP, then exchanges on out-of-range data. A valid
manual run interrupts automatic operation and leaves it disabled.

Aerator automation is optional temperature control, not oxygen inference. Set
ON above OFF thresholds and AERATOR_POLICY_CONFIGURED=true before AERATOR_AUTO.
Once enabled it turns on for invalid/stale/unsettled temperature. Manual operation
does not need that policy, but does require confirmed relay configuration.

## Feeding and time

Existing feeding API commands TRIGGER, ON, and OFF are delivered through signed
MQTT; authenticated HTTPS sync supplies schedules and heartbeat state.
GPIO19 servo starts closed at25 degrees, opens to140, and preserves the original
800/1000/800 ms cycle. ON closes after ten seconds. OFF/ALL_OFF suppress scheduled
feeding for the current minute.

Schedules remain the existing **user-wide** list, up to20 enabled entries; they
are not device-scoped. Multiple feeders for one user require a later scheduling
extension. Schedules and last-fired minutes persist in NVS; cached schedules
continue through backend outages. Disable schedules while online and confirm
sync before intentionally suspending offline feeding.

NTP/system time and DS3231 use UTC; dates and HH:mm use Asia/Manila UTC+8.
RTC lost power or unmarked legacy clock contents inhibit schedules until NTP
succeeds. Missed minutes are skipped; stored last-fired records prevent repeats
after resets/backward clock shifts.

## Telemetry scope

The integrated device reports pH, temperature, turbidity and signed ORP under
existing `aquasense/` topics. Turbidity uses the distinct `turbidity-ntu` suffix;
legacy raw ADC remains separate. Invalid/disconnected sensor values are not
fabricated. Existing missing-DO compatibility storage remains explicitly
unmeasured. No physical flow/level feedback, live device upload, database
migration or hardware-in-the-loop test was performed.
