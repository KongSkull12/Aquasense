#include "BackendDeviceClient.h"
#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <string.h>
#include "config/DeviceConfig.h"
#if __has_include("secrets/Secrets.h")
#include "secrets/Secrets.h"
#else
#include "secrets/Secrets.example.h"
#endif

bool BackendDeviceClient::begin() {
    if (task) return true;
    if (!Secrets::DEVICE_KEY[0]) { Serial.println("Backend control disabled: configure private DEVICE_KEY and API address."); return false; }
    if (!DeviceConfig::backendTransportConfigured(DeviceConfig::BACKEND_API_BASE_URL,
            DeviceConfig::BACKEND_ROOT_CA, DeviceConfig::ALLOW_INSECURE_BACKEND_HTTP)) {
        Serial.println("Backend control disabled: configure HTTPS with a trusted root CA; HTTP is development-build-only."); return false;
    }
    states = xQueueCreate(1, sizeof(SystemState)); schedulesQueue = xQueueCreate(1, sizeof(FeedingSchedules));
    if (states && schedulesQueue && xTaskCreate(taskEntry, "aq-backend",
        DeviceConfig::BACKEND_TASK_STACK_BYTES, this, 1, &task) == pdPASS) return true;
    for (auto queue : {states, schedulesQueue}) if (queue) vQueueDelete(queue);
    states = schedulesQueue = nullptr; task = nullptr;
    Serial.println("Backend worker unavailable; local safety remains active."); return false;
}
void BackendDeviceClient::update(const SystemState& state) { if (states) xQueueOverwrite(states, &state); }
bool BackendDeviceClient::takeSchedules(FeedingSchedules& next) { return schedulesQueue && xQueueReceive(schedulesQueue, &next, 0) == pdTRUE; }
void BackendDeviceClient::taskEntry(void* context) { static_cast<BackendDeviceClient*>(context)->run(); }
void BackendDeviceClient::run() {
    SystemState state{};
    uint32_t lastDiagnosticsMs = millis(), syncSuccesses = 0, syncFailures = 0;
    for (;;) {
        xQueueReceive(states, &state, 0);
        if (WiFi.status() == WL_CONNECTED) {
            if (sync(state)) ++syncSuccesses;
            else ++syncFailures;
        }
        const uint32_t nowMs = millis();
        if (uint32_t(nowMs - lastDiagnosticsMs) >= 60000) {
            Serial.printf("[BACKEND][HEALTH] uptimeMs=%lu syncSuccesses=%lu syncFailures=%lu workerStackHighWaterWords=%u\n",
                static_cast<unsigned long>(nowMs), static_cast<unsigned long>(syncSuccesses),
                static_cast<unsigned long>(syncFailures), unsigned(uxTaskGetStackHighWaterMark(nullptr)));
            syncSuccesses = syncFailures = 0;
            lastDiagnosticsMs = nowMs;
        }
        vTaskDelay(pdMS_TO_TICKS(DeviceConfig::BACKEND_SYNC_INTERVAL_MS));
    }
}
bool BackendDeviceClient::sync(const SystemState& state) {
    if (!DeviceConfig::backendTransportConfigured(DeviceConfig::BACKEND_API_BASE_URL,
            DeviceConfig::BACKEND_ROOT_CA, DeviceConfig::ALLOW_INSECURE_BACKEND_HTTP)) return false;
    document.clear();
    document["deviceId"] = DeviceConfig::DEVICE_ID;
    JsonObject report = document.createNestedObject("state");
    report["fillPump"] = state.fillPump; report["drainPump"] = state.drainPump; report["aerator"] = state.aerator;
    report["feederBusy"] = state.feederBusy; report["buzzer"] = state.buzzer; report["automation"] = state.automation;
    report["waterPhase"] = state.waterPhase; report["fault"] = state.fault; report["relaysReady"] = state.relaysReady;
    report["timeValid"] = state.rtcTimeValid; report["wifiConnected"] = state.wifiConnected;
    report["mqttConnected"] = state.mqttConnected; report["uptimeMs"] = state.uptimeMs;
    String body; body.reserve(1024); serializeJson(document, body);
    WiFiClient plainTransport; WiFiClientSecure secureTransport; HTTPClient http;
    const bool secure = DeviceConfig::hasPrefix(DeviceConfig::BACKEND_API_BASE_URL, "https://");
    if (secure) secureTransport.setCACert(DeviceConfig::BACKEND_ROOT_CA);
    WiFiClient& transport = secure ? static_cast<WiFiClient&>(secureTransport) : plainTransport;
    http.useHTTP10(true); // Stream JSON without HTTP chunk framing.
    http.setConnectTimeout(DeviceConfig::BACKEND_HTTP_TIMEOUT_MS);
    http.setTimeout(DeviceConfig::BACKEND_HTTP_TIMEOUT_MS);
    const String url = String(DeviceConfig::BACKEND_API_BASE_URL) + "/hardware/device/sync";
    if (!http.begin(transport, url)) return false;
    http.addHeader("Content-Type", "application/json"); http.addHeader("x-device-key", Secrets::DEVICE_KEY);
    const uint32_t startedMs = millis();
    const int code = http.POST(body);
    if (code != 200 || http.getSize() > 8192) { Serial.printf("Backend sync HTTP %d\n", code); http.end(); return false; }
    document.clear();
    const auto error = deserializeJson(document, http.getStream());
    http.end();
    if (error || !document["success"].as<bool>() || !document["data"].is<JsonObject>()) return false;
    decode(uint32_t(millis() - startedMs)); return true;
}
void BackendDeviceClient::decode(uint32_t elapsedMs) {
    (void)elapsedMs;
    const JsonObject data = document["data"];
    if (!data["schedules"].is<JsonArray>()) return;
    FeedingSchedules next{};
    for (JsonObject schedule : data["schedules"].as<JsonArray>()) {
        if (next.count >= MAX_FEEDING_SCHEDULES) break;
        const char* id = schedule["id"] | ""; const char* date = schedule["date"] | ""; const char* time = schedule["time"] | "";
        if (strlen(id) != 36 || (strlen(date) != 0 && strlen(date) != 10) || strlen(time) != 5) continue;
        auto& out = next.items[next.count++];
        strlcpy(out.id, id, sizeof(out.id)); strlcpy(out.date, date, sizeof(out.date)); strlcpy(out.time, time, sizeof(out.time));
    }
    xQueueOverwrite(schedulesQueue, &next);
}
