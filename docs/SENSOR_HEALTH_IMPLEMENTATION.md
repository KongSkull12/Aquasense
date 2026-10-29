# AquaSense sensor health and calibration preparation

Implemented on 14 September 2026. The physical ORP/LCD installation uses the **water-monitor** PlatformIO target.

The physical sensors have **not completed formal calibration**. Validation checks whether data appears technically usable; it does **not** prove measurement accuracy. No GPIO assignments, private settings, calibration coefficients, voltage references, or NTU equations were changed.

## Architecture and behavior

1. `SensorManager` acquires the DS18B20 after its conversion wait and takes the existing ten ADC samples per analog channel. It uses `SensorHealth::Validator` before exposing decision values. Temperature, pH, turbidity and ORP have independent diagnostics. The old zero-seeded exponential smoothing is no longer used in this target: temperature is the current conversion, and analog readings retain the existing ten-sample averaging. This avoids startup bias and preserves real changes.
2. `SensorHealth.h` centralizes firmware plausibility, repeated clipping, stability, stuck detection, freshness and freshwater fraction calculation. Existing controllers receive false validity flags and unavailable values on failed checks. The existing timed pump interlocks and fail-safe aeration policy remain active; fail-safe aeration is a safety policy, not a claim about measured oxygen.
3. MQTT sends complete frames even when a sensor fails. It includes original diagnostic values, ADC/voltage, burst minimum/maximum/last sample, clipped sample count, health, stability, per-sensor acquisition age, device identity, sequence and boot identifier. Faults no longer disappear because an entire packet was dropped. Retained MQTT packets are ignored. Duplicate sequence numbers in the same boot cannot refresh acquisition age or train the rolling window.
4. Both HTTP ingestion endpoints and MQTT call `sensorReadingService.ingest`, which uses the same backend `SensorValidator` tested by the terminal suite. Malformed/null sensor fields reach diagnostics without coercion to zero. Per-device rolling windows are bounded. Firmware fault reports can restrict validity but cannot certify calibration.
5. Storage retains diagnostic JSON and nullable measurement columns. Original finite erroneous values, such as -127 C, remain in diagnostics, while the temperature measurement column becomes null. Non-finite/malformed inputs carry a reason rather than a JSON NaN or fabricated zero. Raw ADC is kept as raw ADC.
6. Current reads reevaluate freshness; historical records retain their acquisition-time diagnostics. The newest received record is selected by creation time, so an old acquisition arriving later cannot be hidden behind older healthy records. Statistics exclude unavailable measurements and avoid mixing devices or turbidity units.
7. Rule alerts use eligible physical measurements. A pH of 9.5 can be `VALID`, `Calibration REQUIRED`, and `Water quality CRITICAL`. Raw ADC turbidity cannot trigger NTU alerts. ORP remains mV and never substitutes for dissolved oxygen.
8. Prediction and mortality scoring require usable current temperature, pH, measured oxygen and turbidity expressed in NTU. Missing/invalid/stale dependencies return `INSUFFICIENT_VALID_SENSOR_DATA`, null risk score and `UNAVAILABLE` risk level. Eligible uncalibrated data produces explicitly preliminary analysis. The prior invented ammonia formula and its risk contribution were removed; the remaining original metric weights are normalized proportionally. There are no synthetic sinusoidal risk histories or default 22% scores on the dashboard.
9. Backend health transitions are logged when states change, including transitions to stale on current reads. Firmware prints state changes and detailed bench observations on each acquisition, with a periodic diagnostic refresh if acquisition stalls.

## Health and readiness

Health states: `VALID`, `INVALID`, `SENSOR_ERROR`, `MISSING`, `STALE`, `UNSTABLE`, `SATURATED`, `POSSIBLY_STUCK`.

Stability states: `COLLECTING`, `STABLE`, `UNSTABLE`.

Calibration: `REQUIRED` for all current sensors. Backend types reserve `CALIBRATED` for a future verified calibration workflow; incoming payloads cannot switch sensors to calibrated. No calibration was performed or fabricated.

| Sensor | Technical checks | Measurement unit |
|---|---|---|
| DS18B20 | -127 is a sensor error; finite value; -55 to 125 C capability; acquisition age | C |
| pH | Finite value; 0–14 plausibility; ADC/input voltage validity; repeated clipping | pH |
| Turbidity | Nonnegative; raw ADC must be 0–4095; burst clipping; no invented NTU conversion | raw_adc on water-monitor |
| ORP | Finite mV; -1980 to +1320 mV bounds derived from the existing ADC conversion; ADC clipping | mV |

The ORP bounds reflect the existing uncalibrated circuit formula, not a certified probe specification. An analog open circuit can float to a plausible voltage; this implementation cannot conclusively detect every analog disconnection. A healthy-looking signal still requires bench inspection and formal calibration.

Backend diagnostic policy is in `HEALTH_CONFIG` in `sensorHealth.ts`; firmware uses `SensorHealth.h` and `DeviceConfig::TELEMETRY_MAX_AGE_MS`.

| Diagnostic | Current policy |
|---|---|
| Freshness | 15 seconds, aligned with approximately six-second complete acquisitions |
| Stability | Last 20 eligible samples; at least six samples before declaring stable |
| Backend window age | 150 seconds; long acquisition gaps reset evidence |
| Noisy converted range | Temperature >1 C; pH >0.3; turbidity >150 counts; ORP >50 mV |
| ADC rail bands | 0–8 or 4087–4095 counts |
| Saturation | Three consecutive acquisitions near the same rail, or repeated bursts with at least eight of ten clipped samples |
| Possibly stuck | Ten minutes within one ADC count, or 0.001 converted units when raw ADC is absent |
| TAN age | At most one hour, configurable separately from continuous sensors |

These are diagnostic policies, **not calibration coefficients or scientifically validated noise tolerances**. A rapid real change in water can also produce an unstable window. Stuck detection is deliberately labeled possible; constant water conditions are an alternative explanation. Suspect windows are excluded from current decisions until they recover.

The window exposes sample count, minimum, maximum, average, range and standard deviation. Readiness requires valid, fresh, stable data; analog sensors additionally require available usable ADC diagnostics. A stable signal alone does not prove calibration or accuracy. The ten-minute unchanged warning and the one-hour TAN age limit should be reviewed during bench commissioning.

## Ammonia science and units

AquaSense **does not directly measure ammonia using pH and temperature**. It calculates only the expected unionized NH3 fraction of TAN in freshwater:

```text
pKa = 0.09018 + 2729.92 / (273.2 + temperature_C)
fraction = 1 / (1 + 10^(pKa - pH))
percent = fraction * 100
NH3-N_mg_L_as_N = measured_TAN_mg_L_as_N * fraction
```

The equation is documented in the [EPA freshwater ammonia criterion material](https://semspub.epa.gov/work/01/642199.pdf). The DS18B20 capability limits are documented by [Analog Devices](https://www.analog.com/en/products/ds18b20.html).

The implementation restricts speciation to freshwater and 0–50 C, independently of the wider DS18B20 capability. A non-freshwater `waterType` returns unavailable; salinity correction has not been implemented. The current water-monitor explicitly declares freshwater.

**Actual ammonia concentration requires a valid TAN measurement.** There is no TAN estimate from temperature, pH or turbidity. Without TAN, percent/fraction can be available but concentration is null and displayed as not calculated. Toxicity is never classified from the fraction alone.

TAN must be a finite nonnegative number, with explicit `mg/L as N` units, an accepted source, `validated: true`, and a real measurement timestamp within the configured age limit. Zero TAN is legitimate. TAN remains visible if a source sensor fails, but NH3-N calculation is blocked. TAN is supplied with the reading through the existing authenticated HTTP/device ingestion interface; no new manual-entry screen was added. Reuse must preserve the actual measurement timestamp, not replace it with the current time.

Accepted TAN object shape:

```typescript
{
  value: measuredTan,
  unit: 'mg/L as N',
  source: 'test_kit', // or laboratory, external_sensor, manual
  validated: true,
  timestamp: actualMeasurementTimeISO
}
```

The legacy API/storage property `ammonia` now contains only calculated **NH3-N in mg/L as N**, or null. Old ammonia values without provenance are not treated as measured TAN. The explicit result is `speciation.nh3N` and `speciation.concentrationUnit`. No molecular-mass conversion is made. The old generic ppm ammonia thresholds are not reused as NH3-N thresholds; ammonia toxicity alerts require a separately commissioned policy with explicit units.

Actual deterministic test result (software reference, **not a physical observation**):

```text
Input: 25 C; pH 8; TAN 1 mg/L as N
pKa: 9.244841301140175
NH3 fraction: 0.053842138526288115
NH3 percentage: 5.384213852628812%
NH3-N: 0.053842138526288115 mg/L as N
PASS
```

Without the TAN input, the same fraction is available and `nh3N` is null. Higher pH and higher temperature trend tests also pass.

## Serial Monitor, LCD and dashboard

`water-monitor` prints `AQUASENSE SENSOR HEALTH` with each sensor's diagnostic value, raw ADC mean, nominal input voltage, burst statistics, timestamp/age, health, validity, stability, calibration requirement, window statistics, reason, unchanged duration and readiness. It then prints freshwater speciation, or the unavailable reason, followed by communication/readiness summaries. The firmware has no TAN input source, so its local output always states TAN unavailable and actual concentration not calculated. Backend-supplied TAN is displayed in the dashboard only.

The 16x2 LCD preserves normal temperature/pH and turbidity/ORP displays. On faults it rotates concise sensor messages such as `TEMP SENSOR ERR`, `PH INVALID` or `ORP STALE`, followed by `CHECK SENSOR` or `NO NEW DATA`. Existing actuator fault messages retain priority.

Overview and Parameters have a compact four-sensor health panel and expandable raw diagnostics. The panels distinguish water condition, signal health and calibration. The ammonia card shows **Unionized NH3 fraction of TAN**, TAN availability and actual NH3-N only when calculable. Freshness expires locally even during a connection failure and is checked per sensor, not just per enclosing packet. The existing layout and unrelated pages were retained.

## Run and bench procedure

From the repository root:

```powershell
npm.cmd run test:sensors --prefix Backend
npm.cmd run test:sensors --prefix Frontend
npm.cmd run build --prefix Backend
npm.cmd run build --prefix Frontend
pio run -d Hardware -e water-monitor
pio run -d Hardware -e sensor-validation
pio device list
```

For actual observation, connect the board and upload **water-monitor** to the intended device, then open its port at 115200 baud:

```powershell
pio run -d Hardware -e water-monitor -t upload --upload-port COMx
pio device monitor -d Hardware -e water-monitor --port COMx --baud 115200
```

Replace COMx with the enumerated ESP32 port. Wait for at least six completed acquisitions; inspect the longer 20-sample window before calibration. Compare raw voltage and readings against the physical setup. Disconnect a probe during a controlled bench test, then reconnect it and inspect recovery. Observe the LCD locally. Do not use this procedure to invent offsets or slopes.

`sensor-validation` is an **isolated test firmware image** using the same C++ validation functions as production; it prints Input/Expected/Actual/PASS/FAIL. It starts no Wi-Fi, MQTT, sensors or actuators. Uploading it replaces the normal firmware, so restore `water-monitor` after test-mode use. No test image was uploaded during this work.

Restart the backend when adopting these changes so its existing schema-compatibility routine adds the diagnostic JSON/unit columns and makes unavailable measurement columns nullable. Existing data is retained. Live database migration was not exercised here; ingestion tests mock the database boundary.

## Verification results

| Check | Result |
|---|---|
| Backend sensor validation/speciation/ingestion tests | PASS: 51 tests |
| Existing hardware-control and SMS regression tests | PASS: 42 tests; provider calls mocked |
| Frontend production component rendering/freshness tests | PASS: six tests |
| Backend TypeScript/build | PASS |
| Frontend TypeScript/Vite build | PASS; bundle-size warning remains |
| PlatformIO water-monitor build | PASS |
| PlatformIO sensor-validation build | PASS |
| Physical device enumeration | Successful; no serial devices reported |
| Physical sensor readings and Serial Monitor capture | NOT OBSERVED: no connected serial device |
| LCD physical behavior | NOT OBSERVED: no connected device |
| Firmware validation test execution on ESP32 | NOT RUN: test image built, no board available |
| Live database migration and full browser/device session | NOT RUN; integration/rendering tested without production data |

The firmware build also reports existing OneWire library preprocessor warnings. No physical readings are claimed and no calibration occurred.

## File inventory for this implementation

Created:

- `Backend/src/services/sensorHealth.ts`
- `Backend/src/services/sensorHealth.test.ts`
- `Backend/src/services/sensorIngestion.test.ts`
- `Hardware/src/sensors/SensorHealth.h`
- `Hardware/src/validation/main.cpp`
- `Frontend/src/components/WaterQuality/SensorHealthPanel.tsx`
- `Frontend/src/components/WaterQuality/sensorDisplay.ts`
- `Frontend/src/types/sensorHealth.ts`
- `Frontend/test/sensor-health.test.cjs`
- `docs/SENSOR_HEALTH_IMPLEMENTATION.md`

Modified:

- `Hardware/platformio.ini`
- `Hardware/include/models/SensorReadings.h`
- `Hardware/src/main.cpp`
- `Hardware/src/sensors/SensorManager.h` and `SensorManager.cpp`
- `Hardware/src/communication/MqttManager.h` and `MqttManager.cpp`
- `Hardware/src/display/LcdManager.cpp`
- `Backend/package.json`
- `Backend/src/database/models/SensorReading.ts` and `index.ts`
- `Backend/src/api/v1/controllers/sensorsController.ts`
- `Backend/src/iot/water/controllers/waterController.ts`
- `Backend/src/iot/water/services/waterQualityService.ts`
- `Backend/src/iot/water/types.ts`
- `Backend/src/iot/water/websocket/waterWebSocket.ts` (removed synthetic production readings)
- `Backend/src/middleware/validate.ts`
- `Backend/src/services/sensorReadingService.ts`, `sensorValues.ts`, `mqttService.ts`
- `Backend/src/services/predictiveAnalytics.service.ts`, `ruleEngine.service.ts`, `waterAlertNotification.service.ts`
- `Backend/src/services/hardware.test.ts` and `sms.delivery.test.ts` (updated persistence-boundary mocks)
- `Backend/src/websocket/waterQualityWS.ts`
- `Frontend/package.json`
- `Frontend/src/types/water.ts`
- `Frontend/src/components/WaterQuality/Dashboard.tsx` (nullable compatibility)
- `Frontend/src/components/WaterQuality/useDashboardData.ts`
- `Frontend/src/pages/dashboard/DashboardOverviewPage.tsx` and `DashboardParametersPage.tsx`

The workspace already contained unrelated edits before this task. They were preserved. Private `.env`, Wi-Fi/SMS credentials and private sensor secrets were not read, changed or committed. Builds generated their normal output artifacts.

## Remaining limits

- Full physical acceptance remains necessary, including LCD and actual Serial observations. Builds and software tests cannot verify wiring, probe condition or calibration accuracy.
- Only the modular `water-monitor` target has the full new firmware diagnostics. Older standalone targets retain their separate sensor/wiring assumptions. Legacy numeric MQTT topics lack full device/frame provenance and raw ADC metadata; use the modular frame protocol for calibration work.
- Formal calibration, empirical noise-limit tuning, validated NTU conversion, an ammonia toxicity policy with explicit NH3-N units, and saline-water correction are future work.
- The current four physical sensors do not include dissolved oxygen or ammonia. ORP is not DO. Consequently the existing mortality model is intentionally unavailable with this four-sensor raw-turbidity configuration.
- Source calibration remains required even when mathematical ammonia speciation is available. TAN provenance and validation must come from a real measurement procedure; API shape validation does not certify laboratory accuracy.
- The browser tests render the actual components and exercise source freshness, but do not substitute for visual acceptance of the running dashboard at the farm.
