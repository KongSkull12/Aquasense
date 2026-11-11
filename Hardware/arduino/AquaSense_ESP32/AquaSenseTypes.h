// Types referenced in function signatures. Kept in a header so the Arduino
// builder's auto-prototypes (inserted after #includes) can see them.
#pragma once

#include <Arduino.h>

struct AnalogDiag {
  int rawAdc = 0;
  float voltage = NAN;          // ESP32 ADC pin voltage (after any divider)
  float sensorVoltage = NAN;    // reconstructed module output (= voltage * divider)
  float filteredVoltage = NAN;  // median of recent sensor voltages
  int minimum = 0; int maximum = 0; int last = 0; int clipped = 0;
  float spreadMv = NAN;         // peak-to-peak of this burst (mV at ADC pin)
};

enum SensorQuality : uint8_t {
  SQ_INITIALIZING = 0,
  SQ_DISCONNECTED,
  SQ_ADC_SATURATED,
  SQ_UNSTABLE,
  SQ_STABILIZING,
  SQ_STABLE,
  SQ_OUT_OF_RANGE,
  SQ_CALIBRATION_REQUIRED,
  SQ_SENSOR_ERROR,
};

struct Sensor {
  bool connected = false;
  float value = NAN;
  uint32_t sampledAtMs = 0;
  int connectCount = 0;
  int disconnectCount = 0;
  AnalogDiag diag;
  SensorQuality quality = SQ_INITIALIZING;
  float filtBuf[5] = {};
  uint8_t filtCount = 0;
  uint8_t filtNext = 0;
};

enum FeederStep { FEED_IDLE, FEED_PRE, FEED_OPEN, FEED_POST, FEED_HOLD_OPEN };

struct PendingCommand {
  bool used = false;
  char id[37]; char source[10]; char action[24];
  uint32_t durationMs;
  char param[25];   // calibration commands only, e.g. "ph:6.86"
  uint64_t expiresAt = 0;   // signed UTC ms; feeder commands are re-checked just before they run
};
