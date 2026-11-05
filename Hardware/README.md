# AquaSense hardware firmware

`src/main.cpp` is the active water-monitor firmware. It owns sensor sampling,
validation, LCD updates, connection progress and the main loop. PlatformIO builds
it as the `water-monitor` environment for an ESP32 Dev Module.

## PlatformIO target

From the repository root:

```powershell
pio run -d Hardware
pio run -d Hardware -e water-monitor
pio device list
```

The active target includes `WifiManager` and `MqttManager`. It uses the pinned
libraries in `platformio.ini`. `BackendDeviceClient` remains in the tree but is
not part of this monitor build; sensor readings reach the backend through MQTT.

## MQTT and backend

`WifiManager` reads Wi-Fi credentials from the ignored
`include/secrets/Secrets.h`. `MqttManager` uses the broker, device ID and topic
namespaces in `include/config/DeviceConfig.h`, and signs timestamped telemetry
frames with `Secrets::DEVICE_KEY`. The checked-in public development profile is
configured for `broker.hivemq.com:1883`, namespace `aquasense-dev`, and device
ID `esp32-feeder-1`. These must match the Backend public-dev profile and its
`DEVICE_KEYS` entry. The key itself is never stored in this README.

The firmware starts UTC time synchronization with NTP after Wi-Fi connects.
Public-dev ingestion accepts the signed, timestamped `.../telemetry/frame`
publication; unsigned scalar topics are legacy compatibility output and are
not used as current database readings. A verified frame also supplies the
backend's public-dev device-online signal. This monitor has no actuators, so it
rejects signed actuator commands with `rejected_no_actuators`.

HiveMQ's public endpoint does not encrypt MQTT traffic. HMAC protects frame
integrity and authenticity when the device key matches Backend configuration;
it does not provide confidentiality. Do not publish the device key in source,
logs or screenshots.

## Sensors and wiring

| Hardware | ESP32 GPIO | Firmware behavior |
| --- | ---: | --- |
| pH analog output | 35 | Formula-based estimate; verify coefficients and signal conditioning |
| Turbidity analog output | 34 | Formula-based NTU estimate; validate against reference samples |
| ORP analog output | 32 | ORP mV estimate; this is not dissolved oxygen |
| DS18B20 data | 4 | Temperature via OneWire |
| LCD SDA / SCL | 21 / 22 | 20x4 I2C LCD at address 0x27 |

The pasted ultrasonic sensor code is disabled. Its GPIO25 trigger and GPIO26
echo conflict with the documented aerator and refill relay inputs. Do not
enable it until the sensor is assigned verified free pins and the echo voltage
divider is confirmed. This firmware does not drive relays, pumps, feeder servos
or buzzers.

The conversion coefficients and sensor connection windows are firmware
settings, not proof of calibration. ORP is not a dissolved-oxygen measurement;
the current backend frame does not include an ultrasonic tank-level reading.

## Local configuration

- Keep Wi-Fi credentials, MQTT HMAC key and optional MQTT credentials in the
  ignored `include/secrets/Secrets.h`.
- Register device ID `esp32-feeder-1` in the matching Backend profile.
- Set the same device key in firmware `Secrets::DEVICE_KEY` and Backend
  `DEVICE_KEYS`; the public-dev profile requires at least 32 characters.
- Ensure the device has internet access so it can reach HiveMQ and the NTP
  servers. Frames are not signed or ingested until the system clock is valid.

No firmware upload or physical sensor/relay acceptance is performed by a build.
