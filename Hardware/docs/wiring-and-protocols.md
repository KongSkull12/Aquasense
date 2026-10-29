# Wiring and existing contracts

The active `src/main.cpp` build is monitor-only: it samples pH, temperature,
turbidity and ORP and sends signed public-dev telemetry through `MqttManager`.
It does not drive relays, pumps, a feeder or a buzzer; signed actuator commands
are explicitly rejected. Its ultrasonic code is disabled because the pasted
GPIO25/GPIO26 assignments conflict with the documented aerator/refill relays.

## Modular water-monitor target

The integrated target uses pH GPIO35, turbidity GPIO34, ORP GPIO32, DS18B20
GPIO4 and shared I2C SDA/SCL GPIO21/22. The current monitor source is configured
for a 20x4 LCD at address 0x27, as in the attached code. The earlier wiring
diagram labels a 16x2 LCD; verify the physical panel before deployment. Both use
the same I2C wiring, but only four-row hardware can show the full sensor page.
The user-confirmed installed wiring sets the integrated servo to GPIO18 and
passive buzzer to GPIO19. The legacy standalone feeder uses GPIO13.

The user reports relay K3 refill on GPIO26, K4 drain on GPIO27, and K2 aerator
on GPIO25; GPIO33 is unused. This is a reported wiring mapping, not an independent
electrical measurement. Relay outputs remain disabled until channel mapping,
trigger polarity, and safe OFF behavior are physically commissioned.
Firmware polarity is configured active-LOW from the reported intent, while the
output commissioning gate remains false. Measure the actual board trigger level,
channel continuity, and safe OFF behavior before enabling outputs. The relay
module has a separate 5 V supply and shares ground with ESP32. Verify its input
bias holds the relay OFF while ESP32 GPIOs are high-impedance during reset;
firmware cannot drive outputs during reset. There are no float switches.

The current `water-monitor` source targets public HiveMQ at
`broker.hivemq.com:1883`. It publishes non-retained scalar readings under
`aquasense-dev/devices/<device-id>/telemetry/<sensor>` and status siblings under
`.../<sensor>/status`. The backend `public-dev` profile subscribes only to the
single-level telemetry wildcard, so it receives reading values and ignores the
status siblings. MQTT credentials are not sent over the unencrypted connection.
Public topic names are routing labels, not authentication. These are source
settings and must be flashed before the board uses them. See
[backend/control setup](backend-control.md) for the authenticated device protocol
and commissioning.

## Preserved earlier targets

All pin numbers below are GPIO numbers. They preserve the original code's values.
Check the actual circuit and board pin labels before flashing.

| Signal | Feeder | Four-sensor water | Three-sensor legacy |
| --- | --- | --- | --- |
| Servo signal | 13 | — | — |
| DS18B20 data | — | 4 | 4 |
| pH analog input | — | 34 | 35 |
| Dissolved oxygen analog input | — | 35 | Not installed |
| Turbidity analog input | — | 36 | 34 |

Use an appropriate servo supply with common ground. Keep sensor analog outputs
within the board's permitted input voltage; a 5 V powered sensor module may need
signal conditioning. Check the DS18B20 module's pull-up requirements. Confirm
sensor-specific wiring against its manufacturer's documentation.

## Feeder

- Local configuration: WiFi, `API_BASE_URL`, `DEVICE_ID`, `DEVICE_KEY`.
- POST `<API_BASE_URL>/feeding/device/sync` with `{ "deviceId": "..." }`.
- POST `<API_BASE_URL>/feeding/device/ack` with `deviceId`, `commandId`, `result`.
- Both requests carry `x-device-key`; match the existing backend device setup.
- Response uses `data.schedules` and `data.pendingCommand`; actions are `TRIGGER`,
  `ON`, and `OFF`.
- Sync interval is 30 seconds; schedules use Philippines UTC+8 time from NTP.
- The original cycle is 25 degrees / 800 ms, 140 degrees / 1000 ms, then
  25 degrees / 800 ms. Startup sets the servo to the off position.

## Preserved water-quality JSON target

Default broker is `broker.hivemq.com:1883`. Configuration retains:

- Readings: `capstone2026/water/esp32/readings`.
- Status: `capstone2026/water/esp32/status`.
- JSON includes `temperature`, `ph`, `turbidity`, `turbidityUnit`, device/frame
  identity and sensor diagnostics. It does not publish a DO measurement.

This target is isolated from the modular water-monitor. It subscribes to no
command topics. It reports pH as null and includes raw pH ADC only as a
diagnostic; turbidity is explicitly `raw_adc`. Temperature reports null when
the DS18B20 is disconnected. The current sketch does not acquire DO or apply a
calibration conversion to pH or turbidity.

The backend's default JSON subscription is `water/esp32/readings`; configure
`MQTT_TOPIC_READINGS` to match this target's actual topic and use the same broker.
The modular `water-monitor` target publishes per-sensor values under the
device-scoped `aquasense-dev/devices/<device-id>/telemetry/` path and uses the
configured device ID as its MQTT client ID. In the public development profile,
the feeder subscribes to `aquasense-control-dev/<device-id>/command` and
publishes signed acknowledgements to `aquasense-control-dev/<device-id>/state`.
Commands and acknowledgements use the per-device HMAC key, short expiry, unique
command ID, and firmware replay checks. HiveMQ's public broker has no ACL or TLS,
so this mode is for controlled development only; use a private authenticated TLS
broker for production. Its `DEVICE_ID` must match the backend profile. The
three-sensor target described below retains its older,
separate `aquasense/` topic contract.

## Three-sensor MQTT

Default broker is `broker.hivemq.com:1883`; topics are configurable in the local
header and default to `aquasense/temperature`, `aquasense/ph`, and
`aquasense/turbidity`. Each payload is a numeric string. The existing backend has
an `aquasense/+` ingestion path. Broker settings still must match.

Temperature is smoothed, pH uses the original voltage estimate, and turbidity is
a smoothed **raw ADC value**, not calibrated NTU. No dissolved-oxygen value is
published by this firmware. Keep these semantics in mind when selecting it.

Assign a unique MQTT client ID to every simultaneous board connection. Keep topic
names aligned with the existing backend subscriptions; adding multiple tanks also
requires a deliberate backend routing/data-model design beyond this migration.
