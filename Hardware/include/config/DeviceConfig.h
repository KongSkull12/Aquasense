#pragma once
#include <stdint.h>

namespace DeviceConfig {
constexpr uint32_t SERIAL_BAUD = 115200;
constexpr uint32_t MAIN_LOOP_IDLE_TICKS = 1; // Let RTOS idle/housekeeping tasks run.
constexpr uint32_t SENSOR_READ_INTERVAL_MS = 1000;
constexpr uint32_t ADC_SAMPLE_INTERVAL_US = 500;
constexpr uint8_t ADC_SAMPLE_COUNT = 12;
constexpr uint8_t VOLTAGE_SAMPLE_COUNT = 20;
constexpr uint8_t TEMPERATURE_RESOLUTION_BITS = 12;
constexpr uint32_t TEMPERATURE_CONVERSION_MS = 750;
constexpr uint32_t WIFI_RECONNECT_INTERVAL_MS = 3000;
constexpr uint32_t WIFI_RECONNECT_MAX_MS = 30000;
constexpr uint32_t WIFI_CONNECT_TIMEOUT_MS = 20000;
constexpr uint32_t WIFI_CHECK_INTERVAL_MS = 5000;
constexpr uint32_t MQTT_RECONNECT_INTERVAL_MS = 3000;
constexpr uint32_t MQTT_RECONNECT_MAX_MS = 30000;
constexpr uint32_t MQTT_CONNECT_TIMEOUT_MS = 20000;
constexpr uint32_t MQTT_PUBLISH_INTERVAL_MS = 5000;
constexpr uint32_t MQTT_TASK_POLL_MS = 20;
constexpr uint32_t MQTT_TASK_STACK_BYTES = 6144;
constexpr uint16_t MQTT_SOCKET_TIMEOUT_SECONDS = 2;
constexpr uint32_t TELEMETRY_MAX_AGE_MS = 15000;
constexpr uint32_t LCD_REFRESH_INTERVAL_MS = 500;
constexpr uint32_t LCD_SUCCESS_HOLD_MS = 1000;
constexpr uint8_t LCD_ADDRESS = 0x27;
constexpr uint8_t LCD_COLUMNS = 20;
constexpr uint8_t LCD_ROWS = 4;
constexpr uint32_t RTC_READ_INTERVAL_MS = 1000;
constexpr uint16_t I2C_TIMEOUT_MS = 50;
constexpr const char* DEVICE_ID = "esp32-feeder-1"; // Must be registered to the backend owner.
constexpr const char* BACKEND_API_BASE_URL = "https://backend.example.invalid/api/v1";
constexpr const char* BACKEND_ROOT_CA = ""; // PEM root CA required for HTTPS; never bypass certificate validation.
#if defined(AQUASENSE_PRODUCTION_BUILD) && defined(AQUASENSE_ALLOW_INSECURE_HTTP)
#error "Insecure backend HTTP cannot be enabled in a production build."
#endif
#if defined(AQUASENSE_DEVELOPMENT_BUILD) && defined(AQUASENSE_ALLOW_INSECURE_HTTP) && !defined(NDEBUG) && !defined(AQUASENSE_PRODUCTION_BUILD)
constexpr bool ALLOW_INSECURE_BACKEND_HTTP = true;
#else
constexpr bool ALLOW_INSECURE_BACKEND_HTTP = false;
#endif
constexpr bool hasPrefix(const char* value, const char* prefix) {
    return *prefix == '\0' || (*value != '\0' && *value == *prefix && hasPrefix(value + 1, prefix + 1));
}
constexpr bool validAuthorityChars(const char* value) {
    return *value == '\0' || *value == '/' || *value == '?' || *value == '#' ||
        (*value != ' ' && *value != '\t' && *value != '@' && validAuthorityChars(value + 1));
}
constexpr bool hasAuthority(const char* value) {
    return *value != '\0' && *value != '/' && *value != '?' && *value != '#' && validAuthorityChars(value);
}
constexpr bool backendTransportConfigured(const char* url, const char* rootCa, bool allowInsecureHttp) {
    return (hasPrefix(url, "https://") && hasAuthority(url + 8) && rootCa[0] != '\0') ||
        (allowInsecureHttp && hasPrefix(url, "http://") && hasAuthority(url + 7));
}
constexpr uint32_t BACKEND_SYNC_INTERVAL_MS = 5000;
constexpr uint32_t BACKEND_HTTP_TIMEOUT_MS = 2000;
constexpr uint32_t BACKEND_TASK_STACK_BYTES = 8192;
constexpr uint32_t COMMAND_MAX_TTL_MS = 120000;
constexpr uint32_t MIN_VALID_EPOCH = 1704067200; // 2024-01-01, reject unset system time.
constexpr int32_t LOCAL_OFFSET_SECONDS = 8 * 3600;
constexpr const char* NTP_PRIMARY = "pool.ntp.org";
constexpr const char* NTP_SECONDARY = "time.nist.gov";

// Public-dev routes signed, device-scoped feeder commands through HiveMQ.
// The broker has no ACL/TLS; command HMAC validation and replay protection are mandatory.
constexpr const char* MQTT_HOST = "broker.hivemq.com";
constexpr uint16_t MQTT_PORT = 1883;
constexpr const char* MQTT_TOPIC_NAMESPACE = "aquasense-dev";
constexpr const char* MQTT_CONTROL_TOPIC_NAMESPACE = "aquasense-control-dev";
constexpr const char* MQTT_CONTROL_HOST = "192.168.1.6";
constexpr uint16_t MQTT_CONTROL_PORT = 8883;
constexpr const char* MQTT_CONTROL_CLIENT_ID = "aquasense-ctrl-esp32-feeder-1";
constexpr bool MQTT_ACTUATOR_COMMANDS_ENABLED = true;
constexpr bool MQTT_CONTROL_PUBLIC_ENABLED = true; // Public HiveMQ transport; HMAC signatures and device replay checks are mandatory.
constexpr bool MQTT_AUTHENTICATION_ENABLED = false;
constexpr bool MQTT_CONTROL_TLS_ENABLED = true;
constexpr bool MQTT_CONTROL_AUTHENTICATION_ENABLED = true;
// DEVICE_ID is registered uniquely per board and is also the broker client ID.
constexpr const char* MQTT_CLIENT_ID = DEVICE_ID;
// Public development telemetry is device-scoped; control is routed separately.
}
