# AquaSense ESP32 firmware (Arduino IDE)

One sketch that connects the ESP32 to every part of AquaSense: live readings, the
Feeding, Water change and Aerator pages, feeding schedules, and the LCD.

## Wiring

| Part | ESP32 GPIO |
| --- | ---: |
| pH analog | 35 |
| Turbidity analog | 34 |
| ORP analog | 32 |
| DS18B20 data | 4 |
| Ultrasonic TRIG / ECHO (echo through a 5 V → 3.3 V divider) | 14 / 13 |
| LCD 20x4 I2C SDA / SCL (address 0x27) | 21 / 22 |
| Aerator relay | 25 |
| Fill pump relay | 26 |
| Drain pump relay | 27 |
| Feeder servo signal | 18 |
| Buzzer | 19 |

## 1. Backend

The firmware talks to the backend's **public-dev** profile (HiveMQ, signed MQTT):

```powershell
cd Backend;  npm run dev:public-dev
cd Frontend; npm run dev:public-dev
```

In `Backend/.env.public-dev`:

- `DEVICE_KEYS=esp32-feeder-1:<key of at least 32 characters>`. The same key goes in `Secrets.h`.
- For feeding schedules and the state heartbeat, also add `HOST=0.0.0.0` so the ESP32
  can reach the backend over Wi-Fi, and allow TCP port 5002 in Windows Firewall.
  Readings and dashboard commands use HiveMQ and work without this.

In the dashboard, sign in and register device ID `esp32-feeder-1` under **Settings**.

## 2. Secrets

Copy `Secrets.example.h` to `Secrets.h` (same folder) and fill in Wi-Fi, the device key
and `BACKEND_HTTP_URL` (the PC's LAN IP, e.g. `http://192.168.137.1:5002/api/v1`).
`Secrets.h` is git-ignored. Never commit or share it.

## 3. Flash

Arduino IDE, board **ESP32 Dev Module**, libraries from the Library Manager:
PubSubClient 2.8, ArduinoJson 6.21.x, OneWire, DallasTemperature, LiquidCrystal_I2C.
Open `AquaSense_ESP32.ino`, upload, and watch Serial Monitor at 115200 baud.

## What works when

| Feature | Needs |
| --- | --- |
| Live readings on the dashboard | Wi-Fi with internet, matching `DEVICE_KEY`, clock set by NTP |
| Feed now / Feeder on / off | The above; device registered to your account |
| Feeding schedules | `BACKEND_HTTP_URL` reachable; kept in flash once synced |
| Aerator on / off, Drain, Fill, Stop pumps | `RELAYS_COMMISSIONED = true` (see below) |
| Run exchange | Measured `EXCHANGE_DRAIN_MS` / `EXCHANGE_FILL_MS` |
| Aerator automatic | `AERATOR_POLICY_CONFIGURED = true` |
| Water automation | `WATER_POLICY_CONFIGURED = true` plus exchange runtimes |

## Commissioning before pump power

Relays start **disabled**: every relay command is answered "rejected_relays_not_commissioned"
and the outputs stay off. With pumps and aerator unplugged from mains:

1. Set `RELAYS_COMMISSIONED = true`, flash, and use the dashboard to switch each relay.
   Confirm the right channel clicks and that `RELAY_ACTIVE_LOW` matches your board.
2. Press the ESP32 reset button and confirm every relay stays OFF while it reboots.
3. Measure each pump's flow before setting the exchange runtimes
   (`Hardware/docs/backend-control.md`, "Fill and drain flow calibration").

Safety behaviour built in: fill and drain never run together; every pump run is capped at
60 s with an independent watchdog that latches a fault; pumps stop if Wi-Fi or MQTT drops;
the aerator keeps its state through a network blip; a fault sounds the buzzer until
"Clear fault" is sent.

## Honest limits

- Sensor conversions use your calibration constants; the dashboard keeps marking readings
  "calibration required" until the backend's calibration is commissioned.
- ORP is a redox reading, not dissolved oxygen.
- HiveMQ's public broker is unencrypted. Signatures stop anyone faking readings or commands,
  but others can see the traffic. Use a private TLS broker for real deployment.
- An acknowledged feed or pump command means the firmware accepted it, not that feed or
  water physically moved.
