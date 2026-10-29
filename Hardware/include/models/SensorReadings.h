#pragma once
#include <stdint.h>

struct AnalogDiagnostics {
    float rawAdc = 0;
    float voltage = 0; // ESP32 ADC pin, before any unverified divider reconstruction.
    uint16_t minimum = 4095;
    uint16_t maximum = 0;
    uint16_t last = 0;
    uint8_t clipped = 0;
    uint32_t sampledAtMs = 0;
    bool efuseCharacterized = false;
};

struct SensorReadings {
    float temperatureC = 0.0f;
    float ph = 0.0f;
    float turbidityRaw = 0.0f; // Preserved field name; provisional NTU estimate when enabled.
    float orpMv = 0.0f;
    float tankDistanceCm = 0.0f;
    float tankLevelPercent = 0.0f;
    bool ultrasonicConnected = false;
    bool ultrasonicValid = false;
    bool temperatureValid = false;
    bool phValid = false;
    bool turbidityValid = false;
    bool orpValid = false;
    bool temperatureConnected = false;
    bool phConnected = false;
    bool turbidityConnected = false;
    bool orpConnected = false;
    uint32_t sampledAtMs = 0; // Monotonic uptime, not a Unix timestamp.
    uint32_t sequence = 0;
    char bootId[17] = {};
    uint32_t temperatureSampledAtMs = 0;
    uint32_t ultrasonicSampledAtMs = 0;
    AnalogDiagnostics phDiagnostics;
    AnalogDiagnostics turbidityDiagnostics;
    AnalogDiagnostics orpDiagnostics;
    // A future commissioned profile must explicitly supply this evidence.
    bool calibrated = false;
};
