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
| Active buzzer (+ to the pin, − to GND) | 19 |

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

### Flash from the dashboard instead

You can compile once and then flash any board from **Dashboard → Firmware update**, in Chrome
or Edge on a computer, without uploading through the Arduino IDE:

1. In the Arduino IDE, choose **Sketch → Export Compiled Binary**. It writes a `build/` folder
   next to the sketch. With arduino-cli:
   `arduino-cli compile --fqbn esp32:esp32:esp32 --export-binaries Hardware/arduino/AquaSense_ESP32`.
2. Close Serial Monitor, plug in the board, open the Firmware update page and click **Connect**.
   Hold BOOT while connecting if the board does not enter download mode by itself.
3. Pick a file and click **Flash firmware**:
   - `AquaSense_ESP32.ino.bin` (app only, written at `0x10000`). Use this for normal updates.
     It keeps the calibration and settings saved on the device.
   - `AquaSense_ESP32.ino.merged.bin` (full 4 MB image, written at `0x0`). Use this for a new or
     wiped board. It also clears the saved settings.

The exported `.bin` files contain the Wi-Fi password and device key from `Secrets.h`. They are
git-ignored; do not share or upload them.

## What works when

| Feature | Needs |
| --- | --- |
| Live readings on the dashboard | Wi-Fi with internet, matching `DEVICE_KEY`, clock set by NTP |
| Feed now / Feeder on / off | The above; device registered to your account |
| Feeding schedules | `BACKEND_HTTP_URL` reachable; kept in flash once synced |
| Aerator on / off, Drain, Fill, Stop pumps | Relays enabled after Serial `relay enable` (see below) |
| Fill to target | Mount height + target depth calibrated; user starts from Water change. Stops at target, bad echo, or 60 s |
| Run exchange | The dashboard duration, 1–600 s for the drain and again for the fill. A measured `EXCHANGE_DRAIN_MS` / `EXCHANGE_FILL_MS` can only shorten that phase |
| Aerator automatic | Temperature policy: on at 29.5 °C, off at 28.5 °C. A missing temperature reading leaves the aerator on |
| Water automation | `WATER_POLICY_CONFIGURED = true` plus exchange runtimes |

## Sensor calibration (Serial Monitor)

Open Serial Monitor at 115200 baud with line ending **Newline** and type `help`.
Results are saved in flash (`cal2` + `calVer`).

| Sensor | Hardware | Steps |
| --- | --- | --- |
| pH | PH-4502C **PO** analog (not DO) on GPIO35 | `watch` → capture all three buffers, rinsing between them: `ph 4.01`, `ph 6.86`, `ph 9.18`. The fit saves after the third. |
| ORP | DFRobot SEN0165 on GPIO32 | Circuit: `ORP = 400*Vmod − 1000*Vsensor − OFFSET`. Use `orp <mV>` with the printed standard, or `orp zero` with the **probe disconnected**. Never press the board cal button while the probe is attached. |
| Turbidity | DFRobot SEN0189 (switch on **A**, 5 V power) on GPIO34 through a 10k/20k divider, `afe turb 1.5` | `watch` → `turb 0` in clean water corrects the offset. A known standard such as `turb 100` also fits the gain. |
| Tank depth | Ultrasonic | `tank empty` then `tank target 3`. Depth = mount − distance. |

Also: `status` / `cal show`, `afe` (divider ratios — **measure before setting**), `watch`.
5 V analog modules can exceed ESP32 ADC limits; verify dividers before enabling continuous use.
A capture from the dashboard is recorded by the server; Serial-only edits are not.

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

- Sensor conversions use the calibration saved on the device. The dashboard classifies
  a sensor after the server records that saved capture. Temperature is factory calibrated.
- ORP is a redox reading, not dissolved oxygen.
- HiveMQ's public broker is unencrypted. Signatures stop anyone faking readings or commands,
  but others can see the traffic. Use a private TLS broker for real deployment.
- An acknowledged feed or pump command means the firmware accepted it, not that feed or
  water physically moved.
