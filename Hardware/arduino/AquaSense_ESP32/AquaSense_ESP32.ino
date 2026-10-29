/*
  AquaSense ESP32 - complete device firmware
  ------------------------------------------
  Talks to the AquaSense backend "public-dev" profile (npm run dev:public-dev):

  * Sensors: pH, temperature (DS18B20), turbidity, ORP, ultrasonic tank level.
  * Telemetry: HMAC-signed, timestamped frame every 5 s on
      aquasense-dev/devices/<DEVICE_ID>/telemetry/frame
    The backend stores only signed frames; nothing is sent for a sensor that
    is disconnected (its value is null), so the dashboard never shows a value
    that did not come from a real reading.
  * Commands from the dashboard (Feeding, Water change, Aerator pages) arrive
    signed on aquasense-control-dev/<DEVICE_ID>/command. Each is checked for
    signature, device, expiry and replay, executed, then answered with a
    signed acknowledgement on aquasense-control-dev/<DEVICE_ID>/state.
  * Feeding schedules are pulled over HTTP from the backend and kept in flash,
    so scheduled feeds continue during network outages.
  * 20x4 I2C LCD with three rotating pages.

  Setup: copy Secrets.example.h to Secrets.h and fill it in. Read the
  "COMMISSIONING" section below before connecting pump power.

  Board: ESP32 Dev Module. Libraries (Arduino Library Manager):
    PubSubClient 2.8, ArduinoJson 6.21.x, OneWire 2.3.8,
    DallasTemperature 3.11.0, LiquidCrystal_I2C 1.1.4
*/

#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <LiquidCrystal_I2C.h>
#include <mbedtls/md.h>
#include <sys/time.h>
#include <time.h>
#if __has_include(<esp_arduino_version.h>)
#include <esp_arduino_version.h>
#endif
#include "Secrets.h"


// =====================================================
// DEVICE / BACKEND CONFIG (must match Backend/.env.public-dev)
// =====================================================

const char* DEVICE_ID          = "esp32-feeder-1";
const char* MQTT_HOST          = "broker.hivemq.com";
const uint16_t MQTT_PORT       = 1883;
const char* TELEMETRY_NS       = "aquasense-dev";          // MQTT_TOPIC_NAMESPACE
const char* CONTROL_NS         = "aquasense-control-dev";  // MQTT_CONTROL_TOPIC_NAMESPACE
const long  LOCAL_UTC_OFFSET_S = 8L * 3600L;               // Asia/Manila, used for schedules


// =====================================================
// PINS
// =====================================================

#define PH_PIN            35
#define TURB_PIN          34
#define ORP_PIN           32
#define ONE_WIRE_BUS      4
#define ULTRASONIC_TRIG   14
#define ULTRASONIC_ECHO   13   // 5 V echo: keep the voltage divider!

#define RELAY_AERATOR_PIN 25
#define RELAY_FILL_PIN    26
#define RELAY_DRAIN_PIN   27
#define SERVO_PIN         18
#define BUZZER_PIN        19

#define LCD_ADDRESS 0x27
#define LCD_COLS    20
#define LCD_ROWS    4


// =====================================================
// COMMISSIONING (read before connecting pump power)
// =====================================================
// Relays stay OFF and every relay command is rejected until you have checked,
// with pumps and aerator unplugged from mains, that each relay clicks for the
// right channel and that the module is OFF while the ESP32 is in reset.
const bool RELAYS_COMMISSIONED = false;
const bool RELAY_ACTIVE_LOW    = true;    // most 5 V relay boards switch on a LOW input

// Manual FILL / DRAIN: the dashboard sends a duration (1-60 s); this caps it.
const uint32_t PUMP_HARD_MAX_MS = 60000;
const uint32_t PUMP_COOLDOWN_MS = 10000;

// WATER_EXCHANGE uses these measured runtimes (see Hardware/docs/backend-control.md,
// "Fill and drain flow calibration"). 0 = exchange rejected until measured.
const uint32_t EXCHANGE_DRAIN_MS    = 0;
const uint32_t EXCHANGE_SETTLING_MS = 0;
const uint32_t EXCHANGE_FILL_MS     = 0;

// AERATOR_AUTO: temperature hysteresis. Set true once the thresholds are agreed.
const bool  AERATOR_POLICY_CONFIGURED = false;
const float AERATOR_ON_ABOVE_C  = 29.5;
const float AERATOR_OFF_BELOW_C = 28.5;

// AUTOMATION_ON: automatic water exchange when readings leave these limits for
// 10 consecutive samples. Needs the exchange runtimes above as well.
const bool     WATER_POLICY_CONFIGURED = false;
const float    AUTO_PH_LOW  = 6.5;
const float    AUTO_PH_HIGH = 9.0;
const float    AUTO_TURBIDITY_HIGH_NTU = 200.0;
const uint32_t AUTO_EXCHANGE_MIN_GAP_MS = 6UL * 3600UL * 1000UL;

// Feeder servo angles and timing (original feeder cycle).
const int      SERVO_CLOSED_DEG = 25;
const int      SERVO_OPEN_DEG   = 140;
const uint32_t FEED_PRE_MS      = 800;
const uint32_t FEED_OPEN_MS     = 1000;
const uint32_t FEED_POST_MS     = 800;
const uint32_t FEED_ON_HOLD_MS  = 10000;   // "ON" closes again after this


// =====================================================
// SENSOR CALIBRATION (your values; verify against reference solutions)
// =====================================================

float PH_SLOPE   = -5.70;
float PH_OFFSET  = 21.34;
float ORP_SLOPE  = 1333.33;
float ORP_OFFSET = -2000.0;
float TURB_CLEAR_ADC = 3000.0;
float TURB_DIRTY_ADC = 500.0;
float TURB_DIRTY_NTU = 1000.0;
const float TANK_FULL_DISTANCE_CM  = 10.0;
const float TANK_EMPTY_DISTANCE_CM = 100.0;

#define PH_CONNECT_MIN   200
#define PH_CONNECT_MAX   3900
#define TURB_CONNECT_MIN 50
#define TURB_CONNECT_MAX 4050
#define ORP_CONNECT_MIN  50
#define ORP_CONNECT_MAX  4050
#define STABILITY_MAX_DEV 400
#define DISCONNECT_CONFIRM_COUNT 4


// =====================================================
// TIMING
// =====================================================

const uint32_t SENSOR_INTERVAL_MS      = 1000;
const uint32_t FRAME_INTERVAL_MS       = 5000;   // backend stores at most one frame per 4.5 s
const uint32_t LCD_INTERVAL_MS         = 500;
const uint32_t LCD_PAGE_MS             = 4000;
const uint32_t WIFI_RETRY_MS           = 5000;
const uint32_t MQTT_RETRY_MS           = 5000;
const uint32_t SCHEDULE_SYNC_MS        = 60000;
const uint32_t STATE_HEARTBEAT_MS      = 30000;
const uint64_t COMMAND_MAX_TTL_MS      = 130000; // backend TTL is 120 s
const time_t   MIN_VALID_EPOCH         = 1700000000;


// =====================================================
// GLOBALS
// =====================================================

WiFiClient        wifiClient;
PubSubClient      mqtt(wifiClient);
Preferences       prefs;
OneWire           oneWire(ONE_WIRE_BUS);
DallasTemperature tempSensor(&oneWire);
LiquidCrystal_I2C lcd(LCD_ADDRESS, LCD_COLS, LCD_ROWS);
bool              lcdPresent = false;

char bootId[24];
uint32_t frameSequence = 0;
char telemetryTopic[96];
char commandTopic[96];
char stateTopic[96];

struct AnalogDiag {
  int rawAdc = 0; float voltage = NAN; int minimum = 0; int maximum = 0; int last = 0; int clipped = 0;
};

struct Sensor {
  bool connected = false;
  float value = NAN;
  uint32_t sampledAtMs = 0;
  int connectCount = 0;
  int disconnectCount = 0;
  AnalogDiag diag;
};

Sensor phS, turbS, orpS, tempS, ultraS;
float tankLevelPercent = NAN;
bool tempConversionPending = false;


// =====================================================
// TIME
// =====================================================

bool timeValid() { return time(nullptr) >= MIN_VALID_EPOCH; }

uint64_t epochMillis() {
  timeval tv{};
  if (gettimeofday(&tv, nullptr) != 0 || tv.tv_sec < MIN_VALID_EPOCH) return 0;
  return uint64_t(tv.tv_sec) * 1000ULL + uint64_t(tv.tv_usec / 1000);
}

// ISO-8601 UTC for a moment `ageMs` before now.
bool isoAtAge(uint64_t nowUtcMs, uint32_t ageMs, char* out, size_t size) {
  if (!nowUtcMs || size < 25 || nowUtcMs < ageMs) return false;
  const uint64_t at = nowUtcMs - ageMs;
  const time_t seconds = time_t(at / 1000ULL);
  tm utc{};
  if (!gmtime_r(&seconds, &utc)) return false;
  snprintf(out, size, "%04d-%02d-%02dT%02d:%02d:%02d.%03uZ", utc.tm_year + 1900, utc.tm_mon + 1, utc.tm_mday,
           utc.tm_hour, utc.tm_min, utc.tm_sec, unsigned(at % 1000ULL));
  return true;
}

// Local (Manila) date "YYYY-MM-DD" and time "HH:MM".
bool localDateTime(char* date, size_t dateSize, char* hm, size_t hmSize) {
  if (!timeValid()) return false;
  time_t local = time(nullptr) + LOCAL_UTC_OFFSET_S;
  tm t{};
  gmtime_r(&local, &t);
  snprintf(date, dateSize, "%04d-%02d-%02d", t.tm_year + 1900, t.tm_mon + 1, t.tm_mday);
  snprintf(hm, hmSize, "%02d:%02d", t.tm_hour, t.tm_min);
  return true;
}


// =====================================================
// HMAC-SHA256 (shared key with backend DEVICE_KEYS)
// =====================================================

bool hmacHex(const char* message, size_t length, char out[65]) {
  if (!Secrets::DEVICE_KEY[0]) return false;
  uint8_t digest[32];
  const mbedtls_md_info_t* info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  if (!info || mbedtls_md_hmac(info, (const unsigned char*)Secrets::DEVICE_KEY, strlen(Secrets::DEVICE_KEY),
                               (const unsigned char*)message, length, digest) != 0) return false;
  for (int i = 0; i < 32; i++) snprintf(out + i * 2, 3, "%02x", digest[i]);
  out[64] = '\0';
  return true;
}

bool signatureMatches(const char* message, const char* signature) {
  if (!signature || strlen(signature) != 64) return false;
  char expected[65];
  if (!hmacHex(message, strlen(message), expected)) return false;
  uint8_t diff = 0;
  for (int i = 0; i < 64; i++) diff |= uint8_t(tolower(expected[i]) ^ tolower(signature[i]));
  return diff == 0;
}


// =====================================================
// ACTUATOR OUTPUTS (servo, buzzer, relays)
// =====================================================

#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
void pwmSetup() { ledcAttach(SERVO_PIN, 50, 16); ledcAttach(BUZZER_PIN, 2000, 10); ledcWriteTone(BUZZER_PIN, 0); }
void servoDuty(uint32_t duty) { ledcWrite(SERVO_PIN, duty); }
void buzzerTone(uint32_t hz) { ledcWriteTone(BUZZER_PIN, hz); }
#else
const uint8_t SERVO_CH = 4, BUZZER_CH = 6;  // separate LEDC timers
void pwmSetup() {
  ledcSetup(SERVO_CH, 50, 16); ledcAttachPin(SERVO_PIN, SERVO_CH);
  ledcSetup(BUZZER_CH, 2000, 10); ledcAttachPin(BUZZER_PIN, BUZZER_CH); ledcWriteTone(BUZZER_CH, 0);
}
void servoDuty(uint32_t duty) { ledcWrite(SERVO_CH, duty); }
void buzzerTone(uint32_t hz) { ledcWriteTone(BUZZER_CH, hz); }
#endif

void servoAngle(int degrees) {
  degrees = constrain(degrees, 0, 180);
  const uint32_t pulseUs = 500 + uint32_t(degrees) * 2000 / 180;   // 0.5-2.5 ms
  servoDuty(pulseUs * 65535UL / 20000UL);
}

const int RELAY_ON = RELAY_ACTIVE_LOW ? LOW : HIGH;
const int RELAY_OFF = RELAY_ACTIVE_LOW ? HIGH : LOW;

bool aeratorOn = false, fillOn = false, drainOn = false;

void setRelay(int pin, bool on, bool& state) {
  if (!RELAYS_COMMISSIONED) on = false;
  digitalWrite(pin, on ? RELAY_ON : RELAY_OFF);
  state = on;
}

void relaysInit() {
  // Drive the OFF level before switching to output so no relay blips at boot.
  for (int pin : {RELAY_AERATOR_PIN, RELAY_FILL_PIN, RELAY_DRAIN_PIN}) {
    digitalWrite(pin, RELAY_OFF);
    pinMode(pin, OUTPUT);
    digitalWrite(pin, RELAY_OFF);
  }
}


// =====================================================
// FEEDER
// =====================================================

enum FeederStep { FEED_IDLE, FEED_PRE, FEED_OPEN, FEED_POST, FEED_HOLD_OPEN };
FeederStep feederStep = FEED_IDLE;
uint32_t feederStepAt = 0;
char feedSuppressedMinute[20] = "";   // OFF / ALL_OFF block a scheduled feed in this minute

bool feederBusy() { return feederStep != FEED_IDLE; }

void feederStart(FeederStep step, int angle) { feederStep = step; feederStepAt = millis(); servoAngle(angle); }

void feederTrigger() { if (!feederBusy()) feederStart(FEED_PRE, SERVO_CLOSED_DEG); }
void feederHoldOpen() { feederStart(FEED_HOLD_OPEN, SERVO_OPEN_DEG); }
void feederStop() { feederStep = FEED_IDLE; servoAngle(SERVO_CLOSED_DEG); }

void updateFeeder() {
  const uint32_t elapsed = millis() - feederStepAt;
  switch (feederStep) {
    case FEED_PRE:       if (elapsed >= FEED_PRE_MS) feederStart(FEED_OPEN, SERVO_OPEN_DEG); break;
    case FEED_OPEN:      if (elapsed >= FEED_OPEN_MS) feederStart(FEED_POST, SERVO_CLOSED_DEG); break;
    case FEED_POST:      if (elapsed >= FEED_POST_MS) feederStep = FEED_IDLE; break;
    case FEED_HOLD_OPEN: if (elapsed >= FEED_ON_HOLD_MS) feederStop(); break;
    default: break;
  }
}

void suppressFeedingThisMinute() {
  char date[12], hm[6];
  if (localDateTime(date, sizeof(date), hm, sizeof(hm))) snprintf(feedSuppressedMinute, sizeof(feedSuppressedMinute), "%s %s", date, hm);
}


// =====================================================
// WATER (fill / drain / timed exchange)
// =====================================================

const char* waterPhase = "IDLE";   // IDLE DRAINING SETTLING_AFTER_DRAIN REFILLING COOLDOWN COMPLETE FAULT
char waterFault[48] = "";
uint32_t phaseStartedAt = 0, phaseDurationMs = 0;
bool exchangeRunning = false;
bool waterAutomation = false;
uint32_t lastAutoExchangeAt = 0;
bool autoExchangeEverRan = false;
int outOfRangeSamples = 0;

void enterPhase(const char* phase, uint32_t durationMs) { waterPhase = phase; phaseStartedAt = millis(); phaseDurationMs = durationMs; }

void pumpsOff() { setRelay(RELAY_FILL_PIN, false, fillOn); setRelay(RELAY_DRAIN_PIN, false, drainOn); }

void waterFaultLatch(const char* reason) {
  pumpsOff();
  exchangeRunning = false;
  waterAutomation = false;
  strlcpy(waterFault, reason, sizeof(waterFault));
  enterPhase("FAULT", 0);
  Serial.printf("[WATER] FAULT %s\n", reason);
}

bool waterBusy() {
  return !strcmp(waterPhase, "DRAINING") || !strcmp(waterPhase, "REFILLING") ||
         !strcmp(waterPhase, "SETTLING_AFTER_DRAIN") || !strcmp(waterPhase, "COOLDOWN");
}

void waterStop() {
  const bool wasRunning = fillOn || drainOn || exchangeRunning;
  pumpsOff();
  exchangeRunning = false;
  waterAutomation = false;
  if (strcmp(waterPhase, "FAULT")) enterPhase(wasRunning ? "COOLDOWN" : "IDLE", wasRunning ? PUMP_COOLDOWN_MS : 0);
}

void startDrain(uint32_t ms) { setRelay(RELAY_FILL_PIN, false, fillOn); setRelay(RELAY_DRAIN_PIN, true, drainOn); enterPhase("DRAINING", ms); }
void startFill(uint32_t ms)  { setRelay(RELAY_DRAIN_PIN, false, drainOn); setRelay(RELAY_FILL_PIN, true, fillOn); enterPhase("REFILLING", ms); }

void startExchange() { exchangeRunning = true; startDrain(EXCHANGE_DRAIN_MS); }

void updateWater() {
  const uint32_t elapsed = millis() - phaseStartedAt;
  // Independent watchdog: no pump may run past the hard maximum.
  if ((fillOn || drainOn) && elapsed > PUMP_HARD_MAX_MS + 2000) { waterFaultLatch(fillOn ? "fill_timeout" : "drain_timeout"); return; }
  if (phaseDurationMs == 0 || elapsed < phaseDurationMs) return;

  if (!strcmp(waterPhase, "DRAINING")) {
    setRelay(RELAY_DRAIN_PIN, false, drainOn);
    if (exchangeRunning) enterPhase("SETTLING_AFTER_DRAIN", max<uint32_t>(EXCHANGE_SETTLING_MS, 1));
    else enterPhase("COOLDOWN", PUMP_COOLDOWN_MS);
  } else if (!strcmp(waterPhase, "SETTLING_AFTER_DRAIN")) {
    startFill(EXCHANGE_FILL_MS);
  } else if (!strcmp(waterPhase, "REFILLING")) {
    setRelay(RELAY_FILL_PIN, false, fillOn);
    enterPhase("COOLDOWN", PUMP_COOLDOWN_MS);
  } else if (!strcmp(waterPhase, "COOLDOWN")) {
    enterPhase(exchangeRunning ? "COMPLETE" : "IDLE", 0);
    exchangeRunning = false;
  }
}

// Automatic exchange: only on fresh, connected readings out of range.
void evaluateWaterAutomation() {
  if (!waterAutomation || !WATER_POLICY_CONFIGURED || waterBusy() || !strcmp(waterPhase, "FAULT")) return;
  const bool phOut = phS.connected && isfinite(phS.value) && (phS.value < AUTO_PH_LOW || phS.value > AUTO_PH_HIGH);
  const bool turbOut = turbS.connected && isfinite(turbS.value) && turbS.value > AUTO_TURBIDITY_HIGH_NTU;
  outOfRangeSamples = (phOut || turbOut) ? outOfRangeSamples + 1 : 0;
  const bool gapOk = !autoExchangeEverRan || millis() - lastAutoExchangeAt >= AUTO_EXCHANGE_MIN_GAP_MS;
  if (outOfRangeSamples >= 10 && gapOk) {
    outOfRangeSamples = 0; lastAutoExchangeAt = millis(); autoExchangeEverRan = true;
    Serial.println("[WATER] automatic exchange started");
    startExchange();
  }
}


// =====================================================
// AERATOR / BUZZER
// =====================================================

bool aeratorAuto = false;
bool buzzerManual = false;

void updateAerator() {
  if (!aeratorAuto) return;
  // Invalid or missing temperature turns the aerator on (fail-safe for stock).
  if (!tempS.connected || !isfinite(tempS.value)) { if (!aeratorOn) setRelay(RELAY_AERATOR_PIN, true, aeratorOn); return; }
  if (tempS.value >= AERATOR_ON_ABOVE_C && !aeratorOn) setRelay(RELAY_AERATOR_PIN, true, aeratorOn);
  else if (tempS.value <= AERATOR_OFF_BELOW_C && aeratorOn) setRelay(RELAY_AERATOR_PIN, false, aeratorOn);
}

bool buzzerSounding() { return buzzerManual || !strcmp(waterPhase, "FAULT"); }

void updateBuzzer() {
  static bool toneOn = false;
  const bool fault = !strcmp(waterPhase, "FAULT");
  if (!buzzerSounding()) { if (toneOn) { buzzerTone(0); toneOn = false; } return; }
  // Fault: fast alarm. Manual: slow beep.
  const uint32_t period = fault ? 400 : 1000, onFor = fault ? 200 : 150;
  const bool shouldSound = (millis() % period) < onFor;
  if (shouldSound != toneOn) { buzzerTone(shouldSound ? (fault ? 2800 : 2000) : 0); toneOn = shouldSound; }
}


// =====================================================
// SENSORS
// =====================================================

AnalogDiag sampleADC(int pin, int samples = 12) {
  AnalogDiag d;
  long total = 0; d.minimum = 4095; d.maximum = 0;
  for (int i = 0; i < samples; i++) {
    const int v = analogRead(pin);
    total += v;
    d.minimum = min(d.minimum, v); d.maximum = max(d.maximum, v);
    if (v <= 0 || v >= 4095) d.clipped++;
    d.last = v;
    delayMicroseconds(500);
  }
  d.rawAdc = int(total / samples);
  uint32_t mv = 0;
  for (int i = 0; i < 16; i++) { mv += analogReadMilliVolts(pin); delayMicroseconds(300); }
  d.voltage = (mv / 16.0f) / 1000.0f;
  return d;
}

void trackConnection(Sensor& s, bool looksConnected, const char* name) {
  if (looksConnected) {
    s.connectCount++; s.disconnectCount = 0;
    if (!s.connected) { s.connected = true; Serial.printf("[%s] CONNECTED\n", name); }
  } else {
    s.disconnectCount++; s.connectCount = 0;
    if (s.connected && s.disconnectCount >= DISCONNECT_CONFIRM_COUNT) { s.connected = false; Serial.printf("[%s] DISCONNECTED\n", name); }
  }
  if (!s.connected) s.value = NAN;
}

bool adcLooksConnected(const AnalogDiag& d, int lo, int hi) {
  return d.rawAdc >= lo && d.rawAdc <= hi && (d.maximum - d.minimum) <= STABILITY_MAX_DEV;
}

void readAnalogSensors() {
  // pH first: an unplugged pH input rails high and can bleed into the next pin.
  phS.diag = sampleADC(PH_PIN); phS.sampledAtMs = millis();
  trackConnection(phS, adcLooksConnected(phS.diag, PH_CONNECT_MIN, PH_CONNECT_MAX), "pH");
  if (phS.connected) phS.value = constrain(phS.diag.voltage * PH_SLOPE + PH_OFFSET, 0.0f, 14.0f);
  delay(2);

  turbS.diag = sampleADC(TURB_PIN); turbS.sampledAtMs = millis();
  trackConnection(turbS, adcLooksConnected(turbS.diag, TURB_CONNECT_MIN, TURB_CONNECT_MAX), "TURB");
  if (turbS.connected)
    turbS.value = constrain((TURB_CLEAR_ADC - turbS.diag.rawAdc) / (TURB_CLEAR_ADC - TURB_DIRTY_ADC) * TURB_DIRTY_NTU, 0.0f, TURB_DIRTY_NTU);
  delay(2);

  orpS.diag = sampleADC(ORP_PIN); orpS.sampledAtMs = millis();
  trackConnection(orpS, adcLooksConnected(orpS.diag, ORP_CONNECT_MIN, ORP_CONNECT_MAX), "ORP");
  if (orpS.connected) orpS.value = orpS.diag.voltage * ORP_SLOPE + ORP_OFFSET;
}

// Non-blocking DS18B20: request now, read on the next cycle (conversion ~750 ms).
void readTemperature() {
  tempS.sampledAtMs = millis();
  if (tempConversionPending) {
    const float t = tempSensor.getTempCByIndex(0);
    trackConnection(tempS, t != DEVICE_DISCONNECTED_C && t > -55.0f && t < 125.0f, "TEMP");
    if (tempS.connected && t != DEVICE_DISCONNECTED_C) tempS.value = t;
  } else {
    trackConnection(tempS, false, "TEMP");
  }
  tempSensor.requestTemperatures();
  tempConversionPending = true;
}

void readUltrasonic() {
  digitalWrite(ULTRASONIC_TRIG, LOW); delayMicroseconds(2);
  digitalWrite(ULTRASONIC_TRIG, HIGH); delayMicroseconds(10);
  digitalWrite(ULTRASONIC_TRIG, LOW);
  const long duration = pulseIn(ULTRASONIC_ECHO, HIGH, 30000);
  const float distance = duration * 0.0343f / 2.0f;
  ultraS.sampledAtMs = millis();
  const bool valid = duration > 0 && distance >= 20.0f && distance <= 800.0f;   // AJ-SR04M blind zone ~20 cm
  trackConnection(ultraS, valid, "ULTR");
  if (ultraS.connected && valid) ultraS.value = distance;
  tankLevelPercent = (ultraS.connected && isfinite(ultraS.value))
    ? constrain((TANK_EMPTY_DISTANCE_CM - ultraS.value) / (TANK_EMPTY_DISTANCE_CM - TANK_FULL_DISTANCE_CM) * 100.0f, 0.0f, 100.0f)
    : NAN;
}

void readSensors() {
  readAnalogSensors();
  readTemperature();
  readUltrasonic();
  evaluateWaterAutomation();
}


// =====================================================
// SIGNED TELEMETRY FRAME
// =====================================================

char framePayload[2048];
char envelopePayload[3072];

bool publishFrame() {
  const uint64_t nowUtc = epochMillis();
  if (!nowUtc || !mqtt.connected()) return false;
  const uint32_t nowMono = millis();

  StaticJsonDocument<2048> frame;
  frame["v"] = 1;
  frame["deviceId"] = DEVICE_ID;
  frame["bootId"] = bootId;
  frame["sequence"] = frameSequence;
  char at[25];
  isoAtAge(nowUtc, 0, at, sizeof(at));
  frame["acquiredAt"] = at;
  JsonObject stamps = frame.createNestedObject("sensorTimestamps");
  JsonObject sensors = frame.createNestedObject("sensors");

  auto add = [&](const char* name, Sensor& s, bool analog) {
    const uint32_t age = nowMono - s.sampledAtMs;
    char ts[25];
    isoAtAge(nowUtc, age, ts, sizeof(ts));
    stamps[name] = ts;
    const bool usable = s.connected && isfinite(s.value) && s.sampledAtMs != 0;
    JsonObject o = sensors.createNestedObject(name);
    o["connected"] = s.connected;
    o["valid"] = usable;
    o["sampleAgeMs"] = age;
    if (analog) {
      o["rawAdc"] = s.diag.rawAdc;
      o["voltage"] = s.diag.voltage;
      o["adcMinimum"] = s.diag.minimum;
      o["adcMaximum"] = s.diag.maximum;
      o["adcLast"] = s.diag.last;
      o["clippedSamples"] = s.diag.clipped;
    }
    // A disconnected sensor reports null, never a stale or invented number.
    if (usable) frame[name] = s.value; else frame[name] = nullptr;
  };
  add("temperature", tempS, false);
  add("ph", phS, true);
  add("orp", orpS, true);
  add("turbidity", turbS, true);
  frame["turbidityUnit"] = "NTU";
  add("ultrasonic", ultraS, false);
  frame.remove("ultrasonic");   // ultrasonic value travels as tankDistanceCm/tankLevelPercent
  const bool tankUsable = ultraS.connected && isfinite(ultraS.value) && isfinite(tankLevelPercent);
  if (tankUsable) { frame["tankDistanceCm"] = ultraS.value; frame["tankLevelPercent"] = tankLevelPercent; }
  else { frame["tankDistanceCm"] = nullptr; frame["tankLevelPercent"] = nullptr; }

  if (frame.overflowed()) { Serial.println("[MQTT] frame overflow"); return false; }
  const size_t frameLen = serializeJson(frame, framePayload, sizeof(framePayload));
  if (frameLen == 0 || frameLen >= sizeof(framePayload) - 1) return false;

  char signature[65];
  if (!hmacHex(framePayload, frameLen, signature)) { Serial.println("[MQTT] signing failed: set DEVICE_KEY"); return false; }

  // Envelope: {"frame":"<frame JSON as a string>","signature":"<hex>"}
  size_t n = strlcpy(envelopePayload, "{\"frame\":\"", sizeof(envelopePayload));
  for (size_t i = 0; i < frameLen && n + 80 < sizeof(envelopePayload); i++) {
    const char c = framePayload[i];
    if (c == '"' || c == '\\') envelopePayload[n++] = '\\';
    envelopePayload[n++] = c;
  }
  n += snprintf(envelopePayload + n, sizeof(envelopePayload) - n, "\",\"signature\":\"%s\"}", signature);

  const bool ok = mqtt.publish(telemetryTopic, (const uint8_t*)envelopePayload, n, false);
  if (ok) frameSequence++;
  else Serial.println("[MQTT] frame publish failed");
  return ok;
}


// =====================================================
// DEVICE STATE (shared by acks and heartbeat)
// =====================================================

void fillState(JsonObject s) {
  s["fillPump"] = fillOn;
  s["drainPump"] = drainOn;
  s["aerator"] = aeratorOn;
  s["feederBusy"] = feederBusy();
  s["buzzer"] = buzzerSounding();
  s["automation"] = waterAutomation;
  s["waterPhase"] = waterPhase;
  s["fault"] = waterFault;
  s["relaysReady"] = RELAYS_COMMISSIONED;
  s["timeValid"] = timeValid();
  s["wifiConnected"] = WiFi.status() == WL_CONNECTED;
  s["mqttConnected"] = mqtt.connected();
  s["uptimeMs"] = millis();
}


// =====================================================
// COMMANDS: verify -> dedupe -> execute -> signed ack
// =====================================================

struct PendingCommand {
  bool used = false;
  char id[37]; char source[10]; char action[24];
  uint32_t durationMs;
};
PendingCommand commandQueue[4];

// Recently handled command IDs and their results, persisted so a reboot cannot
// replay a command the backend re-delivers before it sees the acknowledgement.
struct SeenCommand { char id[37]; char result[32]; };
SeenCommand seen[16];
uint8_t seenNext = 0;

void loadSeen() {
  if (prefs.getBytesLength("seen") == sizeof(seen)) prefs.getBytes("seen", seen, sizeof(seen));
  seenNext = prefs.getUChar("seenNext", 0) % 16;
}

const char* seenResult(const char* id) {
  for (auto& s : seen) if (!strcmp(s.id, id)) return s.result;
  return nullptr;
}

void rememberCommand(const char* id, const char* result) {
  strlcpy(seen[seenNext].id, id, sizeof(seen[seenNext].id));
  strlcpy(seen[seenNext].result, result, sizeof(seen[seenNext].result));
  seenNext = (seenNext + 1) % 16;
  prefs.putBytes("seen", seen, sizeof(seen));
  prefs.putUChar("seenNext", seenNext);
}

bool validUuid(const char* id) {
  if (strlen(id) != 36) return false;
  for (int i = 0; i < 36; i++) {
    const char c = id[i];
    if (i == 8 || i == 13 || i == 18 || i == 23) { if (c != '-') return false; }
    else if (!isxdigit((unsigned char)c)) return false;
  }
  return true;
}

void onMqttMessage(char* topic, uint8_t* payload, unsigned int length) {
  if (strcmp(topic, commandTopic) || length == 0 || length >= 1024) return;
  char input[1024];
  memcpy(input, payload, length);
  input[length] = '\0';

  StaticJsonDocument<768> doc;
  if (deserializeJson(doc, input) || !doc.is<JsonObject>()) return;
  const int v = doc["v"] | 0;
  const char* deviceId = doc["deviceId"] | "";
  const char* id = doc["id"] | "";
  const char* source = doc["source"] | "";
  const char* action = doc["action"] | "";
  const uint32_t durationMs = doc["durationMs"] | 0u;
  const uint64_t expiresAt = doc["expiresAt"] | uint64_t(0);
  const char* signature = doc["signature"] | "";

  if (v != 1 || strcmp(deviceId, DEVICE_ID) || !validUuid(id) ||
      (strcmp(source, "hardware") && strcmp(source, "feeding")) || !action[0] || strlen(action) >= 24) return;

  char canonical[256];
  snprintf(canonical, sizeof(canonical), "v1|%s|%s|%s|%s|%lu|%llu", deviceId, id, source, action,
           (unsigned long)durationMs, (unsigned long long)expiresAt);
  if (!signatureMatches(canonical, signature)) { Serial.println("[CMD] rejected: bad signature"); return; }

  const uint64_t now = epochMillis();
  if (!now || expiresAt <= now || expiresAt - now > COMMAND_MAX_TTL_MS) { Serial.println("[CMD] rejected: expired or clock not set"); return; }

  for (auto& slot : commandQueue) {
    if (slot.used) continue;
    slot.used = true;
    strlcpy(slot.id, id, sizeof(slot.id));
    strlcpy(slot.source, source, sizeof(slot.source));
    strlcpy(slot.action, action, sizeof(slot.action));
    slot.durationMs = durationMs;
    Serial.printf("[CMD] queued %s %s\n", source, action);
    return;
  }
  Serial.println("[CMD] queue full; backend will redeliver");
}

const char* relayGate() { return RELAYS_COMMISSIONED ? nullptr : "rejected_relays_not_commissioned"; }

const char* executeCommand(const PendingCommand& c) {
  const bool feeding = !strcmp(c.source, "feeding");
  const String a = c.action;
  if (feeding) {
    if (a == "TRIGGER") { if (feederBusy()) return "rejected_feeder_busy"; feederTrigger(); return "accepted"; }
    if (a == "ON")      { feederHoldOpen(); return "accepted"; }
    if (a == "OFF")     { feederStop(); suppressFeedingThisMinute(); return "accepted"; }
    return "rejected_unsupported_action";
  }

  if (a == "ALL_OFF") {
    pumpsOff(); exchangeRunning = false; waterAutomation = false;
    if (strcmp(waterPhase, "FAULT")) enterPhase("IDLE", 0);
    aeratorAuto = false; setRelay(RELAY_AERATOR_PIN, false, aeratorOn);
    buzzerManual = false; feederStop(); suppressFeedingThisMinute();
    return "accepted";
  }
  if (a == "WATER_STOP") { waterStop(); return "accepted"; }
  if (a == "CLEAR_FAULT") {
    if (strcmp(waterPhase, "FAULT")) return "rejected_no_fault";
    waterFault[0] = '\0'; enterPhase("IDLE", 0); return "accepted";
  }
  if (a == "BUZZER_ON")  { buzzerManual = true; return "accepted"; }
  if (a == "BUZZER_OFF") { buzzerManual = false; return "accepted"; }

  if (const char* gate = relayGate()) return gate;

  if (a == "AERATOR_ON")  { aeratorAuto = false; setRelay(RELAY_AERATOR_PIN, true, aeratorOn); return "accepted"; }
  if (a == "AERATOR_OFF") { aeratorAuto = false; setRelay(RELAY_AERATOR_PIN, false, aeratorOn); return "accepted"; }
  if (a == "AERATOR_AUTO") {
    if (!AERATOR_POLICY_CONFIGURED) return "rejected_aerator_policy_not_configured";
    aeratorAuto = true; updateAerator(); return "accepted";
  }

  const bool exchangeReady = EXCHANGE_DRAIN_MS > 0 && EXCHANGE_FILL_MS > 0 &&
                             EXCHANGE_DRAIN_MS <= PUMP_HARD_MAX_MS && EXCHANGE_FILL_MS <= PUMP_HARD_MAX_MS;
  if (a == "AUTOMATION_ON") {
    if (!WATER_POLICY_CONFIGURED || !exchangeReady) return "rejected_water_policy_not_configured";
    waterAutomation = true; outOfRangeSamples = 0; return "accepted";
  }
  if (a == "AUTOMATION_OFF") { waterAutomation = false; return "accepted"; }

  if (a == "FILL" || a == "DRAIN" || a == "WATER_EXCHANGE") {
    if (!strcmp(waterPhase, "FAULT")) return "rejected_fault_latched";
    if (waterBusy()) return "rejected_water_busy";
    waterAutomation = false;   // a manual run takes over from automation
    if (a == "WATER_EXCHANGE") {
      if (!exchangeReady) return "rejected_exchange_not_commissioned";
      startExchange(); return "accepted";
    }
    if (c.durationMs < 1 || c.durationMs > PUMP_HARD_MAX_MS) return "rejected_duration_out_of_range";
    if (a == "FILL") startFill(c.durationMs); else startDrain(c.durationMs);
    return "accepted";
  }
  return "rejected_unsupported_action";
}

bool publishAck(const PendingCommand& c, const char* result) {
  const uint64_t reportedAt = epochMillis();
  if (!reportedAt || !mqtt.connected()) return false;

  StaticJsonDocument<768> doc;
  doc["v"] = 1;
  doc["deviceId"] = DEVICE_ID;
  doc["id"] = c.id;
  doc["source"] = c.source;
  doc["action"] = c.action;
  doc["result"] = result;
  doc["reportedAt"] = reportedAt;
  JsonObject s = doc.createNestedObject("state");
  fillState(s);

  char canonical[512];
  snprintf(canonical, sizeof(canonical),
           "v1|%s|%s|%s|%s|%s|%llu|%d|%d|%d|%d|%d|%d|%s|%s|%d|%d|%d|%d|%lu",
           DEVICE_ID, c.id, c.source, c.action, result, (unsigned long long)reportedAt,
           (bool)s["fillPump"], (bool)s["drainPump"], (bool)s["aerator"], (bool)s["feederBusy"],
           (bool)s["buzzer"], (bool)s["automation"], (const char*)s["waterPhase"], (const char*)s["fault"],
           (bool)s["relaysReady"], (bool)s["timeValid"], (bool)s["wifiConnected"], (bool)s["mqttConnected"],
           (unsigned long)(uint32_t)s["uptimeMs"]);
  char signature[65];
  if (!hmacHex(canonical, strlen(canonical), signature)) return false;
  doc["signature"] = signature;

  char out[1024];
  const size_t len = serializeJson(doc, out, sizeof(out));
  return len > 0 && len < sizeof(out) && mqtt.publish(stateTopic, (const uint8_t*)out, len, false);
}

void processCommands() {
  for (auto& c : commandQueue) {
    if (!c.used) continue;
    const char* previous = seenResult(c.id);
    char result[32];
    if (previous) {
      // Redelivery: do not act again, just repeat the original answer.
      strlcpy(result, previous, sizeof(result));
    } else {
      strlcpy(result, executeCommand(c), sizeof(result));
      rememberCommand(c.id, result);
      Serial.printf("[CMD] %s %s -> %s\n", c.source, c.action, result);
    }
    publishAck(c, result);   // if this fails the backend redelivers and we re-ack
    c.used = false;
  }
}


// =====================================================
// HTTP: feeding schedules + state heartbeat
// =====================================================

struct Schedule { char date[11]; char time[6]; };
Schedule schedules[20];
uint8_t scheduleCount = 0;
char lastFedMinute[20] = "";

bool httpEnabled() { return Secrets::BACKEND_HTTP_URL[0] != '\0'; }

void saveSchedules() {
  String packed;
  for (uint8_t i = 0; i < scheduleCount; i++) { packed += schedules[i].date; packed += '|'; packed += schedules[i].time; packed += ';'; }
  prefs.putString("sched", packed);
}

void loadSchedules() {
  const String packed = prefs.getString("sched", "");
  scheduleCount = 0;
  int start = 0;
  while (scheduleCount < 20) {
    const int end = packed.indexOf(';', start);
    if (end < 0) break;
    const String item = packed.substring(start, end);
    const int bar = item.indexOf('|');
    if (bar >= 0) {
      strlcpy(schedules[scheduleCount].date, item.substring(0, bar).c_str(), sizeof(schedules[0].date));
      strlcpy(schedules[scheduleCount].time, item.substring(bar + 1).c_str(), sizeof(schedules[0].time));
      scheduleCount++;
    }
    start = end + 1;
  }
  prefs.getString("lastFed", lastFedMinute, sizeof(lastFedMinute));
  Serial.printf("[FEED] %u schedule(s) loaded from flash\n", scheduleCount);
}

bool httpPost(const char* path, const String& body, String& response) {
  WiFiClient httpClient;   // separate socket: sharing the MQTT client would drop MQTT
  HTTPClient http;
  const String url = String(Secrets::BACKEND_HTTP_URL) + path;
  if (!http.begin(httpClient, url)) return false;
  http.setTimeout(4000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-key", Secrets::DEVICE_KEY);
  const int code = http.POST(body);
  response = code > 0 ? http.getString() : "";
  http.end();
  if (code != 200) Serial.printf("[HTTP] %s -> %d\n", path, code);
  return code == 200;
}

void syncSchedules() {
  String response;
  if (!httpPost("/feeding/device/sync", String("{\"deviceId\":\"") + DEVICE_ID + "\"}", response)) return;
  DynamicJsonDocument doc(4096);
  if (deserializeJson(doc, response)) return;
  JsonArray list = doc["data"]["schedules"].as<JsonArray>();
  if (list.isNull()) return;
  scheduleCount = 0;
  for (JsonObject item : list) {
    if (scheduleCount >= 20) break;
    const char* t = item["time"] | "";
    if (strlen(t) < 5) continue;
    strlcpy(schedules[scheduleCount].time, t, 6);              // "HH:MM"
    strlcpy(schedules[scheduleCount].date, item["date"] | "", 11);  // "" = daily
    scheduleCount++;
  }
  saveSchedules();
  Serial.printf("[FEED] synced %u schedule(s)\n", scheduleCount);
}

void sendStateHeartbeat() {
  StaticJsonDocument<512> doc;
  doc["deviceId"] = DEVICE_ID;
  fillState(doc.createNestedObject("state"));
  String body, response;
  serializeJson(doc, body);
  httpPost("/hardware/device/sync", body, response);
}

void checkSchedules() {
  char date[12], hm[6], minute[20];
  if (!localDateTime(date, sizeof(date), hm, sizeof(hm))) return;   // no clock = no scheduled feeding
  snprintf(minute, sizeof(minute), "%s %s", date, hm);
  if (!strcmp(minute, lastFedMinute) || !strcmp(minute, feedSuppressedMinute)) return;
  for (uint8_t i = 0; i < scheduleCount; i++) {
    const bool dateMatches = schedules[i].date[0] == '\0' || !strcmp(schedules[i].date, date);
    if (dateMatches && !strncmp(schedules[i].time, hm, 5)) {
      strlcpy(lastFedMinute, minute, sizeof(lastFedMinute));
      prefs.putString("lastFed", lastFedMinute);   // survives reboot: no double feed
      Serial.printf("[FEED] scheduled feed %s\n", minute);
      feederTrigger();
      return;
    }
  }
}


// =====================================================
// WI-FI / MQTT
// =====================================================

bool ntpStarted = false;
uint32_t lastWifiAttempt = 0, lastMqttAttempt = 0;

void serviceWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    if (!ntpStarted) {
      configTime(0, 0, "pool.ntp.org", "time.nist.gov", "asia.pool.ntp.org");   // UTC
      ntpStarted = true;
      Serial.printf("[WIFI] connected %s\n", WiFi.localIP().toString().c_str());
    }
    return;
  }
  if (millis() - lastWifiAttempt < WIFI_RETRY_MS) return;
  lastWifiAttempt = millis();
  Serial.println("[WIFI] connecting...");
  WiFi.disconnect();
  WiFi.begin(Secrets::WIFI_SSID, Secrets::WIFI_PASSWORD);
}

void serviceMqtt() {
  if (WiFi.status() != WL_CONNECTED || mqtt.connected()) return;
  if (millis() - lastMqttAttempt < MQTT_RETRY_MS) return;
  lastMqttAttempt = millis();
  char clientId[48];
  snprintf(clientId, sizeof(clientId), "%s-%06lx", DEVICE_ID, (unsigned long)(ESP.getEfuseMac() & 0xFFFFFF));
  Serial.printf("[MQTT] connecting to %s...\n", MQTT_HOST);
  if (mqtt.connect(clientId)) {   // clean session: no stale queued commands
    mqtt.subscribe(commandTopic, 1);
    Serial.printf("[MQTT] connected; listening on %s\n", commandTopic);
  } else {
    Serial.printf("[MQTT] failed, state=%d\n", mqtt.state());
  }
}


// =====================================================
// LCD
// =====================================================

uint8_t lcdPage = 0;

void lcdLine(uint8_t row, const char* text) {
  char buf[LCD_COLS + 1];
  snprintf(buf, sizeof(buf), "%-20.20s", text);
  lcd.setCursor(0, row);
  lcd.print(buf);
}

void updateLCD() {
  if (!lcdPresent) return;
  char b[32];
  if (lcdPage == 0) {
    if (phS.connected) snprintf(b, sizeof(b), "pH   %.2f", phS.value); else snprintf(b, sizeof(b), "pH   --");
    lcdLine(0, b);
    if (tempS.connected) snprintf(b, sizeof(b), "Temp %.2f C", tempS.value); else snprintf(b, sizeof(b), "Temp --");
    lcdLine(1, b);
    if (turbS.connected) snprintf(b, sizeof(b), "Turb %.1f NTU", turbS.value); else snprintf(b, sizeof(b), "Turb --");
    lcdLine(2, b);
    if (orpS.connected) snprintf(b, sizeof(b), "ORP  %.1f mV", orpS.value); else snprintf(b, sizeof(b), "ORP  --");
    lcdLine(3, b);
  } else if (lcdPage == 1) {
    lcdLine(0, "Tank (ultrasonic)");
    if (ultraS.connected) {
      snprintf(b, sizeof(b), "Dist  %.1f cm", ultraS.value); lcdLine(1, b);
      snprintf(b, sizeof(b), "Level %.1f %%", tankLevelPercent); lcdLine(2, b);
    } else { lcdLine(1, "Dist  --"); lcdLine(2, "Level --"); }
    snprintf(b, sizeof(b), "Water %s", waterPhase); lcdLine(3, b);
  } else {
    snprintf(b, sizeof(b), "WiFi %s", WiFi.status() == WL_CONNECTED ? "OK" : "connecting");
    lcdLine(0, b);
    snprintf(b, sizeof(b), "MQTT %s", mqtt.connected() ? "OK" : "connecting");
    lcdLine(1, b);
    char date[12], hm[6];
    if (localDateTime(date, sizeof(date), hm, sizeof(hm))) snprintf(b, sizeof(b), "%s %s", date + 5, hm);
    else snprintf(b, sizeof(b), "Clock not set");
    lcdLine(2, b);
    snprintf(b, sizeof(b), "Aer %s Feed %s", aeratorOn ? "ON" : "off", feederBusy() ? "busy" : "idle");
    lcdLine(3, b);
  }
}


// =====================================================
// SETUP / LOOP
// =====================================================

uint32_t lastSensor = 0, lastFrame = 0, lastLcd = 0, lastPage = 0, lastSchedSync = 0, lastHeartbeat = 0, lastSchedCheck = 0;
bool networkWasUp = false;

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\n=== AquaSense ESP32 ===");

  relaysInit();          // first: outputs safe before anything else
  pwmSetup();
  servoAngle(SERVO_CLOSED_DEG);

  prefs.begin("aquasense", false);
  loadSeen();
  loadSchedules();

  snprintf(bootId, sizeof(bootId), "esp-%08lx", (unsigned long)esp_random());
  snprintf(telemetryTopic, sizeof(telemetryTopic), "%s/devices/%s/telemetry/frame", TELEMETRY_NS, DEVICE_ID);
  snprintf(commandTopic, sizeof(commandTopic), "%s/%s/command", CONTROL_NS, DEVICE_ID);
  snprintf(stateTopic, sizeof(stateTopic), "%s/%s/state", CONTROL_NS, DEVICE_ID);

  Wire.begin(21, 22);
  Wire.beginTransmission(LCD_ADDRESS);
  lcdPresent = Wire.endTransmission() == 0;
  if (lcdPresent) { lcd.begin(LCD_COLS, LCD_ROWS); lcd.backlight(); lcdLine(0, "     AQUASENSE"); lcdLine(1, " Water Quality Mon."); lcdLine(3, "Starting..."); }
  Serial.printf("LCD %s\n", lcdPresent ? "found" : "not found");

  analogReadResolution(12);
  analogSetPinAttenuation(PH_PIN, ADC_11db);
  analogSetPinAttenuation(TURB_PIN, ADC_11db);
  analogSetPinAttenuation(ORP_PIN, ADC_11db);

  tempSensor.begin();
  tempSensor.setWaitForConversion(false);
  tempSensor.requestTemperatures();
  tempConversionPending = true;

  pinMode(ULTRASONIC_TRIG, OUTPUT);
  digitalWrite(ULTRASONIC_TRIG, LOW);
  pinMode(ULTRASONIC_ECHO, INPUT);

  if (strlen(Secrets::DEVICE_KEY) < 32) Serial.println("WARNING: DEVICE_KEY shorter than 32 chars; backend will reject frames");
  if (!RELAYS_COMMISSIONED) Serial.println("Relays disabled (RELAYS_COMMISSIONED=false): relay commands will be rejected");

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setBufferSize(4096);
  mqtt.setCallback(onMqttMessage);
  mqtt.setKeepAlive(30);
}

void loop() {
  const uint32_t now = millis();

  serviceWiFi();
  serviceMqtt();
  mqtt.loop();

  const bool networkUp = WiFi.status() == WL_CONNECTED && mqtt.connected();
  if (networkWasUp && !networkUp && (fillOn || drainOn || exchangeRunning)) {
    // Pumps never run unattended without a control link. The aerator keeps its
    // state so the stock is not left without air during a network blip.
    Serial.println("[WATER] link lost: stopping pumps");
    waterStop();
  }
  networkWasUp = networkUp;

  if (now - lastSensor >= SENSOR_INTERVAL_MS) { lastSensor = now; readSensors(); }
  if (now - lastFrame >= FRAME_INTERVAL_MS) { lastFrame = now; publishFrame(); }

  processCommands();
  updateFeeder();
  updateWater();
  updateAerator();
  updateBuzzer();

  if (now - lastSchedCheck >= 1000) { lastSchedCheck = now; checkSchedules(); }

  // HTTP calls block for up to 4 s, so never while the feeder or pumps move.
  const bool actuatorsIdle = !feederBusy() && !fillOn && !drainOn;
  if (httpEnabled() && WiFi.status() == WL_CONNECTED && actuatorsIdle) {
    if (lastSchedSync == 0 || now - lastSchedSync >= SCHEDULE_SYNC_MS) { lastSchedSync = now; syncSchedules(); }
    else if (now - lastHeartbeat >= STATE_HEARTBEAT_MS) { lastHeartbeat = now; sendStateHeartbeat(); }
  }

  if (now - lastLcd >= LCD_INTERVAL_MS) { lastLcd = now; updateLCD(); }
  if (now - lastPage >= LCD_PAGE_MS) { lastPage = now; lcdPage = (lcdPage + 1) % 3; }
}
