// Copy this file to Secrets.h in the same folder and fill in your values.
// Secrets.h is git-ignored: never commit or share it.
#pragma once

namespace Secrets {
// Wi-Fi the ESP32 joins (2.4 GHz). It needs internet access for HiveMQ and NTP.
constexpr const char* WIFI_SSID = "YOUR_WIFI_NAME";
constexpr const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Must be identical to the key after "esp32-feeder-1:" in DEVICE_KEYS of
// Backend/.env.public-dev (at least 32 characters). It signs every reading and
// acknowledgement, and verifies every command from the dashboard.
constexpr const char* DEVICE_KEY = "PASTE_THE_SAME_KEY_AS_BACKEND_DEVICE_KEYS";

// Base URL of the backend as seen from the ESP32, ending in /api/v1.
// Used for feeding-schedule sync and the state heartbeat. Use the PC's LAN IP,
// never "localhost". Leave empty ("") to disable both; readings and dashboard
// commands still work over MQTT.
constexpr const char* BACKEND_HTTP_URL = "http://192.168.137.1:5002/api/v1";
}  // namespace Secrets
