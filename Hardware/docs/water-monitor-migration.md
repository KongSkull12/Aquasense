# Integrated Arduino migration

The sanitized supplied sketch remains in reference/arduino-water-monitor/ outside
source filters. Earlier standalone targets retain their original behavior.
The integrated target follows the requested layout with a system coordinator
and a combined backend client instead of separate hardware/feeding HTTP workers.

## Ownership

| Responsibility | Owner |
| --- | --- |
| GPIO assignments | include/config/Pins.h |
| Conversion and smoothing | CalibrationConfig.h, SensorConversions.h |
| Polarity, run limits, policy gates | ActuatorConfig.h |
| Plausibility and automation limits | Thresholds.h |
| Network identity, timing, API URL and CA | DeviceConfig.h |
| Credentials | Ignored include/secrets/Secrets.h |
| Completed acquisition and validity | SensorReadings.h, SensorManager |
| Reported output/clock/connectivity state | SystemState.h |
| Typed commands and schedules | Command.h, FeedingSchedule.h |
| Relay writes and fill/drain interlock | RelayController |
| Timed drain/refill, cooldown and fault latch | WaterManager |
| Manual and optional temperature-based aeration | AeratorManager |
| Servo motion and durable schedules | FeedingManager |
| Passive buzzer pattern | BuzzerManager |
| Command expiry, deduplication and dispatch | SystemController |
| WiFi retry | WifiManager |
| Retained per-sensor MQTT worker | MqttManager |
| Authenticated schedule/state heartbeat worker | BackendDeviceClient |
| Signed MQTT actuator command and acknowledgement worker | MqttManager |
| Display only | LcdManager |
| NTP, DS3231 UTC storage and UTC+8 presentation | TimeManager |
| Composition/update scheduling | src/main.cpp |

## Wiring

| Signal | GPIO/address |
| --- | --- |
| pH analog | 35 |
| Turbidity analog | 34 |
| ORP analog | 32 |
| DS18B20 data | 4 |
| I2C SDA / SCL | 21 / 22 |
| LCD | 0x27, 20x4 (current monitor code; earlier diagram labels 16x2) |
| RTC | DS3231 |
| Integrated servo | GPIO18 |
| Passive buzzer | GPIO19 |
| Relay K3 / refill | GPIO26 |
| Relay K4 / drain | GPIO27 |
| Relay K2 / aerator | GPIO25 |
| Relay IN4 | GPIO33 (unused) |

Loads connect to relay output terminals; ESP32 signals control module inputs only.
The module has a separate 5 V supply and common ground. The K2/K3/K4 mapping above
is user-confirmed, not independently measured. Firmware is configured active-LOW,
and its separate output gate remains false pending physical trigger and OFF-state
measurements. The user removed float switches; no float logic exists.

## Behavior changes

- Sensor, servo and control updates use elapsed time. MQTT and HTTP(S) execute
  in separate workers. Bounded queues pass copies; main owns outputs/I2C.
- Twelve-sample ADC windows use per-sensor connection bounds and a peak-to-peak
  stability limit. Each sensor has an independent connection/disconnection
  debounce counter; a missing DS18B20 can be detected after it is reattached.
- pH uses the supplied voltage slope/offset, ORP uses the supplied mV slope/offset,
  and turbidity uses the supplied clear/dirty ADC points to produce NTU. Invalid
  or disconnected readings are sent as `DISCONNECTED`; connection status is also
  retained on each sensor's `/status` topic.
- MQTT publishes retained parameter topics under `aquasense/`, including the
  configured `device-id` so Backend associates readings with the registered
  board. Converted turbidity uses `aquasense/turbidity-ntu` to keep it distinct
  from legacy raw ADC on `aquasense/turbidity`. ORP remains signed mV; no DO
  value is produced.
- Backend persists signed nullable ORP and returns it in readings/statistics and
  realtime data. Missing/historical ORP never becomes a fabricated zero.
- NTP writes verified UTC to DS3231. Only RTC contents marked with this convention
  and without lost-power status can seed time after reboot. No build-date clock.
- Servo retains 25/140 degrees and 800/1000/800 ms cycling. Indefinite ON is capped
  at ten seconds. NVS records commands/scheduled feeds before actuator movement.
- LCD shows startup/connection progress followed by sensor readings only; there
  is no rotating output-status page.
- Buzzer output is forced OFF during initialization and responds only to fresh,
  valid readings outside configured alarm bounds. Alarm thresholds are disabled
  until commissioned.

The supplied calibration values have not been physically verified on hardware.
Compare each channel against reference solutions and the installed voltage
dividers/front ends before unattended use. ORP is not a dissolved-oxygen
measurement. Relay pin mapping in source follows the wiring diagram, but the
physical K3/K4 assignment is unresolved. Active-LOW polarity is configured in
software; the separate commissioning gate and zero pump timing values keep relay
starts disabled pending electrical verification. Water automation gates remain
unchanged.

## Runtime limits

Network stalls do not wait inside pump/servo updates. Library calls and NVS still
take finite time; this cooperative design is not a hard-real-time safety system.
Timers cannot detect overflow, dry running, stuck relays, actual flow or a stalled
processor. Reported state reflects commanded outputs, not electrical feedback.

See [backend commissioning](backend-control.md) and [verification](../test/README.md).
Compilation and mocked tests do not establish physical operation. No board was
uploaded or live database migrated during this work.
