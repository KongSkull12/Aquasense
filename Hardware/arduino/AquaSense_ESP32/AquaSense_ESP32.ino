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
  * Feeding schedules are pulled over HTTP(S) from the backend and kept in
    flash, so scheduled feeds continue during network outages. An https://
    BACKEND_HTTP_URL is verified against RootCerts.h.
  * 20x4 I2C LCD with three rotating pages; a feeder command jumps to the
    status page so the feeder state is visible straight away.
  * Feeder servo: at power-up it moves once to the closed (home) angle and
    its signal is switched off. After that it moves only for Feed now,
    Feeder on, Feeder off or a schedule, and is switched off after each move.
  * Power-up self-test: each relay clicks, with beeps between steps
    ("selftest off" disables it). The servo is not part of it.

  Setup: copy Secrets.example.h to Secrets.h and fill it in. Read the
  "COMMISSIONING" section below before connecting pump power.

  Board: ESP32 Dev Module. Libraries (Arduino Library Manager):
    PubSubClient 2.8, ArduinoJson 6.21.x, OneWire 2.3.8,
    DallasTemperature 3.11.0, LiquidCrystal_I2C 1.1.4, ESP32Servo 3.0.x
*/

#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <LiquidCrystal_I2C.h>
#include <ESP32Servo.h>
#include <mbedtls/md.h>
#include <sys/time.h>
#include <time.h>
#if __has_include(<esp_arduino_version.h>)
#include <esp_arduino_version.h>
#endif
#if __has_include(<esp32-hal-periman.h>)
#include <esp32-hal-periman.h>
#endif
#include "Secrets.h"
#include "RootCerts.h"


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
// Active buzzer: plus to this pin, minus to GND. It sounds while the pin is
// HIGH and is silent while the pin is LOW.

#define LCD_ADDRESS 0x27
#define LCD_COLS    20
#define LCD_ROWS    4


// =====================================================
// COMMISSIONING (read before connecting pump power)
// =====================================================
// Relays stay OFF and every dashboard relay command is rejected until you have
// checked, with pumps and aerator unplugged from mains, that each relay clicks
// for the right channel and that the module is OFF while the ESP32 is in reset.
// Both settings below are only the first-boot defaults: change them from the
// Serial Monitor ("relay mode low|high", "relay enable") and they are saved.
const bool DEFAULT_RELAYS_ENABLED   = false;
const bool DEFAULT_RELAY_ACTIVE_LOW = true;    // most 5 V relay boards switch on a LOW input

// Manual FILL / DRAIN: the dashboard sends a duration (1-60 s); this caps it.
const uint32_t PUMP_HARD_MAX_MS = 60000;
const uint32_t PUMP_COOLDOWN_MS = 10000;

// Optional measured exchange caps. 0 means Run exchange uses the dashboard
// duration (1–60 s) for the drain and again for the fill. A non-zero value
// can only shorten that phase. Automatic exchange still requires both measured.
const uint32_t EXCHANGE_DRAIN_MS    = 0;
const uint32_t EXCHANGE_SETTLING_MS = 0;
const uint32_t EXCHANGE_FILL_MS     = 0;

// AERATOR_AUTO: temperature hysteresis. On at or above AERATOR_ON_ABOVE_C, off at
// or below AERATOR_OFF_BELOW_C. A missing temperature reading turns the aerator
// on. Turn on / Turn off leave automatic mode.
const bool  AERATOR_POLICY_CONFIGURED = true;
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
// "Feeder on" holds the gate open until "Feeder off". This is only a safety
// close in case the OFF command never arrives, so the hopper cannot empty.
const uint32_t FEED_ON_MAX_MS   = 60000;


// =====================================================
// SENSOR CALIBRATION
// =====================================================
// Each sensor uses a straight line after a base conversion:
//   pH  and ORP: value = slope * voltage + offset
//   turbidity:   value = turbSlope * sen0189Curve(voltage) + turbOffset
// SEN0189 (5 V module) curve from the DFRobot example; calibrate with clear
// water (0 NTU) and a known standard. Results are saved in flash (key "cal2").

struct Calibration {
  float phSlope, phOffset;       // pH per volt
  float orpSlope, orpOffset;     // mV per volt
  float turbSlope, turbOffset;   // gain / offset on the voltage→NTU curve
};
const Calibration DEFAULT_CAL = {
  -5.70f, 21.34f,                // pH ≈ 7 near 2.5 V before a buffer capture
  1333.33f, -2000.0f,
  1.0f, 0.0f,                    // start on the SEN0189 curve; calibrate to match your standards
};
Calibration cal = DEFAULT_CAL;
const float TURB_MAX_NTU = 3000.0;
const char* const CAL_NVS_KEY = "cal2";

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
const uint32_t MQTT_RETRY_MS           = 2000;
const uint32_t SCHEDULE_SYNC_MS        = 60000;
const uint32_t STATE_HEARTBEAT_MS      = 10000;   // shorter than the server's online window
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

// Types used in function signatures must be defined before the first function,
// because the Arduino builder inserts function prototypes there.
enum FeederStep { FEED_IDLE, FEED_PRE, FEED_OPEN, FEED_POST, FEED_HOLD_OPEN };

struct PendingCommand {
  bool used = false;
  char id[37]; char source[10]; char action[24];
  uint32_t durationMs;
  char param[25];   // calibration commands only, e.g. "ph:6.86"
};


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

// The feeder servo is driven by ESP32Servo, the same driver as the original
// feeder firmware: hand-rolled LEDC code compiled and reported success on
// this board but the horn never moved, while ESP32Servo moves it. attach(pin)
// uses 544-2400 us, the range SERVO_CLOSED_DEG / SERVO_OPEN_DEG were tuned
// against. After each move the signal is switched off (detach) once the horn
// has arrived, so the servo stops instead of buzzing or creeping between commands.
Servo feederServo;
const uint32_t SERVO_HOLD_MS = 1500;   // time for the horn to reach a new angle
uint32_t servoReleaseAt = 0;           // millis() when to switch the signal off; 0 = nothing pending
bool buzzerOn = false;
bool wifiDiagOff = false;   // serial "wifi off" diagnostic

void buzzerSet(bool on) {
  if (buzzerOn == on) return;
  buzzerOn = on;
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, on ? HIGH : LOW);
}

void buzzerQuiet() { buzzerSet(false); }

bool attachServo() {
  if (feederServo.attached()) return true;
  feederServo.setPeriodHertz(50);
  feederServo.attach(SERVO_PIN);   // returns the channel, which can be 0 on success
  if (!feederServo.attached()) { Serial.println("[SERVO] attach failed on GPIO18"); return false; }
  Serial.printf("[SERVO] feeder servo on GPIO%d (ESP32Servo, 50 Hz)\n", SERVO_PIN);
  return true;
}

bool servoAngle(int degrees) {
  if (!attachServo()) return false;
  feederServo.write(constrain(degrees, 0, 180));
  servoReleaseAt = millis() + SERVO_HOLD_MS;
  if (servoReleaseAt == 0) servoReleaseAt = 1;
  return true;
}

void servoRelease() {
  servoReleaseAt = 0;
  if (!feederServo.attached()) return;
  feederServo.detach();
  Serial.println("[SERVO] signal off (servo stopped)");
}

// Saved in flash (see loadRelaySettings); defaults used on first boot.
bool relaysEnabled  = DEFAULT_RELAYS_ENABLED;
bool relayActiveLow = DEFAULT_RELAY_ACTIVE_LOW;
bool selfTestEnabled = true;   // power-up self-test, see BOOT SELF-TEST

int relayLevel(bool on) { return (on == relayActiveLow) ? LOW : HIGH; }

bool aeratorOn = false, fillOn = false, drainOn = false;

// Drives the pin regardless of the enable gate; used by setRelay and bench tests.
void writeRelay(int pin, bool on) { digitalWrite(pin, relayLevel(on)); }

void setRelay(int pin, bool on, bool& state) {
  if (!relaysEnabled) on = false;
  writeRelay(pin, on);
  state = on;
}

void allRelaysOff() {
  setRelay(RELAY_AERATOR_PIN, false, aeratorOn);
  setRelay(RELAY_FILL_PIN, false, fillOn);
  setRelay(RELAY_DRAIN_PIN, false, drainOn);
}

void relaysInit() {
  // Drive the OFF level before switching to output so no relay blips at boot.
  for (int pin : {RELAY_AERATOR_PIN, RELAY_FILL_PIN, RELAY_DRAIN_PIN}) {
    digitalWrite(pin, relayLevel(false));
    pinMode(pin, OUTPUT);
    digitalWrite(pin, relayLevel(false));
  }
}

void loadRelaySettings() {
  relaysEnabled = prefs.getBool("relayEn", DEFAULT_RELAYS_ENABLED);
  relayActiveLow = prefs.getBool("relayLow", DEFAULT_RELAY_ACTIVE_LOW);
}


// =====================================================
// FEEDER
// =====================================================

FeederStep feederStep = FEED_IDLE;
uint32_t feederStepAt = 0;
char feedSuppressedMinute[20] = "";   // OFF / ALL_OFF block a scheduled feed in this minute
bool feederStateChanged = false;      // shows the LCD status page on the next loop

bool feederBusy() { return feederStep != FEED_IDLE; }

const char* feederStateText() {
  if (feederStep == FEED_IDLE) return "closed";
  return feederStep == FEED_HOLD_OPEN ? "OPEN" : "FEEDING";
}

bool feederStart(FeederStep step, int angle) {
  const FeederStep previous = feederStep;
  feederStep = step;
  feederStepAt = millis();
  if (servoAngle(angle)) {
    if (step != previous) { feederStateChanged = true; Serial.printf("[FEED] feeder %s\n", feederStateText()); }
    return true;
  }
  feederStep = previous;
  return false;
}

// Feed now: closed -> open -> closed, once.
bool feederTrigger() { return !feederBusy() && feederStart(FEED_PRE, SERVO_CLOSED_DEG); }
// Feeder on: open and stay open until Feeder off (or the FEED_ON_MAX_MS safety close).
bool feederHoldOpen() { return feederStart(FEED_HOLD_OPEN, SERVO_OPEN_DEG); }
// Feeder off: close now, also cancelling a feed cycle that is running.
bool feederStop() {
  if (!servoAngle(SERVO_CLOSED_DEG)) return false;
  if (feederStep != FEED_IDLE) { feederStep = FEED_IDLE; feederStateChanged = true; Serial.println("[FEED] feeder closed"); }
  return true;
}

void updateFeeder() {
  const uint32_t elapsed = millis() - feederStepAt;
  switch (feederStep) {
    case FEED_PRE:       if (elapsed >= FEED_PRE_MS) feederStart(FEED_OPEN, SERVO_OPEN_DEG); break;
    case FEED_OPEN:      if (elapsed >= FEED_OPEN_MS) feederStart(FEED_POST, SERVO_CLOSED_DEG); break;
    case FEED_POST:
      if (elapsed >= FEED_POST_MS) { feederStep = FEED_IDLE; feederStateChanged = true; Serial.println("[FEED] feed cycle done"); }
      break;
    case FEED_HOLD_OPEN:
      if (elapsed >= FEED_ON_MAX_MS) { Serial.println("[FEED] safety close: no Feeder off within 60 s"); feederStop(); }
      break;
    default: break;
  }
  // Stop the servo once it has reached its angle and is resting (closed, or held open).
  if (servoReleaseAt && (int32_t)(millis() - servoReleaseAt) >= 0 &&
      (feederStep == FEED_IDLE || feederStep == FEED_HOLD_OPEN)) servoRelease();
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

uint32_t exchangeFillMs = 0;

// A measured target shortens the request. It never extends it, and never past the hard cap.
uint32_t cappedRunMs(uint32_t requested, uint32_t commissioned) {
  if (requested < 1 || requested > PUMP_HARD_MAX_MS) return 0;
  if (commissioned > PUMP_HARD_MAX_MS) return 0;
  if (commissioned > 0) return min(requested, commissioned);
  return requested;
}

void startExchange(uint32_t drainMs, uint32_t fillMs) {
  exchangeFillMs = fillMs;
  exchangeRunning = true;
  startDrain(drainMs);
}

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
    if (exchangeFillMs < 1 || exchangeFillMs > PUMP_HARD_MAX_MS) { waterFaultLatch("fill_timeout"); return; }
    startFill(exchangeFillMs);
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
    startExchange(EXCHANGE_DRAIN_MS, EXCHANGE_FILL_MS);
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
  if (!buzzerSounding()) { buzzerQuiet(); return; }
  // The buzzer has its own tone. Fault: fast beeps. Manual: slow beeps.
  const bool fault = !strcmp(waterPhase, "FAULT");
  const uint32_t period = fault ? 400 : 1000, onFor = fault ? 200 : 150;
  buzzerSet((millis() % period) < onFor);
}


// =====================================================
// SENSORS
// =====================================================

// DFRobot SEN0189 example (5 V powered module). Output voltage falls as water
// gets cloudier. Clamp after the curve; calibration gain/offset refine it.
// Defined here, after the GLOBALS types: the Arduino builder inserts function
// prototypes before the first function in the file.
float turbidityFromVoltage(float volts) {
  if (!isfinite(volts) || volts < 0.05f) return NAN;
  float ntu = (-1120.4f * volts * volts) + (5742.3f * volts) - 4352.9f;
  if (ntu < 0.0f) ntu = 0.0f;
  if (ntu > TURB_MAX_NTU) ntu = TURB_MAX_NTU;
  return ntu;
}

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
  if (phS.connected) {
    // Mild Nernst correction when temperature is available (slope rated near 25 °C).
    float slope = cal.phSlope;
    if (tempS.connected && isfinite(tempS.value) && tempS.value > -5.0f && tempS.value < 60.0f) {
      slope = cal.phSlope * (298.15f / (tempS.value + 273.15f));
    }
    phS.value = constrain(phS.diag.voltage * slope + cal.phOffset, 0.0f, 14.0f);
  }
  delay(2);

  turbS.diag = sampleADC(TURB_PIN); turbS.sampledAtMs = millis();
  // Prefer characterized volts: a powered SEN0189 sits well above ~0.4 V.
  const bool turbOk = isfinite(turbS.diag.voltage)
    && turbS.diag.voltage >= 0.40f && turbS.diag.voltage <= 3.10f
    && (turbS.diag.maximum - turbS.diag.minimum) <= STABILITY_MAX_DEV;
  trackConnection(turbS, turbOk, "TURB");
  if (turbS.connected) {
    const float curve = turbidityFromVoltage(turbS.diag.voltage);
    if (isfinite(curve)) turbS.value = constrain(cal.turbSlope * curve + cal.turbOffset, 0.0f, TURB_MAX_NTU);
    else turbS.value = NAN;
  }
  delay(2);

  orpS.diag = sampleADC(ORP_PIN); orpS.sampledAtMs = millis();
  trackConnection(orpS, adcLooksConnected(orpS.diag, ORP_CONNECT_MIN, ORP_CONNECT_MAX), "ORP");
  if (orpS.connected) orpS.value = orpS.diag.voltage * cal.orpSlope + cal.orpOffset;
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
  s["aeratorAuto"] = aeratorAuto;
  s["feederBusy"] = feederBusy();
  s["buzzer"] = buzzerSounding();
  s["automation"] = waterAutomation;
  s["waterPhase"] = waterPhase;
  s["fault"] = waterFault;
  s["relaysReady"] = relaysEnabled;
  s["timeValid"] = timeValid();
  s["wifiConnected"] = WiFi.status() == WL_CONNECTED;
  s["mqttConnected"] = mqtt.connected();
  s["uptimeMs"] = millis();
}


// =====================================================
// COMMANDS: verify -> dedupe -> execute -> signed ack
// =====================================================

PendingCommand commandQueue[4];

// Recently handled command IDs and their results, persisted so a reboot cannot
// replay a command the backend re-delivers before it sees the acknowledgement.
struct SeenCommand { char id[37]; char result[64]; };
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
  const char* param = doc["param"] | "";   // optional; signed when present

  if (v != 1 || strcmp(deviceId, DEVICE_ID) || !validUuid(id) ||
      (strcmp(source, "hardware") && strcmp(source, "feeding")) || !action[0] || strlen(action) >= 24 ||
      strlen(param) > 24) return;

  char canonical[256];
  int len = snprintf(canonical, sizeof(canonical), "v1|%s|%s|%s|%s|%lu|%llu", deviceId, id, source, action,
                     (unsigned long)durationMs, (unsigned long long)expiresAt);
  if (doc.containsKey("param") && len > 0) snprintf(canonical + len, sizeof(canonical) - len, "|%s", param);
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
    strlcpy(slot.param, param, sizeof(slot.param));
    Serial.printf("[CMD] queued %s %s%s%s\n", source, action, param[0] ? " " : "", param);
    return;
  }
  Serial.println("[CMD] queue full; backend will redeliver");
}

const char* relayGate() { return relaysEnabled ? nullptr : "rejected_relays_not_commissioned"; }

const char* executeCommand(const PendingCommand& c) {
  const bool feeding = !strcmp(c.source, "feeding");
  const String a = c.action;
  if (feeding) {
    if (a == "TRIGGER") {
      if (feederBusy()) return "rejected_feeder_busy";
      return feederTrigger() ? "accepted" : "rejected_servo_pwm";
    }
    if (a == "ON")  return feederHoldOpen() ? "accepted" : "rejected_servo_pwm";
    if (a == "OFF") { suppressFeedingThisMinute(); return feederStop() ? "accepted" : "rejected_servo_pwm"; }
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

  // Dashboard sensor calibration: no relays involved, so it is not behind the relay gate.
  if (a.startsWith("CAL_")) {
    static char calResult[64];
    runCalibrationCommand(c.action, c.param, calResult, sizeof(calResult));
    return calResult;
  }

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
      const uint32_t drainMs = cappedRunMs(c.durationMs, EXCHANGE_DRAIN_MS);
      const uint32_t fillMs = cappedRunMs(c.durationMs, EXCHANGE_FILL_MS);
      if (!drainMs || !fillMs) return "rejected_duration_out_of_range";
      startExchange(drainMs, fillMs); return "accepted";
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
           "v1|%s|%s|%s|%s|%s|%llu|%d|%d|%d|%d|%d|%d|%s|%s|%d|%d|%d|%d|%lu|%d",
           DEVICE_ID, c.id, c.source, c.action, result, (unsigned long long)reportedAt,
           (bool)s["fillPump"], (bool)s["drainPump"], (bool)s["aerator"], (bool)s["feederBusy"],
           (bool)s["buzzer"], (bool)s["automation"], (const char*)s["waterPhase"], (const char*)s["fault"],
           (bool)s["relaysReady"], (bool)s["timeValid"], (bool)s["wifiConnected"], (bool)s["mqttConnected"],
           (unsigned long)(uint32_t)s["uptimeMs"], (bool)s["aeratorAuto"]);
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
    char result[64];
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

uint32_t httpHoldoffUntil = 0;
uint32_t httpBackoffMs = 0;

bool httpPost(const char* path, const String& body, String& response) {
  // Separate sockets from MQTT: sharing the MQTT client would drop MQTT.
  // A hosted backend (https://, e.g. Render) is verified against RootCerts.h.
  const bool https = !strncmp(Secrets::BACKEND_HTTP_URL, "https://", 8);
  WiFiClient plainClient;
  WiFiClientSecure secureClient;
  if (https) { secureClient.setCACert(BACKEND_ROOT_CAS); secureClient.setTimeout(8); }
  else plainClient.setTimeout(3);   // seconds; a dead LAN address must not stall MQTT for minutes
  WiFiClient& httpClient = https ? static_cast<WiFiClient&>(secureClient) : plainClient;
  HTTPClient http;
  const String url = String(Secrets::BACKEND_HTTP_URL) + path;
  if (!http.begin(httpClient, url)) return false;
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  // TLS handshakes take 1-2 s on the ESP32; plain LAN calls stay short.
  http.setConnectTimeout(https ? 8000 : 2500);
  http.setTimeout(https ? 8000 : 2500);
#else
  // Core 2 passes this value straight through to WiFiClient as seconds.
  http.setTimeout(https ? 8 : 3);
#endif
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-key", Secrets::DEVICE_KEY);
  const int code = http.POST(body);
  response = code > 0 ? http.getString() : "";
  http.end();
  if (code == 200) { httpBackoffMs = 0; httpHoldoffUntil = 0; return true; }
  Serial.printf("[HTTP] %s -> %d\n", path, code);
  httpBackoffMs = httpBackoffMs == 0 ? 15000 : min<uint32_t>(httpBackoffMs * 2, 120000u);
  httpHoldoffUntil = millis() + httpBackoffMs;
  return false;
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
// CALIBRATION CONSOLE (Serial Monitor, 115200 baud, "Newline")
// =====================================================
// Put the probe in a reference solution, wait for the reading to settle, then
// type e.g. "ph 7". The firmware averages ~3 s of samples, records the point,
// and once it has two or more points fits a new line and saves it.

float phPtX[3], phPtY[3];     uint8_t phPts = 0;
float orpPtX[3], orpPtY[3];   uint8_t orpPts = 0;
float turbPtX[3], turbPtY[3]; uint8_t turbPts = 0;
bool calWatch = false;
uint32_t lastWatchPrint = 0;
char serialLine[64];
uint8_t serialLen = 0;

void loadCalibration() {
  if (prefs.getBytesLength(CAL_NVS_KEY) == sizeof(Calibration)) {
    prefs.getBytes(CAL_NVS_KEY, &cal, sizeof(cal));
    return;
  }
  // Older "cal" blob used ADC counts for turbidity — keep pH/ORP, reset turb defaults.
  if (prefs.getBytesLength("cal") == sizeof(Calibration)) {
    prefs.getBytes("cal", &cal, sizeof(cal));
    cal.turbSlope = DEFAULT_CAL.turbSlope;
    cal.turbOffset = DEFAULT_CAL.turbOffset;
    prefs.putBytes(CAL_NVS_KEY, &cal, sizeof(cal));
  }
}

void saveCalibration() { prefs.putBytes(CAL_NVS_KEY, &cal, sizeof(cal)); }

void printCalibration() {
  Serial.println("---- calibration (value = slope * input + offset) ----");
  Serial.printf("pH   : slope %.4f pH/V   offset %.4f   (%.1f mV per pH)\n", cal.phSlope, cal.phOffset, cal.phSlope != 0 ? 1000.0f / fabsf(cal.phSlope) : 0.0f);
  Serial.printf("ORP  : slope %.3f mV/V   offset %.2f mV\n", cal.orpSlope, cal.orpOffset);
  Serial.printf("Turb : gain %.4f × SEN0189(V) + offset %.3f NTU\n", cal.turbSlope, cal.turbOffset);
  Serial.printf("Captured points: pH %u, ORP %u, turbidity %u\n", phPts, orpPts, turbPts);
}

void printWatchLine() {
  Serial.printf("pH  V=%.4f -> %s | ", phS.diag.voltage, phS.connected ? String(phS.value, 2).c_str() : "--");
  Serial.printf("Turb V=%.3f ADC=%d -> %s NTU | ", turbS.diag.voltage, turbS.diag.rawAdc, turbS.connected ? String(turbS.value, 1).c_str() : "--");
  Serial.printf("ORP V=%.4f -> %s mV\n", orpS.diag.voltage, orpS.connected ? String(orpS.value, 1).c_str() : "--");
}

void printHelp() {
  Serial.println();
  Serial.println("==== AquaSense calibration (Serial Monitor: 115200 baud, Newline) ====");
  Serial.println("watch           toggle a live line of input + value every second");
  Serial.println("show            print the current calibration");
  Serial.println("ph <value>      one buffer corrects offset now; a second buffer fits the slope (e.g. ph 6.86 then ph 4.01)");
  Serial.println("orp <mV>        record an ORP standard, e.g.  orp 225  (1 point = offset only)");
  Serial.println("turb <NTU>      clear water: turb 0; then a known standard: turb 100 (uses probe voltage)");
  Serial.println("clear ph|orp|turb      forget captured points (keeps saved calibration)");
  Serial.println("reset ph|orp|turb|all  restore factory defaults and save");
  Serial.println("set ph|orp|turb <slope> <offset>   type a calibration in directly");
  Serial.println("Rinse the probe between solutions and wait until 'watch' is steady before capturing.");
  Serial.println();
  Serial.println("==== Relays and feeder (bench tests) ====");
  Serial.println("relay                  show relay settings and pin levels");
  Serial.println("relay test             switch aerator, fill, drain ON for 2 s each, one at a time");
  Serial.println("relay mode low|high    set trigger type (saved). Use 'high' if loads run while 'off'");
  Serial.println("relay aerator|fill|drain on|off   switch one relay (pumps auto-stop after 10 s)");
  Serial.println("relay enable|disable   allow / block dashboard relay commands (saved)");
  Serial.println("servo <degrees>        move the feeder servo, e.g. servo 140 then servo 25");
  Serial.println("feed                   run one feed cycle locally (no dashboard needed)");
  Serial.println("selftest               run the boot self-test now (relays, servo, buzzer)");
  Serial.println("selftest on|off        run it at every power-up or not (saved)");
}

// Bench pump test: auto-off so a pump can never be left running from the console.
int benchPumpPin = -1;
uint32_t benchPumpOffAt = 0;
const uint32_t BENCH_PUMP_MAX_MS = 10000;

void printRelayStatus() {
  Serial.printf("Relays %s, %s trigger (OFF = %s, ON = %s)\n", relaysEnabled ? "ENABLED" : "disabled",
                relayActiveLow ? "active-LOW" : "active-HIGH", relayLevel(false) ? "HIGH" : "LOW", relayLevel(true) ? "HIGH" : "LOW");
  const int pins[] = {RELAY_AERATOR_PIN, RELAY_FILL_PIN, RELAY_DRAIN_PIN};
  const char* names[] = {"aerator", "fill", "drain"};
  for (int i = 0; i < 3; i++) {
    const int level = digitalRead(pins[i]);
    Serial.printf("  %-7s GPIO%-2d pin %s -> relay %s\n", names[i], pins[i], level ? "HIGH" : "LOW", level == relayLevel(true) ? "ON" : "off");
  }
}

void restoreRelayOutputs() {
  writeRelay(RELAY_AERATOR_PIN, relaysEnabled && aeratorOn);
  writeRelay(RELAY_FILL_PIN, relaysEnabled && fillOn);
  writeRelay(RELAY_DRAIN_PIN, relaysEnabled && drainOn);
}

void relayTest() {
  if (fillOn || drainOn || waterBusy()) { Serial.println("Stop the pumps first (water phase must be IDLE)."); return; }
  const int pins[] = {RELAY_AERATOR_PIN, RELAY_FILL_PIN, RELAY_DRAIN_PIN};
  const char* names[] = {"AERATOR", "FILL", "DRAIN"};
  Serial.println("Relay test: watch the relay LEDs and listen for clicks.");
  allRelaysOff();
  restoreRelayOutputs();
  delay(500);
  for (int i = 0; i < 3; i++) {
    Serial.printf("  %s (GPIO%d) ON for 2 s...\n", names[i], pins[i]);
    writeRelay(pins[i], true);
    for (int t = 0; t < 20; t++) { mqtt.loop(); delay(100); }
    writeRelay(pins[i], false);
    Serial.printf("  %s off\n", names[i]);
    for (int t = 0; t < 10; t++) { mqtt.loop(); delay(100); }
  }
  restoreRelayOutputs();
  Serial.println("Done. If a relay was ON when it should be off (or the reverse), type: relay mode high");
  Serial.println("If the relay LED follows correctly but the load does not, the load is wired to NC instead of NO.");
}

void handleRelayCommand(String rest) {
  if (!rest.length()) { printRelayStatus(); return; }
  if (rest == "test") { relayTest(); return; }
  if (rest.startsWith("mode")) {
    String m = rest.substring(4); m.trim();
    if (m != "low" && m != "high") { Serial.println("Use: relay mode low|high"); return; }
    relayActiveLow = (m == "low");
    prefs.putBool("relayLow", relayActiveLow);
    restoreRelayOutputs();
    Serial.printf("Saved: %s trigger.\n", relayActiveLow ? "active-LOW" : "active-HIGH");
    printRelayStatus();
    return;
  }
  if (rest == "enable" || rest == "disable") {
    relaysEnabled = (rest == "enable");
    prefs.putBool("relayEn", relaysEnabled);
    if (!relaysEnabled) { waterStop(); aeratorAuto = false; allRelaysOff(); }
    Serial.printf("Saved: dashboard relay commands %s.\n", relaysEnabled ? "ALLOWED" : "blocked");
    return;
  }
  const int sp = rest.indexOf(' ');
  const String which = sp < 0 ? rest : rest.substring(0, sp);
  String state = sp < 0 ? "" : rest.substring(sp + 1); state.trim();
  const int pin = which == "aerator" ? RELAY_AERATOR_PIN : which == "fill" ? RELAY_FILL_PIN : which == "drain" ? RELAY_DRAIN_PIN : -1;
  if (pin < 0 || (state != "on" && state != "off")) { Serial.println("Use: relay aerator|fill|drain on|off"); return; }
  const bool on = state == "on";
  if (pin != RELAY_AERATOR_PIN && on) {
    if (fillOn || drainOn || waterBusy()) { Serial.println("A pump run is already active."); return; }
    writeRelay(pin == RELAY_FILL_PIN ? RELAY_DRAIN_PIN : RELAY_FILL_PIN, false);   // never both pumps
    benchPumpPin = pin; benchPumpOffAt = millis() + BENCH_PUMP_MAX_MS;
  }
  if (pin == benchPumpPin && !on) benchPumpPin = -1;
  writeRelay(pin, on);
  if (pin == RELAY_AERATOR_PIN) aeratorOn = on && relaysEnabled;
  Serial.printf("%s relay %s%s\n", which.c_str(), on ? "ON" : "off", (pin != RELAY_AERATOR_PIN && on) ? " (auto-off in 10 s)" : "");
}

void serviceBenchPump() {
  if (benchPumpPin >= 0 && (int32_t)(millis() - benchPumpOffAt) >= 0) {
    writeRelay(benchPumpPin, false);
    Serial.printf("Bench pump on GPIO%d auto-stopped.\n", benchPumpPin);
    benchPumpPin = -1;
  }
}

// Average ~3 s of readings; refuse if the input is still drifting.
bool captureInput(int pin, bool useRaw, float maxSpread, float& mean) {
  const int n = 30;
  float sum = 0, lo = 1e9f, hi = -1e9f;
  Serial.print("Sampling 3 s, keep the probe still");
  for (int i = 0; i < n; i++) {
    const AnalogDiag d = sampleADC(pin);
    const float x = useRaw ? float(d.rawAdc) : d.voltage;
    sum += x; lo = min(lo, x); hi = max(hi, x);
    if (i % 6 == 0) Serial.print('.');
    mqtt.loop();
    delay(80);
  }
  mean = sum / n;
  const float spread = hi - lo;
  Serial.printf(" mean %s=%.4f spread %.4f\n", useRaw ? "ADC" : "V", mean, spread);
  if (spread > maxSpread) {
    Serial.printf("Not steady (spread above %.3f). Wait for the reading to settle and try again.\n", maxSpread);
    return false;
  }
  return true;
}

bool fitLine(const float* x, const float* y, uint8_t n, float& slope, float& offset) {
  float sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (uint8_t i = 0; i < n; i++) { sx += x[i]; sy += y[i]; sxx += x[i] * x[i]; sxy += x[i] * y[i]; }
  const float d = n * sxx - sx * sx;
  if (fabsf(d) < 1e-9f) return false;
  slope = (n * sxy - sx * sy) / d;
  offset = (sy - slope * sx) / n;
  return true;
}

// Keep up to 3 points; a new point at the same reference replaces the old one.
uint8_t addPoint(float* xs, float* ys, uint8_t count, float x, float y, float sameRef) {
  for (uint8_t i = 0; i < count; i++) if (fabsf(ys[i] - y) <= sameRef) { xs[i] = x; ys[i] = y; return count; }
  if (count == 3) { for (uint8_t i = 0; i < 2; i++) { xs[i] = xs[i + 1]; ys[i] = ys[i + 1]; } count = 2; }
  xs[count] = x; ys[count] = y;
  return count + 1;
}

float inputRange(const float* xs, uint8_t n) {
  float lo = xs[0], hi = xs[0];
  for (uint8_t i = 1; i < n; i++) { lo = min(lo, xs[i]); hi = max(hi, xs[i]); }
  return hi - lo;
}

// Result codes are shared with the dashboard (via the signed acknowledgement),
// so keep them short (< 64 chars) and stable.
void setResult(char* out, size_t size, const char* text) { if (out && size) strlcpy(out, text, size); }

void calibrate(const String& sensor, float reference, char* result, size_t resultSize) {
  if (feederBusy() || fillOn || drainOn) { Serial.println("Wait until the feeder and pumps are idle."); setResult(result, resultSize, "rejected_busy"); return; }
  float mean = 0;
  uint8_t points = 0;
  if (sensor == "ph") {
    if (reference < 0 || reference > 14) { Serial.println("pH buffer must be 0-14."); setResult(result, resultSize, "rejected_out_of_range"); return; }
    if (!phS.connected) Serial.println("Warning: pH input currently looks disconnected.");
    if (!captureInput(PH_PIN, false, 0.02f, mean)) { setResult(result, resultSize, "rejected_not_steady"); return; }
    phPts = points = addPoint(phPtX, phPtY, phPts, mean, reference, 0.05f);
    Serial.printf("Recorded pH %.2f at %.4f V (%u point%s)\n", reference, mean, phPts, phPts > 1 ? "s" : "");
    if (phPts < 2) {
      // One buffer: keep the Nernst-ish slope, correct offset so this solution reads true now.
      cal.phOffset = reference - cal.phSlope * mean;
      saveCalibration();
      Serial.println("Offset saved from this buffer. Rinse and capture a second buffer (e.g. ph 4.01) to fit the slope.");
      printCalibration();
      if (result) snprintf(result, resultSize, "saved n=1 slope=%.5f offset=%.4f", cal.phSlope, cal.phOffset);
      return;
    }
    float slope, offset;
    if (inputRange(phPtX, phPts) < 0.05f || !fitLine(phPtX, phPtY, phPts, slope, offset)) {
      Serial.println("Buffers gave almost the same voltage: check the probe and buffers.");
      setResult(result, resultSize, "rejected_same_input"); return;
    }
    const float mvPerPh = 1000.0f / fabsf(slope);
    if (mvPerPh < 30 || mvPerPh > 400) {
      Serial.printf("Rejected: %.1f mV per pH is not plausible. Check buffers and wiring.\n", mvPerPh);
      setResult(result, resultSize, "rejected_implausible_slope"); return;
    }
    cal.phSlope = slope; cal.phOffset = offset;
  } else if (sensor == "orp") {
    if (reference < -2000 || reference > 2000) { Serial.println("ORP standard must be -2000..2000 mV."); setResult(result, resultSize, "rejected_out_of_range"); return; }
    if (!captureInput(ORP_PIN, false, 0.02f, mean)) { setResult(result, resultSize, "rejected_not_steady"); return; }
    orpPts = points = addPoint(orpPtX, orpPtY, orpPts, mean, reference, 5.0f);
    Serial.printf("Recorded ORP %.1f mV at %.4f V (%u point%s)\n", reference, mean, orpPts, orpPts > 1 ? "s" : "");
    float slope = cal.orpSlope, offset;
    if (orpPts >= 2 && inputRange(orpPtX, orpPts) >= 0.05f && fitLine(orpPtX, orpPtY, orpPts, slope, offset)) {
      if (fabsf(slope) < 100 || fabsf(slope) > 5000) {
        Serial.printf("Rejected: slope %.1f mV/V is not plausible.\n", slope);
        setResult(result, resultSize, "rejected_implausible_slope"); return;
      }
    } else {
      offset = reference - cal.orpSlope * mean;   // one point: keep the slope, correct the offset
      Serial.println("Single point: offset corrected, slope kept.");
    }
    cal.orpSlope = slope; cal.orpOffset = offset;
  } else if (sensor == "turb") {
    if (reference < 0 || reference > TURB_MAX_NTU) { Serial.println("Turbidity standard must be 0-3000 NTU."); setResult(result, resultSize, "rejected_out_of_range"); return; }
    // Fit against the SEN0189 voltage curve, not raw ADC counts.
    if (!captureInput(TURB_PIN, false, 0.05f, mean)) { setResult(result, resultSize, "rejected_not_steady"); return; }
    if (mean < 0.40f) {
      Serial.println("Turbidity voltage is too low. Check 5 V power, the A/D mode switch (must be Analog), and wiring to GPIO34.");
      setResult(result, resultSize, "rejected_turb_voltage_low"); return;
    }
    const float curve = turbidityFromVoltage(mean);
    if (!isfinite(curve)) { setResult(result, resultSize, "rejected_turb_curve"); return; }
    turbPts = points = addPoint(turbPtX, turbPtY, turbPts, curve, reference, 0.5f);
    Serial.printf("Recorded %.1f NTU at %.3f V (curve %.1f NTU, %u point%s)\n", reference, mean, curve, turbPts, turbPts > 1 ? "s" : "");
    float slope = cal.turbSlope, offset;
    if (turbPts >= 2 && inputRange(turbPtX, turbPts) >= 5.0f && fitLine(turbPtX, turbPtY, turbPts, slope, offset)) {
      if (slope <= 0) Serial.println("Note: fitted gain is not positive. Check that clear water is 0 NTU and the dirty standard is higher.");
    } else {
      offset = reference - cal.turbSlope * curve;
      Serial.println("Single point: offset corrected, gain kept. Add a second standard (e.g. turb 100) for a full calibration.");
    }
    cal.turbSlope = slope; cal.turbOffset = offset;
  } else {
    Serial.println("Unknown sensor. Use ph, orp or turb.");
    setResult(result, resultSize, "rejected_bad_param");
    return;
  }
  saveCalibration();
  Serial.println("Saved.");
  printCalibration();
  float slope = 0, offset = 0;
  calibrationOf(sensor, slope, offset);
  if (result) snprintf(result, resultSize, "saved n=%u slope=%.5f offset=%.4f", points, slope, offset);
}

// Current slope/offset for one sensor; false for an unknown name.
bool calibrationOf(const String& sensor, float& slope, float& offset) {
  if (sensor == "ph") { slope = cal.phSlope; offset = cal.phOffset; return true; }
  if (sensor == "orp") { slope = cal.orpSlope; offset = cal.orpOffset; return true; }
  if (sensor == "turb") { slope = cal.turbSlope; offset = cal.turbOffset; return true; }
  return false;
}

uint8_t capturedPoints(const String& sensor) { return sensor == "ph" ? phPts : sensor == "orp" ? orpPts : sensor == "turb" ? turbPts : 0; }

// Dashboard calibration commands: CAL_CAPTURE "<sensor>:<reference>", CAL_STATUS/CAL_CLEAR/CAL_RESET "<sensor>".
void runCalibrationCommand(const char* action, const char* param, char* result, size_t resultSize) {
  String p = param; p.trim(); p.toLowerCase();
  const int colon = p.indexOf(':');
  const String sensor = colon < 0 ? p : p.substring(0, colon);
  float slope = 0, offset = 0;
  if (!calibrationOf(sensor, slope, offset)) { setResult(result, resultSize, "rejected_bad_param"); return; }
  if (!strcmp(action, "CAL_CAPTURE")) {
    if (colon < 0) { setResult(result, resultSize, "rejected_bad_param"); return; }
    calibrate(sensor, p.substring(colon + 1).toFloat(), result, resultSize);
    return;
  }
  if (!strcmp(action, "CAL_CLEAR")) {
    if (sensor == "ph") phPts = 0; else if (sensor == "orp") orpPts = 0; else turbPts = 0;
    setResult(result, resultSize, "cleared");
    return;
  }
  if (!strcmp(action, "CAL_RESET")) {
    if (sensor == "ph") { cal.phSlope = DEFAULT_CAL.phSlope; cal.phOffset = DEFAULT_CAL.phOffset; phPts = 0; }
    else if (sensor == "orp") { cal.orpSlope = DEFAULT_CAL.orpSlope; cal.orpOffset = DEFAULT_CAL.orpOffset; orpPts = 0; }
    else { cal.turbSlope = DEFAULT_CAL.turbSlope; cal.turbOffset = DEFAULT_CAL.turbOffset; turbPts = 0; }
    saveCalibration();
    calibrationOf(sensor, slope, offset);
    snprintf(result, resultSize, "reset n=0 slope=%.5f offset=%.4f", slope, offset);
    return;
  }
  // CAL_STATUS
  snprintf(result, resultSize, "status n=%u slope=%.5f offset=%.4f", capturedPoints(sensor), slope, offset);
}

void handleSerialCommand(String line) {
  line.trim();
  line.toLowerCase();
  if (!line.length()) return;
  const int sp1 = line.indexOf(' ');
  const String cmd = sp1 < 0 ? line : line.substring(0, sp1);
  String rest = sp1 < 0 ? "" : line.substring(sp1 + 1);
  rest.trim();

  if (cmd == "help" || cmd == "?") { printHelp(); return; }
  if (cmd == "show") { printCalibration(); printWatchLine(); return; }
  if (cmd == "watch") { calWatch = !calWatch; Serial.printf("watch %s\n", calWatch ? "on" : "off"); return; }
  if (cmd == "ph" || cmd == "orp" || cmd == "turb") {
    if (!rest.length()) { Serial.printf("Give the reference value, e.g. %s\n", cmd == "ph" ? "ph 7" : cmd == "orp" ? "orp 225" : "turb 0"); return; }
    calibrate(cmd, rest.toFloat(), nullptr, 0);
    return;
  }
  if (cmd == "clear") {
    if (rest == "ph") phPts = 0; else if (rest == "orp") orpPts = 0; else if (rest == "turb") turbPts = 0;
    else { Serial.println("Use: clear ph|orp|turb"); return; }
    Serial.println("Captured points cleared.");
    return;
  }
  if (cmd == "reset") {
    if (rest == "ph" || rest == "all") { cal.phSlope = DEFAULT_CAL.phSlope; cal.phOffset = DEFAULT_CAL.phOffset; phPts = 0; }
    if (rest == "orp" || rest == "all") { cal.orpSlope = DEFAULT_CAL.orpSlope; cal.orpOffset = DEFAULT_CAL.orpOffset; orpPts = 0; }
    if (rest == "turb" || rest == "all") { cal.turbSlope = DEFAULT_CAL.turbSlope; cal.turbOffset = DEFAULT_CAL.turbOffset; turbPts = 0; }
    if (rest != "ph" && rest != "orp" && rest != "turb" && rest != "all") { Serial.println("Use: reset ph|orp|turb|all"); return; }
    saveCalibration();
    printCalibration();
    return;
  }
  if (cmd == "set") {
    const int sp2 = rest.indexOf(' ');
    const int sp3 = sp2 < 0 ? -1 : rest.indexOf(' ', sp2 + 1);
    if (sp2 < 0 || sp3 < 0) { Serial.println("Use: set ph|orp|turb <slope> <offset>"); return; }
    const String which = rest.substring(0, sp2);
    const float slope = rest.substring(sp2 + 1, sp3).toFloat();
    const float offset = rest.substring(sp3 + 1).toFloat();
    if (slope == 0) { Serial.println("Slope cannot be 0."); return; }
    if (which == "ph") { cal.phSlope = slope; cal.phOffset = offset; }
    else if (which == "orp") { cal.orpSlope = slope; cal.orpOffset = offset; }
    else if (which == "turb") { cal.turbSlope = slope; cal.turbOffset = offset; }
    else { Serial.println("Use: set ph|orp|turb <slope> <offset>"); return; }
    saveCalibration();
    printCalibration();
    return;
  }
  if (cmd == "relay") { handleRelayCommand(rest); return; }
  if (cmd == "servo") {
    if (!rest.length()) { Serial.println("Use: servo <0-180>"); return; }
    feederStep = FEED_IDLE;
    const int deg = constrain(rest.toInt(), 0, 180);
    servoAngle(deg);
    Serial.printf("Servo -> %d degrees on GPIO%d. No movement? Check the servo's own 5-6 V supply (2 A+) and that its GND joins the ESP32 GND.\n", deg, SERVO_PIN);
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
    // What the pin is really doing: owner, PWM frequency and duty (14-bit of 20 ms).
    Serial.printf("[SERVO] GPIO%d owner=%s freq=%lu Hz duty=%lu pulse=%lu us attached=%d\n", SERVO_PIN,
                  perimanGetTypeName(perimanGetPinBusType(SERVO_PIN)), (unsigned long)ledcReadFreq(SERVO_PIN),
                  (unsigned long)ledcRead(SERVO_PIN), (unsigned long)feederServo.readMicroseconds(), feederServo.attached());
#endif
    return;
  }
  if (cmd == "wifi") {
    // Diagnostic: "wifi off" stops WiFi (and MQTT) until reboot, to test whether
    // the servo moves without WiFi's current draw. "wifi on" reconnects.
    if (rest == "off") { mqtt.disconnect(); WiFi.disconnect(true); WiFi.mode(WIFI_OFF); wifiDiagOff = true; Serial.println("WiFi OFF. Try: servo 140 / servo 25"); return; }
    if (rest == "on")  { wifiDiagOff = false; WiFi.mode(WIFI_STA); Serial.println("WiFi reconnecting."); return; }
    Serial.println("Use: wifi off|on");
    return;
  }
  if (cmd == "feed") {
    if (feederBusy()) { Serial.println("Feeder is busy."); return; }
    feederTrigger();
    Serial.printf("Feed cycle: %d -> %d -> %d degrees.\n", SERVO_CLOSED_DEG, SERVO_OPEN_DEG, SERVO_CLOSED_DEG);
    return;
  }
  if (cmd == "selftest") {
    if (rest == "on" || rest == "off") {
      selfTestEnabled = rest == "on";
      prefs.putBool("selfTest", selfTestEnabled);
      Serial.printf("Saved: boot self-test %s.\n", selfTestEnabled ? "ON" : "off");
      return;
    }
    if (feederBusy() || fillOn || drainOn || waterBusy()) { Serial.println("Wait until the feeder and pumps are idle."); return; }
    feederStep = FEED_IDLE;
    runSelfTest();
    return;
  }
  Serial.println("Unknown command. Type: help");
}

void serviceSerial() {
  while (Serial.available()) {
    const char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (serialLen) { serialLine[serialLen] = '\0'; handleSerialCommand(String(serialLine)); serialLen = 0; }
    } else if (serialLen < sizeof(serialLine) - 1) {
      serialLine[serialLen++] = c;
    }
  }
  if (calWatch && millis() - lastWatchPrint >= 1000) { lastWatchPrint = millis(); printWatchLine(); }
}


// =====================================================
// WI-FI / MQTT
// =====================================================

bool ntpStarted = false;
uint32_t lastWifiAttempt = 0, lastMqttAttempt = 0;

void serviceWiFi() {
  if (wifiDiagOff) return;
  if (WiFi.status() == WL_CONNECTED) {
    WiFi.setSleep(false);   // modem sleep drops MQTT while the router still lists the ESP32
    if (!ntpStarted) {
      configTime(0, 0, "pool.ntp.org", "time.nist.gov", "asia.pool.ntp.org");   // UTC
      ntpStarted = true;
      Serial.printf("[WIFI] connected %s\n", WiFi.localIP().toString().c_str());
    }
    return;
  }
  if (millis() - lastWifiAttempt < WIFI_RETRY_MS || WiFi.status() == WL_IDLE_STATUS) return;
  lastWifiAttempt = millis();
  Serial.println("[WIFI] connecting...");
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
    snprintf(b, sizeof(b), "MQTT %-10s Aer %s", mqtt.connected() ? "OK" : "connecting", aeratorOn ? "ON" : "off");
    lcdLine(1, b);
    char date[12], hm[6];
    if (localDateTime(date, sizeof(date), hm, sizeof(hm))) snprintf(b, sizeof(b), "%s %s", date + 5, hm);
    else snprintf(b, sizeof(b), "Clock not set");
    lcdLine(2, b);
    snprintf(b, sizeof(b), "Feeder: %s", feederStateText());
    lcdLine(3, b);
  }
}


// =====================================================
// BOOT SELF-TEST (relays, buzzer) and FEEDER HOMING
// =====================================================
// Every power-up homes the feeder: one move to SERVO_CLOSED_DEG, then the
// signal is switched off. The self-test then beeps and clicks each relay (one
// at a time, never both pumps); it is skipped after a crash, watchdog or
// brown-out, and "selftest off" disables it. The servo is not swept at boot:
// it moves only for dashboard commands, schedules, or the serial "feed" /
// "servo" / "servo sweep" commands.

const uint32_t SELF_TEST_RELAY_MS = 500;

bool homeFeederServo() {
  Serial.printf("[SERVO] homing feeder to %d degrees (closed)\n", SERVO_CLOSED_DEG);
  if (lcdPresent) lcdLine(2, "Feeder: homing");
  if (!servoAngle(SERVO_CLOSED_DEG)) {
    Serial.println("[SERVO] 50 Hz PWM did not start on GPIO18; feeder disabled.");
    if (lcdPresent) lcdLine(2, "Feeder: servo fail");
    return false;
  }
  delay(SERVO_HOLD_MS);
  servoRelease();
  feederStep = FEED_IDLE;
  if (lcdPresent) lcdLine(2, "Feeder: closed");
  return true;
}

// Manual check from the Serial Monitor ("servo sweep"): closed -> open -> closed.
bool sweepFeederServo() {
  Serial.printf("[TEST] feeder servo GPIO%d: %d -> %d -> %d degrees\n",
                SERVO_PIN, SERVO_CLOSED_DEG, SERVO_OPEN_DEG, SERVO_CLOSED_DEG);
  if (lcdPresent) lcdLine(1, "Feeder servo");
  const int angles[] = {SERVO_CLOSED_DEG, SERVO_OPEN_DEG, SERVO_CLOSED_DEG};
  const uint32_t holdMs[] = {700, SERVO_HOLD_MS, SERVO_HOLD_MS};
  for (int i = 0; i < 3; i++) {
    if (!servoAngle(angles[i])) {
      Serial.println("[TEST] servo NOT tested: 50 Hz PWM did not start on GPIO18.");
      return false;
    }
    Serial.printf("[TEST] servo at %d degrees\n", angles[i]);
    delay(holdMs[i]);
  }
  servoRelease();
  Serial.println("[TEST] feeder servo sweep finished");
  return true;
}

void testBeep(uint32_t ms) {
  buzzerSet(true);
  delay(ms);
  buzzerQuiet();
}

bool selfTestAfterThisReset() {
  const esp_reset_reason_t r = esp_reset_reason();
  return r == ESP_RST_POWERON || r == ESP_RST_EXT || r == ESP_RST_SW;
}

void runSelfTest() {
  const int pins[] = {RELAY_AERATOR_PIN, RELAY_FILL_PIN, RELAY_DRAIN_PIN};
  const char* names[] = {"Aerator", "Fill pump", "Drain pump"};
  char b[24];
  Serial.println("[TEST] self-test: feeder servo, then buzzer and relays");
  if (lcdPresent) { lcd.clear(); lcdLine(0, "Self-test"); }
  buzzerQuiet();
  const bool servoOk = sweepFeederServo();

  testBeep(150); delay(100); testBeep(150); delay(300);

  for (int i = 0; i < 3; i++) {
    snprintf(b, sizeof(b), "Relay: %s", names[i]);
    if (lcdPresent) lcdLine(1, b);
    Serial.printf("[TEST] %s relay (GPIO%d) ON\n", names[i], pins[i]);
    testBeep(80);
    writeRelay(pins[i], true);
    delay(SELF_TEST_RELAY_MS);
    writeRelay(pins[i], false);
    delay(300);
  }

  restoreRelayOutputs();
  if (lcdPresent) lcdLine(1, servoOk ? "Done" : "Servo failed");
  testBeep(100); delay(80); testBeep(100);
  buzzerQuiet();
  if (!servoOk) {
    Serial.println("[TEST] servo did not move. Use a separate 5-6 V supply for the SG90 and join its GND to the ESP32 GND.");
  } else {
    Serial.println("[TEST] done. A relay that did not click needs checking.");
  }
}


// =====================================================
// SETUP / LOOP
// =====================================================

uint32_t lastSensor = 0, lastFrame = 0, lastLcd = 0, lastPage = 0, lastSchedSync = 0, lastHeartbeat = 0, lastSchedCheck = 0;
bool networkWasUp = false;

void setup() {
  buzzerQuiet();   // first: the active buzzer stays off until a beep is requested
  Serial.begin(115200);
  delay(300);
  Serial.println("\n=== AquaSense ESP32 ===");

  prefs.begin("aquasense", false);
  loadRelaySettings();   // polarity must be known before driving the relay pins
  relaysInit();          // outputs safe before anything else
  buzzerQuiet();
  // Park the feeder closed straight away so the gate never floats at boot. The
  // signal stays on from here, which keeps the horn at a known angle.
  if (!servoAngle(SERVO_CLOSED_DEG)) Serial.println("[SERVO] 50 Hz PWM did not start on GPIO18; feeder disabled.");
  loadSeen();
  loadSchedules();
  loadCalibration();
  printCalibration();
  Serial.println("Type 'help' for sensor calibration commands.");

  snprintf(bootId, sizeof(bootId), "esp-%08lx", (unsigned long)esp_random());
  snprintf(telemetryTopic, sizeof(telemetryTopic), "%s/devices/%s/telemetry/frame", TELEMETRY_NS, DEVICE_ID);
  snprintf(commandTopic, sizeof(commandTopic), "%s/%s/command", CONTROL_NS, DEVICE_ID);
  snprintf(stateTopic, sizeof(stateTopic), "%s/%s/state", CONTROL_NS, DEVICE_ID);

  Wire.begin(21, 22);
  Wire.beginTransmission(LCD_ADDRESS);
  lcdPresent = Wire.endTransmission() == 0;
  if (lcdPresent) { lcd.begin(LCD_COLS, LCD_ROWS); lcd.backlight(); lcdLine(0, "     AQUASENSE"); lcdLine(1, " Water Quality Mon."); lcdLine(3, "Starting..."); }
  Serial.printf("LCD %s\n", lcdPresent ? "found" : "not found");

  selfTestEnabled = prefs.getBool("selfTest", true);
  const bool servoNeverTested = !prefs.getBool("servoBoot", false);
  if (selfTestEnabled && selfTestAfterThisReset()) runSelfTest();
  else if (selfTestEnabled && servoNeverTested) {
    Serial.printf("[TEST] first boot (reset %d): testing the feeder servo. Relays stay off.\n", (int)esp_reset_reason());
    if (lcdPresent) { lcd.clear(); lcdLine(0, "Self-test"); }
    if (!sweepFeederServo()) {
      Serial.println("[TEST] servo did not move. Use a separate 5-6 V supply for the SG90 and join its GND to the ESP32 GND.");
    }
  } else {
    // The servo was already parked closed above.
    Serial.printf("[TEST] boot self-test skipped (%s, reset %d)\n",
                  selfTestEnabled ? "restart after a fault" : "disabled", (int)esp_reset_reason());
  }
  buzzerQuiet();

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
  Serial.printf("Relays: %s, %s trigger. Test with 'relay test' (see 'help').\n",
                relaysEnabled ? "ENABLED" : "disabled (dashboard relay commands rejected)", relayActiveLow ? "active-LOW" : "active-HIGH");

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.setSleep(false);
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setBufferSize(4096);
  mqtt.setCallback(onMqttMessage);
  mqtt.setKeepAlive(30);
  mqtt.setSocketTimeout(3);
}

void loop() {
  const uint32_t now = millis();

  serviceWiFi();
  serviceMqtt();
  mqtt.loop();
  serviceSerial();
  serviceBenchPump();

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
  if (httpEnabled() && WiFi.status() == WL_CONNECTED && actuatorsIdle && (int32_t)(now - httpHoldoffUntil) >= 0) {
    if (lastSchedSync == 0 || now - lastSchedSync >= SCHEDULE_SYNC_MS) { lastSchedSync = now; syncSchedules(); }
    else if (now - lastHeartbeat >= STATE_HEARTBEAT_MS) { lastHeartbeat = now; sendStateHeartbeat(); }
  }

  if (feederStateChanged) {
    // Jump to the status page (feeder line) and keep it up for a full page interval.
    feederStateChanged = false;
    lcdPage = 2; lastPage = now; lastLcd = now; updateLCD();
  }
  if (now - lastLcd >= LCD_INTERVAL_MS) { lastLcd = now; updateLCD(); }
  if (now - lastPage >= LCD_PAGE_MS) { lastPage = now; lcdPage = (lcdPage + 1) % 3; }
}
