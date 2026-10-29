#include "WifiManager.h"
#include <WiFi.h>
#include <esp_system.h>
#include "config/DeviceConfig.h"
#if __has_include("secrets/Secrets.h")
#include "secrets/Secrets.h"
#else
#include "secrets/Secrets.example.h"
#endif

void WifiManager::begin() {
    WiFi.onEvent([](WiFiEvent_t event, WiFiEventInfo_t info) {
        if (event == ARDUINO_EVENT_WIFI_STA_DISCONNECTED)
            Serial.printf("[WiFi] disconnect reason=%u\n", unsigned(info.wifi_sta_disconnected.reason));
    });
    WiFi.persistent(false);
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.begin(Secrets::WIFI_SSID, Secrets::WIFI_PASSWORD);
    lastReconnectMs = millis();
    lastCheckMs = lastReconnectMs;
    Serial.println("WiFi connection started.");
}

bool WifiManager::isConnected() const { return wasConnected; }
uint32_t WifiManager::reconnectAttempts() const { return reconnectAttemptCount; }

void WifiManager::update(uint32_t nowMs) {
    // During connection attempts the reference checks the live status on each
    // pass. Once connected, defer link polling to its five-second cadence.
    if (!wasConnected || uint32_t(nowMs - lastCheckMs) >= DeviceConfig::WIFI_CHECK_INTERVAL_MS) {
        lastCheckMs = nowMs;
        const bool connected = WiFi.status() == WL_CONNECTED;
        if (connected != wasConnected) {
            Serial.println(connected ? "WiFi connected" : "WiFi disconnected");
            wasConnected = connected;
        }
        if (wasConnected) {
            lastReconnectMs = nowMs;
            retryDelayMs = DeviceConfig::WIFI_RECONNECT_INTERVAL_MS;
            reconnectAttemptCount = 0;
        }
    }
    if (!wasConnected && uint32_t(nowMs - lastReconnectMs) >= retryDelayMs) {
        lastReconnectMs = nowMs;
        WiFi.reconnect();
        ++reconnectAttemptCount;
        Serial.printf("[WiFi] reconnect attempt=%lu\n", static_cast<unsigned long>(reconnectAttemptCount));
        const uint32_t jitterMs = esp_random() % 1000U;
        const uint32_t nextDelay = retryDelayMs >= DeviceConfig::WIFI_RECONNECT_MAX_MS / 2
            ? DeviceConfig::WIFI_RECONNECT_MAX_MS
            : retryDelayMs * 2;
        retryDelayMs = nextDelay > DeviceConfig::WIFI_RECONNECT_MAX_MS - jitterMs
            ? DeviceConfig::WIFI_RECONNECT_MAX_MS : nextDelay + jitterMs;
    }
}
