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
#include "AquaSenseTypes.h"


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

// Manual FILL / DRAIN: the dashboard sends a duration (1–600 s); this caps it.
const uint32_t PUMP_HARD_MAX_MS = 600000;   // 10 minutes hard safety ceiling
const uint32_t PUMP_COOLDOWN_MS = 10000;

// Optional measured exchange caps. 0 means Run exchange uses the dashboard
// duration (1–600 s) for the drain and again for the fill. A non-zero value
// can only shorten that phase. Automatic exchange sizes its own runs from the
// tank volume and measured flows below ('exchange' command), not from these.
const uint32_t EXCHANGE_DRAIN_MS    = 0;
const uint32_t EXCHANGE_SETTLING_MS = 0;
const uint32_t EXCHANGE_FILL_MS     = 0;

// AERATOR_AUTO: temperature hysteresis. On at or above AERATOR_ON_ABOVE_C, off at
// or below AERATOR_OFF_BELOW_C. A missing temperature reading turns the aerator
// on. Turn on / Turn off leave automatic mode.
const bool  AERATOR_POLICY_CONFIGURED = true;
const float AERATOR_ON_ABOVE_C  = 29.5;
const float AERATOR_OFF_BELOW_C = 28.5;

// AUTOMATION_ON: automatic partial water exchange (AquaSense exchange policy).
//   Normal   -> 0%   no draining, keep monitoring
//   Warning  -> 5%   partial exchange, keep monitoring
//   Critical -> 10%  urgent partial exchange + aerator on (the backend sends the SMS)
// The level comes from the dashboard Thresholds for temperature, pH and turbidity.
// Water depth never starts a drain. Run times come from the tank volume and the
// measured pump flow rates set with the 'exchange' Serial Monitor command.
const float    WARNING_EXCHANGE_PERCENT  = 5.0f;
const float    CRITICAL_EXCHANGE_PERCENT = 10.0f;   // policy range 10-15%
const uint32_t AUTO_EXCHANGE_CONFIRM_READS = 60;    // ~1 min of out-of-range readings first
const uint32_t WARNING_EXCHANGE_GAP_MS  = 6UL * 3600UL * 1000UL;   // time between automatic exchanges
const uint32_t CRITICAL_EXCHANGE_GAP_MS = 2UL * 3600UL * 1000UL;
const float    MAX_AUTO_EXCHANGE_PERCENT_PER_DAY = 30.0f;          // never more than this in 24 h

// Measured installation values for automatic exchange (saved in NVS).
struct ExchangeSetup { float tankVolumeL, drainLpm, fillLpm; };
const ExchangeSetup DEFAULT_EXCHANGE_SETUP = { NAN, NAN, NAN };
const char* const EXCHANGE_NVS_KEY = "xchg1";

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
// pH (PH-4502C PO):   pH = phSlope * Vsensor + phOffset
//   phSlope is pH per volt (typically negative). Optional Nernst scaling of that
//   pH/V slope uses 298.15/T_K (electrode mV/pH grows with T, so pH/V shrinks).
// ORP (SEN0165):      ORP_mV = 400*Vmodule - 1000*Vsensor - orpOffset
//   Manufacturer circuit equation (wiki SEN0165). orpSlope is unused (kept for
//   NVS layout compatibility with cal2). orpOffset is the DFRobot OFFSET.
// Turbidity (DFRobot SEN0189): NTU = turbSlope * curve(Vsensor) + turbOffset
//   curve() is the manufacturer polynomial, valid from 2.5 V (very dirty) to about
//   4.2 V (clear). turbSlope is a gain and turbOffset an NTU correction on top of it.
// Saved under "cal2" (same struct size). calVer NVS tracks formula migrations.

struct Calibration {
  float phSlope, phOffset;       // pH per volt, pH
  float orpSlope, orpOffset;     // orpSlope unused (SEN0165); orpOffset = OFFSET mV
  float turbSlope, turbOffset;   // gain, NTU (applied to the SEN0189 curve)
};
const Calibration DEFAULT_CAL = {
  -5.70f, 21.34f,                // provisional PH-4502C; replace with three buffer captures
  0.0f, 0.0f,                    // SEN0165: OFFSET 0 until zero/reference calibration
  1.0f, 0.0f,                    // SEN0189: manufacturer curve until a reference is captured
};
Calibration cal = DEFAULT_CAL;
const float TURB_MAX_NTU = 3000.0;      // top of the SEN0189 curve
const float TURB_CURVE_MIN_V = 2.5f;    // the polynomial turns back on itself below this voltage
const char* const CAL_NVS_KEY = "cal2";
const char* const CAL_VER_KEY = "calVer";
const uint8_t CAL_FORMULA_VERSION = 5;   // 4 = three-point pH fit; 5 = SEN0189 turbidity curve

// Analog front-end: 5 V modules into ESP32 ADC. Divider ratios are UNVERIFIED
// until measured. ratio = Vsensor / Vadc = (Rtop + Rbot) / Rbot when sensing
// across Rbot to GND. 1.0 means "no divider / measure board output directly".
// HARDWARE ISSUE REQUIRING INSPECTION: confirm each channel cannot exceed ~3.3 V.
struct AnalogFrontEnd {
  float phDivider;
  float orpDivider;
  float turbDivider;
  float orpModuleSupplyV;   // SEN0165 board supply; DFRobot accuracy needs ~5.00 V
};
const AnalogFrontEnd DEFAULT_AFE = { 1.0f, 1.0f, 1.0f, 5.00f };
AnalogFrontEnd afe = DEFAULT_AFE;
const char* const AFE_NVS_KEY = "afe1";
// Explicit Serial "afe ph|orp|turb <ratio>" marks the channel commissioned.
// Default ratio 1.0 alone is not enough — that blocked accidental calibration
// before resistors were measured. Ratio 1.0 is allowed once commissioned
// (direct PO→GPIO with no divider, after you confirm the pin stays ≤ ~3.3 V).
struct AfeCommission {
  uint8_t ph;
  uint8_t orp;
  uint8_t turb;
  uint8_t reserved;
};
const AfeCommission DEFAULT_AFE_COMMISSION = { 0, 0, 0, 0 };
AfeCommission afeOk = DEFAULT_AFE_COMMISSION;
const char* const AFE_OK_NVS_KEY = "afeOk1";
bool phUserCalibrated = false;
bool orpUserCalibrated = false;
bool turbUserCalibrated = false;

// Temperature: the DS18B20 is factory calibrated, so this correction is optional
// (°C = tempSlope * sensor °C + tempOffset). Saved under its own key so adding it
// leaves the "cal2" blob, and the pH/ORP/turbidity calibration in it, untouched.
struct TempCalibration { float slope, offset; };
const TempCalibration DEFAULT_TEMP_CAL = {1.0f, 0.0f};
TempCalibration tempCal = DEFAULT_TEMP_CAL;
const char* const TEMP_CAL_NVS_KEY = "calT";
float tempRawC = NAN;   // last uncorrected DS18B20 reading

// Fallback percent mapping when mount height is not calibrated yet.
const float TANK_FULL_DISTANCE_CM  = 10.0;
const float TANK_EMPTY_DISTANCE_CM = 100.0;

// Depth calibration: waterDepthCm = mountHeightCm - distanceCm.
// mountHeightCm is the sensor-to-bottom air gap (capture with the tub empty).
// targetDepthCm is the desired water column (e.g. 3 cm for a crayfish tub).
struct TankCalibration {
  float mountHeightCm;   // NAN until empty capture
  float targetDepthCm;
  float stopHysteresisCm;
};
const TankCalibration DEFAULT_TANK_CAL = { NAN, 3.0f, 0.2f };
TankCalibration tankCal = DEFAULT_TANK_CAL;
const char* const TANK_NVS_KEY = "tank1";
float tankDepthCm = NAN;
bool fillToTargetActive = false;

// Water-quality alarm types (used by the buzzer section below).
struct ThresholdBand { float alertMin, normalMin, normalMax, alertMax; };
struct ThresholdBandSet { ThresholdBand temperature, ph, turbidity, waterDepth; };
enum AlarmLevel : uint8_t { ALARM_NORMAL = 0, ALARM_WARNING = 1, ALARM_ALERT = 2 };

bool tankMountCalibrated() { return isfinite(tankCal.mountHeightCm) && tankCal.mountHeightCm >= 20.0f && tankCal.mountHeightCm <= 800.0f; }
bool tankTargetConfigured() { return isfinite(tankCal.targetDepthCm) && tankCal.targetDepthCm > 0.0f && tankCal.targetDepthCm <= 200.0f; }
void loadTankCalibration();
void saveTankCalibration();
void printTankCalibration();

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
const uint32_t LCD_PAGE_MS             = 10000;  // hold each page longer so readings are readable
const uint32_t LCD_SENSOR_PAGE_MS      = 12000;  // water-quality page stays up a bit longer
const uint32_t LCD_ACTIVITY_PAGE_MS    = 2000;   // while pumps run, refresh the activity page often
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
uint32_t outOfRangeSamples = 0;
bool automationSaved = false;              // last waterAutomation value written to NVS
ExchangeSetup exchangeSetup = DEFAULT_EXCHANGE_SETUP;
AlarmLevel qualityLevelNow = ALARM_NORMAL; // this read: temperature, pH, turbidity (no depth)
AlarmLevel exchangeLevel = ALARM_NORMAL;   // the same, confirmed for ~1 min; drives exchange and aerator
uint32_t exchangeWindowStart = 0;          // 24 h budget for automatic exchanges
float exchangePercentInWindow = 0.0f;
bool exchangeWindowOpen = false;

bool exchangeCommissioned() {
  const ExchangeSetup& x = exchangeSetup;
  return isfinite(x.tankVolumeL) && x.tankVolumeL >= 1.0f && x.tankVolumeL <= 5000.0f
    && isfinite(x.drainLpm) && x.drainLpm >= 0.05f && x.drainLpm <= 200.0f
    && isfinite(x.fillLpm) && x.fillLpm >= 0.05f && x.fillLpm <= 200.0f;
}

// Pump run time to move `percent` of the tank volume, or 0 if outside 1 s .. hard max.
uint32_t exchangeRunMs(float percent, float litersPerMinute) {
  if (!exchangeCommissioned()) return 0;
  const float ms = exchangeSetup.tankVolumeL * percent / 100.0f / litersPerMinute * 60000.0f;
  return (ms >= 1000.0f && ms <= (float)PUMP_HARD_MAX_MS) ? (uint32_t)ms : 0;
}

void loadExchangeSetup() {
  ExchangeSetup stored;
  if (prefs.getBytesLength(EXCHANGE_NVS_KEY) == sizeof(stored)
      && prefs.getBytes(EXCHANGE_NVS_KEY, &stored, sizeof(stored)) == sizeof(stored)) exchangeSetup = stored;
}

void saveExchangeSetup() { prefs.putBytes(EXCHANGE_NVS_KEY, &exchangeSetup, sizeof(exchangeSetup)); }

void enterPhase(const char* phase, uint32_t durationMs) { waterPhase = phase; phaseStartedAt = millis(); phaseDurationMs = durationMs; }

void pumpsOff() { setRelay(RELAY_FILL_PIN, false, fillOn); setRelay(RELAY_DRAIN_PIN, false, drainOn); }

void waterFaultLatch(const char* reason) {
  pumpsOff();
  exchangeRunning = false;
  fillToTargetActive = false;
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
  fillToTargetActive = false;
  waterAutomation = false;
  if (strcmp(waterPhase, "FAULT")) enterPhase(wasRunning ? "COOLDOWN" : "IDLE", wasRunning ? PUMP_COOLDOWN_MS : 0);
}

void startDrain(uint32_t ms) { fillToTargetActive = false; setRelay(RELAY_FILL_PIN, false, fillOn); setRelay(RELAY_DRAIN_PIN, true, drainOn); enterPhase("DRAINING", ms); }
void startFill(uint32_t ms)  { fillToTargetActive = false; setRelay(RELAY_DRAIN_PIN, false, drainOn); setRelay(RELAY_FILL_PIN, true, fillOn); enterPhase("REFILLING", ms); }

// User-started closed-loop fill: stops at target depth, bad echo, or hard max.
void startFillToTarget(uint32_t maxMs) {
  fillToTargetActive = true;
  setRelay(RELAY_DRAIN_PIN, false, drainOn);
  setRelay(RELAY_FILL_PIN, true, fillOn);
  enterPhase("REFILLING", maxMs);
}

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

  // Fill-to-target: stop when depth reaches the calibrated target (or abort on bad echo).
  if (fillToTargetActive && !strcmp(waterPhase, "REFILLING") && fillOn) {
    if (!ultraS.connected || !isfinite(ultraS.value) || !isfinite(tankDepthCm)) {
      pumpsOff();
      fillToTargetActive = false;
      waterFaultLatch("fill_target_no_echo");
      return;
    }
    const float stopAt = tankCal.targetDepthCm - (isfinite(tankCal.stopHysteresisCm) ? tankCal.stopHysteresisCm : 0.2f);
    if (tankDepthCm >= stopAt) {
      setRelay(RELAY_FILL_PIN, false, fillOn);
      fillToTargetActive = false;
      enterPhase("COOLDOWN", PUMP_COOLDOWN_MS);
      Serial.printf("[WATER] fill-to-target reached depth %.2f cm\n", tankDepthCm);
      return;
    }
  }

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
    fillToTargetActive = false;
    enterPhase("COOLDOWN", PUMP_COOLDOWN_MS);
  } else if (!strcmp(waterPhase, "COOLDOWN")) {
    enterPhase(exchangeRunning ? "COMPLETE" : "IDLE", 0);
    exchangeRunning = false;
  }
}

// The automatic exchange decision (evaluateWaterAutomation) lives after the
// water-quality alarm below, because it uses the alarm's Normal/Warning/Critical level.


// =====================================================
// AERATOR / BUZZER
// =====================================================

bool aeratorAuto = false;
bool buzzerManual = false;
bool aeratorForcedByAlarm = false;   // Critical water quality switched the aerator on
bool aeratorOnBeforeForce = false;

void updateAerator() {
  // Exchange policy: Critical water quality with automation on keeps the aerator
  // running until the water recovers, then hands back to its previous mode.
  if (waterAutomation && exchangeLevel == ALARM_ALERT && relaysEnabled) {
    if (!aeratorForcedByAlarm) {
      aeratorForcedByAlarm = true;
      aeratorOnBeforeForce = aeratorOn;
      Serial.println("[AIR] critical water quality: aerator ON");
    }
    if (!aeratorOn) setRelay(RELAY_AERATOR_PIN, true, aeratorOn);
    return;
  }
  if (aeratorForcedByAlarm) {
    aeratorForcedByAlarm = false;
    Serial.println("[AIR] water quality no longer critical: aerator back to its previous mode");
    if (!aeratorAuto && !aeratorOnBeforeForce) setRelay(RELAY_AERATOR_PIN, false, aeratorOn);
  }
  if (!aeratorAuto) return;
  // Invalid or missing temperature turns the aerator on (fail-safe for stock).
  if (!tempS.connected || !isfinite(tempS.value)) { if (!aeratorOn) setRelay(RELAY_AERATOR_PIN, true, aeratorOn); return; }
  if (tempS.value >= AERATOR_ON_ABOVE_C && !aeratorOn) setRelay(RELAY_AERATOR_PIN, true, aeratorOn);
  else if (tempS.value <= AERATOR_OFF_BELOW_C && aeratorOn) setRelay(RELAY_AERATOR_PIN, false, aeratorOn);
}

// ---- Water-quality alarm -------------------------------------------------
// Uses the same Normal / Warning / Alert limits as the dashboard Thresholds
// page. The backend sends the saved limits with each heartbeat and the last
// copy is kept in NVS, so the alarm also works without Wi-Fi. NAN = no limit.
// ThresholdBand, ThresholdBandSet and AlarmLevel are declared near the tank
// calibration types so the Arduino-generated prototypes can see them.
// Keep in step with DEFAULT_THRESHOLD_BANDS in Backend/src/services/thresholdBands.ts.
const ThresholdBandSet DEFAULT_THRESHOLD_BANDS = {
  { 15.0f, 26.0f, 29.0f, 32.0f },   // temperature, C
  {  6.0f,  7.0f,  8.5f,  8.5f },   // pH
  {   NAN,   NAN, 70.0f, 100.0f },  // turbidity, NTU (upper limits only)
  {  2.0f,  2.7f,  3.3f,  4.0f },   // water depth, cm
};
ThresholdBandSet thresholdBands = DEFAULT_THRESHOLD_BANDS;
const char* const BANDS_NVS_KEY = "bands1";

const uint8_t ALARM_CONFIRM_READS = 5;   // ~5 s at one read per second: one noisy sample never beeps
AlarmLevel alarmLevel = ALARM_NORMAL;      // confirmed level; this drives the buzzer
AlarmLevel alarmCandidate = ALARM_NORMAL;
uint8_t alarmCandidateCount = 0;
uint32_t alarmPatternStart = 0;
bool alarmEnabled = true;                  // 'alarm off' silences it until 'alarm on' or a reboot
char alarmReason[40] = "";

const char* alarmLevelName(AlarmLevel level) {
  return level == ALARM_ALERT ? "ALERT" : level == ALARM_WARNING ? "WARNING" : "NORMAL";
}

AlarmLevel classifyBand(float value, const ThresholdBand& b) {
  if (!isfinite(value)) return ALARM_NORMAL;
  if (isfinite(b.alertMin) && value < b.alertMin) return ALARM_ALERT;
  if (isfinite(b.alertMax) && value > b.alertMax) return ALARM_ALERT;
  if (isfinite(b.normalMin) && value < b.normalMin) return ALARM_WARNING;
  if (isfinite(b.normalMax) && value > b.normalMax) return ALARM_WARNING;
  return ALARM_NORMAL;
}

// Same ordering rules the backend enforces before it saves a band.
bool thresholdBandValid(const ThresholdBand& b, bool highOnly) {
  if (!isfinite(b.normalMax) || !isfinite(b.alertMax) || b.normalMax > b.alertMax) return false;
  if (highOnly) return isnan(b.alertMin) && isnan(b.normalMin);
  return isfinite(b.alertMin) && isfinite(b.normalMin)
    && b.alertMin < b.normalMin && b.normalMin <= b.normalMax && b.alertMin < b.alertMax;
}

bool thresholdBandsValid(const ThresholdBandSet& set) {
  return thresholdBandValid(set.temperature, false) && thresholdBandValid(set.ph, false)
    && thresholdBandValid(set.turbidity, true) && thresholdBandValid(set.waterDepth, false);
}

void loadThresholdBands() {
  ThresholdBandSet stored;
  if (prefs.getBytesLength(BANDS_NVS_KEY) == sizeof(stored)
      && prefs.getBytes(BANDS_NVS_KEY, &stored, sizeof(stored)) == sizeof(stored)
      && thresholdBandsValid(stored)) {
    thresholdBands = stored;
  } else {
    thresholdBands = DEFAULT_THRESHOLD_BANDS;
  }
}

void printThresholdBands() {
  auto row = [](const char* name, const ThresholdBand& b) {
    Serial.printf("  %-11s alert <%s | normal %s..%s | alert >%s\n", name,
                  isfinite(b.alertMin) ? String(b.alertMin, 2).c_str() : "--",
                  isfinite(b.normalMin) ? String(b.normalMin, 2).c_str() : "--",
                  String(b.normalMax, 2).c_str(), String(b.alertMax, 2).c_str());
  };
  row("temperature", thresholdBands.temperature);
  row("pH", thresholdBands.ph);
  row("turbidity", thresholdBands.turbidity);
  row("depth", thresholdBands.waterDepth);
}

// Reads one band from the backend's JSON. A missing number becomes NAN (no limit).
void readThresholdBand(JsonVariantConst json, ThresholdBand& out) {
  auto num = [&](const char* key) -> float {
    JsonVariantConst v = json[key];
    return (v.is<float>() || v.is<long>()) ? v.as<float>() : NAN;
  };
  out = { num("alertMin"), num("normalMin"), num("normalMax"), num("alertMax") };
}

// Applies limits from the heartbeat reply. Invalid or missing limits keep the current copy.
void applyThresholdBands(JsonVariantConst json) {
  if (!json.is<JsonObjectConst>()) return;
  ThresholdBandSet next;
  readThresholdBand(json["temperature"], next.temperature);
  readThresholdBand(json["ph"], next.ph);
  readThresholdBand(json["turbidity"], next.turbidity);
  readThresholdBand(json["waterDepth"], next.waterDepth);
  if (!thresholdBandsValid(next)) { Serial.println("[ALARM] ignored invalid thresholds from the server"); return; }
  if (!memcmp(&next, &thresholdBands, sizeof(next))) return;
  thresholdBands = next;
  prefs.putBytes(BANDS_NVS_KEY, &thresholdBands, sizeof(thresholdBands));
  Serial.println("[ALARM] thresholds updated from the dashboard:");
  printThresholdBands();
}

// Called after each sensor read. Like the dashboard, only trusted readings count:
// pH and turbidity must be calibrated and stable, depth needs the empty-tub step.
void evaluateWaterAlarm() {
  AlarmLevel worst = ALARM_NORMAL;
  char reason[sizeof(alarmReason)] = "";
  auto check = [&](const char* name, float value, const ThresholdBand& band) {
    const AlarmLevel level = classifyBand(value, band);
    if (level > worst) { worst = level; snprintf(reason, sizeof(reason), "%s %.2f", name, value); }
  };
  if (tempS.connected && isfinite(tempS.value)) check("temperature", tempS.value, thresholdBands.temperature);
  if (phS.quality == SQ_STABLE) check("pH", phS.value, thresholdBands.ph);
  if (turbS.quality == SQ_STABLE) check("turbidity", turbS.value, thresholdBands.turbidity);
  qualityLevelNow = worst;   // water quality only: this is what an exchange can fix
  // The level is meant to drop and rise during a water exchange, so depth is not judged then.
  if (isfinite(tankDepthCm) && !waterBusy() && !fillOn && !drainOn) check("depth", tankDepthCm, thresholdBands.waterDepth);

  if (worst == alarmCandidate) { if (alarmCandidateCount < 255) alarmCandidateCount++; }
  else { alarmCandidate = worst; alarmCandidateCount = 1; }
  if (alarmCandidateCount >= ALARM_CONFIRM_READS && alarmLevel != alarmCandidate) {
    alarmLevel = alarmCandidate;
    alarmPatternStart = millis();   // start the new pattern at its first beep
    Serial.printf("[ALARM] %s%s%s\n", alarmLevelName(alarmLevel), reason[0] ? ": " : "", reason);
  }
  if (worst == alarmLevel) strlcpy(alarmReason, reason, sizeof(alarmReason));
}

// Automatic partial exchange (policy at the top of the file). Runs after
// evaluateWaterAlarm() on every sensor read.
void evaluateWaterAutomation() {
  // Confirm the water-quality level over ~1 min so a short spike never pumps.
  if (qualityLevelNow == ALARM_NORMAL) { outOfRangeSamples = 0; exchangeLevel = ALARM_NORMAL; }
  else if (++outOfRangeSamples >= AUTO_EXCHANGE_CONFIRM_READS) {
    outOfRangeSamples = AUTO_EXCHANGE_CONFIRM_READS;
    exchangeLevel = qualityLevelNow;
  }

  if (!waterAutomation || exchangeLevel == ALARM_NORMAL) return;
  if (!relaysEnabled || waterBusy() || fillOn || drainOn || !strcmp(waterPhase, "FAULT")) return;
  // Pumps start only while the dashboard can see them and stop them.
  if (WiFi.status() != WL_CONNECTED || !mqtt.connected()) return;

  const bool critical = exchangeLevel == ALARM_ALERT;
  const uint32_t now = millis();
  if (autoExchangeEverRan && now - lastAutoExchangeAt < (critical ? CRITICAL_EXCHANGE_GAP_MS : WARNING_EXCHANGE_GAP_MS)) return;
  if (exchangeWindowOpen && now - exchangeWindowStart >= 24UL * 3600UL * 1000UL) {
    exchangeWindowOpen = false;
    exchangePercentInWindow = 0.0f;
  }

  const float percent = critical ? CRITICAL_EXCHANGE_PERCENT : WARNING_EXCHANGE_PERCENT;
  static uint32_t lastSkipLogAt = 0;
  auto skip = [&](const char* why) {
    if (lastSkipLogAt && now - lastSkipLogAt < 600000UL) return;   // log at most every 10 min
    lastSkipLogAt = now | 1;
    Serial.printf("[WATER] automatic %s exchange skipped: %s\n", critical ? "critical" : "warning", why);
  };
  if (exchangePercentInWindow + percent > MAX_AUTO_EXCHANGE_PERCENT_PER_DAY + 0.01f) { skip("24 h exchange limit reached"); return; }
  if (!exchangeCommissioned()) { skip("tank volume and pump flow not set (type 'exchange')"); return; }
  if (isfinite(tankDepthCm) && isfinite(thresholdBands.waterDepth.normalMin) && tankDepthCm < thresholdBands.waterDepth.normalMin) {
    skip("water level is already below normal"); return;
  }
  const uint32_t drainMs = exchangeRunMs(percent, exchangeSetup.drainLpm);
  const uint32_t fillMs = exchangeRunMs(percent, exchangeSetup.fillLpm);
  if (!drainMs || !fillMs) { skip("pump run time would be under 1 s or over 10 min; check 'exchange'"); return; }

  lastAutoExchangeAt = now;
  autoExchangeEverRan = true;
  if (!exchangeWindowOpen) { exchangeWindowOpen = true; exchangeWindowStart = now; }
  exchangePercentInWindow += percent;
  Serial.printf("[WATER] %s (%s): automatic %.0f%% exchange, %.2f L: drain %.1f s, fill %.1f s\n",
                critical ? "CRITICAL" : "WARNING", alarmReason[0] ? alarmReason : "water quality", percent,
                exchangeSetup.tankVolumeL * percent / 100.0f, drainMs / 1000.0f, fillMs / 1000.0f);
  startExchange(drainMs, fillMs);
}

bool buzzerSounding() { return buzzerManual || !strcmp(waterPhase, "FAULT"); }

void updateBuzzer() {
  if (buzzerSounding()) {
    // The buzzer has its own tone. Fault: fast beeps. Manual: slow beeps.
    const bool fault = !strcmp(waterPhase, "FAULT");
    const uint32_t period = fault ? 400 : 1000, onFor = fault ? 200 : 150;
    buzzerSet((millis() % period) < onFor);
    return;
  }
  // Water alarm: Alert = 3 beeps, Warning = 2 beeps, then a pause, repeated
  // until every trusted reading is back in its normal range.
  const uint8_t beeps = !alarmEnabled ? 0 : alarmLevel == ALARM_ALERT ? 3 : alarmLevel == ALARM_WARNING ? 2 : 0;
  if (!beeps) { buzzerQuiet(); return; }
  const uint32_t BEEP_MS = 150, GAP_MS = 150, PAUSE_MS = 1200;
  const uint32_t burst = beeps * (BEEP_MS + GAP_MS);
  const uint32_t t = (millis() - alarmPatternStart) % (burst + PAUSE_MS);
  buzzerSet(t < burst && (t % (BEEP_MS + GAP_MS)) < BEEP_MS);
}


// =====================================================
// SENSORS
// =====================================================

static int medianOfInts(int* values, int n) {
  // Insertion sort; n is small (≤16).
  for (int i = 1; i < n; i++) {
    const int key = values[i];
    int j = i - 1;
    while (j >= 0 && values[j] > key) { values[j + 1] = values[j]; j--; }
    values[j + 1] = key;
  }
  return values[n / 2];
}

static float medianOfFloats(const float* values, int n) {
  float tmp[8];
  if (n <= 0 || n > 8) return NAN;
  for (int i = 0; i < n; i++) tmp[i] = values[i];
  for (int i = 1; i < n; i++) {
    const float key = tmp[i];
    int j = i - 1;
    while (j >= 0 && tmp[j] > key) { tmp[j + 1] = tmp[j]; j--; }
    tmp[j + 1] = key;
  }
  return tmp[n / 2];
}

const char* qualityName(SensorQuality q) {
  switch (q) {
    case SQ_INITIALIZING: return "INITIALIZING";
    case SQ_DISCONNECTED: return "DISCONNECTED";
    case SQ_ADC_SATURATED: return "ADC_SATURATED";
    case SQ_UNSTABLE: return "UNSTABLE";
    case SQ_STABILIZING: return "STABILIZING";
    case SQ_STABLE: return "STABLE";
    case SQ_OUT_OF_RANGE: return "OUT_OF_RANGE";
    case SQ_CALIBRATION_REQUIRED: return "CALIBRATION_REQUIRED";
    default: return "SENSOR_ERROR";
  }
}

// DFRobot SEN0189 curve at 25 C. Left unclamped above 4.2 V so calibration can
// still tell very clear samples apart; below 2.5 V it is pinned to the top of range.
float turbidityCurveNtu(float sensorVolts) {
  if (!isfinite(sensorVolts)) return NAN;
  if (sensorVolts < TURB_CURVE_MIN_V) return TURB_MAX_NTU;
  return min(TURB_MAX_NTU, -1120.4f * sensorVolts * sensorVolts + 5742.3f * sensorVolts - 4352.9f);
}

// Calibrated NTU. Anything below zero is simply cleaner than the 0 NTU reference.
float turbidityFromSensorVoltage(float sensorVolts) {
  const float curve = turbidityCurveNtu(sensorVolts);
  if (!isfinite(curve)) return NAN;
  return max(0.0f, cal.turbSlope * curve + cal.turbOffset);
}

// DFRobot SEN0165 Gravity Analog ORP Meter circuit equation (wiki sample,
// rewritten for measured module output voltage instead of 10-bit / 5 V ADC):
//   ORP_mV = 400 * V_module - 1000 * V_out - OFFSET
float orpFromSensorVoltage(float sensorVolts) {
  if (!isfinite(sensorVolts) || !isfinite(afe.orpModuleSupplyV)) return NAN;
  return 400.0f * afe.orpModuleSupplyV - 1000.0f * sensorVolts - cal.orpOffset;
}

float phFromSensorVoltage(float sensorVolts) {
  if (!isfinite(sensorVolts) || !isfinite(cal.phSlope) || !isfinite(cal.phOffset)) return NAN;
  // Use the calibrated linear fit as captured. Do not scale the slope with
  // temperature while holding the intercept fixed: that shifts every buffer
  // away from its calibrated reference. Proper Nernst compensation needs a
  // stored voltage/pH anchor and calibration temperature, which this legacy
  // NVS structure does not contain.
  return sensorVolts * cal.phSlope + cal.phOffset;
}

AnalogDiag sampleADC(int pin, float dividerRatio, int samples = 11) {
  AnalogDiag d;
  // Discard first conversions after mux settle (ESP32 ADC channel switching).
  analogRead(pin);
  delayMicroseconds(250);
  analogReadMilliVolts(pin);
  delayMicroseconds(250);

  if (samples < 5) samples = 5;
  if (samples > 15) samples = 15;
  int counts[16];
  uint32_t mvSum = 0;
  d.minimum = 4095; d.maximum = 0;
  for (int i = 0; i < samples; i++) {
    const int v = analogRead(pin);
    counts[i] = v;
    d.minimum = min(d.minimum, v); d.maximum = max(d.maximum, v);
    if (v <= 0 || v >= 4095) d.clipped++;
    d.last = v;
    mvSum += analogReadMilliVolts(pin);
    delayMicroseconds(400);
  }
  d.rawAdc = medianOfInts(counts, samples);
  d.voltage = (mvSum / float(samples)) / 1000.0f;
  d.spreadMv = (d.maximum - d.minimum) * (3300.0f / 4095.0f);
  const float ratio = (isfinite(dividerRatio) && dividerRatio >= 1.0f) ? dividerRatio : 1.0f;
  d.sensorVoltage = d.voltage * ratio;
  d.filteredVoltage = d.sensorVoltage;
  return d;
}

void pushFiltered(Sensor& s, float sensorVolts) {
  if (!isfinite(sensorVolts)) return;
  s.filtBuf[s.filtNext] = sensorVolts;
  s.filtNext = (s.filtNext + 1) % 5;
  if (s.filtCount < 5) s.filtCount++;
  s.diag.filteredVoltage = medianOfFloats(s.filtBuf, s.filtCount);
}

void trackConnection(Sensor& s, bool looksConnected, const char* name) {
  if (looksConnected) {
    s.connectCount++; s.disconnectCount = 0;
    if (!s.connected) { s.connected = true; Serial.printf("[%s] CONNECTED\n", name); }
  } else {
    s.disconnectCount++; s.connectCount = 0;
    if (s.connected && s.disconnectCount >= DISCONNECT_CONFIRM_COUNT) {
      s.connected = false;
      s.value = NAN;
      s.filtCount = 0; s.filtNext = 0;
      Serial.printf("[%s] DISCONNECTED\n", name);
    }
  }
  if (!s.connected) s.value = NAN;
}

bool adcLooksConnected(const AnalogDiag& d, int lo, int hi) {
  return d.rawAdc >= lo && d.rawAdc <= hi && (d.maximum - d.minimum) <= STABILITY_MAX_DEV;
}

SensorQuality classifyAnalog(const Sensor& s, float stableSpreadMv, bool calibrated, bool valueInRange) {
  if (s.diag.clipped >= 3 || s.diag.rawAdc <= 0 || s.diag.rawAdc >= 4095) return SQ_ADC_SATURATED;
  if (!s.connected) return SQ_DISCONNECTED;
  if (!isfinite(s.diag.spreadMv)) return SQ_STABILIZING;
  if (s.diag.spreadMv > stableSpreadMv * 2.5f) return SQ_UNSTABLE;
  if (s.filtCount < 3 || s.diag.spreadMv > stableSpreadMv) return SQ_STABILIZING;
  if (!calibrated) return SQ_CALIBRATION_REQUIRED;
  if (!valueInRange || !isfinite(s.value)) return SQ_OUT_OF_RANGE;
  return SQ_STABLE;
}

void readAnalogSensors() {
  // pH first: an unplugged PH-4502C PO input can rail and bleed into the next pin.
  phS.diag = sampleADC(PH_PIN, afe.phDivider); phS.sampledAtMs = millis();
  trackConnection(phS, adcLooksConnected(phS.diag, PH_CONNECT_MIN, PH_CONNECT_MAX), "pH");
  if (phS.connected) {
    pushFiltered(phS, phS.diag.sensorVoltage);
    const float v = isfinite(phS.diag.filteredVoltage) ? phS.diag.filteredVoltage : phS.diag.sensorVoltage;
    phS.value = phFromSensorVoltage(v);
    // Do not silently clamp into 0–14; out-of-range stays visible as OUT_OF_RANGE.
  }
  // Provisional factory pH coefficients are not treated as a completed calibration.
  phS.quality = classifyAnalog(phS, 15.0f, phUserCalibrated && afeOk.ph,
                               isfinite(phS.value) && phS.value >= 0.0f && phS.value <= 14.0f);
  delay(2);

  turbS.diag = sampleADC(TURB_PIN, afe.turbDivider); turbS.sampledAtMs = millis();
  // SEN0189 analog output is 0–4.5 V, so through the divider it stays under 3.15 V.
  // A pin at either rail means no signal, or the module's switch is on D.
  const bool turbOk = isfinite(turbS.diag.voltage)
    && turbS.diag.voltage >= 0.15f && turbS.diag.voltage <= 3.15f
    && (turbS.diag.maximum - turbS.diag.minimum) <= STABILITY_MAX_DEV;
  trackConnection(turbS, turbOk, "TURB");
  if (turbS.connected) {
    pushFiltered(turbS, turbS.diag.sensorVoltage);
    const float v = isfinite(turbS.diag.filteredVoltage) ? turbS.diag.filteredVoltage : turbS.diag.sensorVoltage;
    turbS.value = turbidityFromSensorVoltage(v);
  }
  const bool turbCal = turbUserCalibrated && afeOk.turb;
  turbS.quality = classifyAnalog(turbS, 25.0f, turbCal,
                                 isfinite(turbS.value) && turbS.value >= 0.0f && turbS.value <= TURB_MAX_NTU);
  delay(2);

  orpS.diag = sampleADC(ORP_PIN, afe.orpDivider); orpS.sampledAtMs = millis();
  trackConnection(orpS, adcLooksConnected(orpS.diag, ORP_CONNECT_MIN, ORP_CONNECT_MAX), "ORP");
  if (orpS.connected) {
    pushFiltered(orpS, orpS.diag.sensorVoltage);
    const float v = isfinite(orpS.diag.filteredVoltage) ? orpS.diag.filteredVoltage : orpS.diag.sensorVoltage;
    orpS.value = orpFromSensorVoltage(v);
  }
  orpS.quality = classifyAnalog(orpS, 20.0f, orpUserCalibrated && afeOk.orp,
                                isfinite(orpS.value) && orpS.value >= -2000.0f && orpS.value <= 2000.0f);
}

// Non-blocking DS18B20: request now, read on the next cycle (conversion ~750 ms).
void readTemperature() {
  tempS.sampledAtMs = millis();
  if (tempConversionPending) {
    const float t = tempSensor.getTempCByIndex(0);
    trackConnection(tempS, t != DEVICE_DISCONNECTED_C && t > -55.0f && t < 125.0f, "TEMP");
    if (tempS.connected && t != DEVICE_DISCONNECTED_C) { tempRawC = t; tempS.value = tempCal.slope * t + tempCal.offset; }
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
  tankDepthCm = NAN;
  tankLevelPercent = NAN;
  if (!(ultraS.connected && isfinite(ultraS.value))) return;
  if (tankMountCalibrated()) {
    const float depth = tankCal.mountHeightCm - ultraS.value;
    if (depth >= 0.0f && depth <= tankCal.mountHeightCm) tankDepthCm = depth;
  }
  if (isfinite(tankDepthCm) && tankTargetConfigured()) {
    tankLevelPercent = constrain(tankDepthCm / tankCal.targetDepthCm * 100.0f, 0.0f, 100.0f);
  } else {
    tankLevelPercent = constrain((TANK_EMPTY_DISTANCE_CM - ultraS.value) / (TANK_EMPTY_DISTANCE_CM - TANK_FULL_DISTANCE_CM) * 100.0f, 0.0f, 100.0f);
  }
}

void readSensors() {
  readAnalogSensors();
  readTemperature();
  readUltrasonic();
  evaluateWaterAlarm();        // sets the Normal / Warning / Alert level first
  evaluateWaterAutomation();   // then the exchange policy acts on it
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
    // Publish finite engineering values whenever the probe is connected so the
    // dashboard can show them. valid=false when calibration is still required,
    // saturated, or otherwise untrusted — classification stays off until then.
    // Turbidity stays null until a two-point voltage→NTU fit exists (no curve).
    const bool publishable = s.connected && isfinite(s.value) && s.sampledAtMs != 0
      && s.quality != SQ_DISCONNECTED && s.quality != SQ_ADC_SATURATED
      && s.quality != SQ_SENSOR_ERROR;
    const bool usable = publishable && s.quality != SQ_CALIBRATION_REQUIRED && s.quality != SQ_OUT_OF_RANGE;
    JsonObject o = sensors.createNestedObject(name);
    o["connected"] = s.connected;
    o["valid"] = usable;
    o["sampleAgeMs"] = age;
    o["quality"] = qualityName(s.quality);
    if (analog) {
      o["rawAdc"] = s.diag.rawAdc;
      o["voltage"] = s.diag.voltage;                 // ADC pin volts
      if (isfinite(s.diag.sensorVoltage)) o["sensorVoltage"] = s.diag.sensorVoltage;
      if (isfinite(s.diag.filteredVoltage)) o["filteredVoltage"] = s.diag.filteredVoltage;
      o["adcMinimum"] = s.diag.minimum;
      o["adcMaximum"] = s.diag.maximum;
      o["adcLast"] = s.diag.last;
      o["clippedSamples"] = s.diag.clipped;
    }
    // Disconnected / saturated / non-finite → null. Uncalibrated but finite → publish.
    if (publishable) frame[name] = s.value; else frame[name] = nullptr;
  };
  add("temperature", tempS, false);
  add("ph", phS, true);
  add("orp", orpS, true);
  add("turbidity", turbS, true);
  frame["turbidityUnit"] = "NTU";
  add("ultrasonic", ultraS, false);
  frame.remove("ultrasonic");   // ultrasonic value travels as tankDistanceCm/tankLevelPercent/tankDepthCm
  const bool tankUsable = ultraS.connected && isfinite(ultraS.value) && isfinite(tankLevelPercent);
  if (tankUsable) {
    frame["tankDistanceCm"] = ultraS.value;
    frame["tankLevelPercent"] = tankLevelPercent;
    if (isfinite(tankDepthCm)) frame["tankDepthCm"] = tankDepthCm; else frame["tankDepthCm"] = nullptr;
  } else {
    frame["tankDistanceCm"] = nullptr;
    frame["tankLevelPercent"] = nullptr;
    frame["tankDepthCm"] = nullptr;
  }
  if (tankTargetConfigured()) frame["tankTargetDepthCm"] = tankCal.targetDepthCm;
  else frame["tankTargetDepthCm"] = nullptr;
  if (tankMountCalibrated()) frame["tankMountHeightCm"] = tankCal.mountHeightCm;
  else frame["tankMountHeightCm"] = nullptr;

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

uint32_t phaseRemainingMs() {
  if (phaseDurationMs == 0) return 0;
  const uint32_t elapsed = millis() - phaseStartedAt;
  return elapsed >= phaseDurationMs ? 0u : (phaseDurationMs - elapsed);
}

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
  // Optional display field; not part of the signed ACK canonical.
  if (waterBusy() && phaseDurationMs > 0) s["phaseRemainingMs"] = phaseRemainingMs();
  else s["phaseRemainingMs"] = 0;
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
    slot.expiresAt = expiresAt;
    Serial.printf("[CMD] queued %s %s%s%s\n", source, action, param[0] ? " " : "", param);
    return;
  }
  Serial.println("[CMD] queue full; backend will redeliver");
}

const char* relayGate() { return relaysEnabled ? nullptr : "rejected_relays_not_commissioned"; }

// Feeder (servo) commands live 60 s on the backend (FEEDING_COMMAND_TTL_MS).
const uint64_t FEED_COMMAND_TTL_MS = 60000;
const uint64_t FEED_BOOT_TOLERANCE_MS = 2000;   // allows for small clock differences

// A feed must never run late or survive a power cycle: refuse one that was sent
// before this boot (the device was off) or that is past its 60 s life.
const char* feedCommandStale(const PendingCommand& c) {
  const uint64_t now = epochMillis();
  if (!now || c.expiresAt <= now) return "rejected_expired";
  const uint64_t issuedAt = c.expiresAt > FEED_COMMAND_TTL_MS ? c.expiresAt - FEED_COMMAND_TTL_MS : 0;
  if (now - issuedAt > FEED_COMMAND_TTL_MS) return "rejected_expired";
  const uint64_t bootedAt = now - millis();
  if (issuedAt + FEED_BOOT_TOLERANCE_MS < bootedAt) return "rejected_device_restarted";
  return nullptr;
}

const char* executeCommand(const PendingCommand& c) {
  const bool feeding = !strcmp(c.source, "feeding");
  const String a = c.action;
  if (feeding) {
    if (const char* stale = feedCommandStale(c)) return stale;
    if (a == "TRIGGER") {
      if (feederBusy()) return "rejected_feeder_busy";
      return feederTrigger() ? "accepted" : "rejected_servo_pwm";
    }
    if (a == "ON")  return feederHoldOpen() ? "accepted" : "rejected_servo_pwm";
    if (a == "OFF") { suppressFeedingThisMinute(); return feederStop() ? "accepted" : "rejected_servo_pwm"; }
    return "rejected_unsupported_action";
  }

  if (a == "ALL_OFF") {
    pumpsOff(); exchangeRunning = false; fillToTargetActive = false; waterAutomation = false;
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

  if (a == "AUTOMATION_ON") {
    if (relayGate()) return relayGate();
    if (!exchangeCommissioned()) return "rejected_water_policy_not_configured";
    waterAutomation = true; return "accepted";
  }
  if (a == "AUTOMATION_OFF") { waterAutomation = false; return "accepted"; }

  if (a == "FILL" || a == "DRAIN" || a == "WATER_EXCHANGE" || a == "FILL_TO_TARGET") {
    if (!strcmp(waterPhase, "FAULT")) return "rejected_fault_latched";
    if (waterBusy()) return "rejected_water_busy";
    // Automation stays on: it never starts while this manual run or its cooldown is active.
    if (a == "WATER_EXCHANGE") {
      const uint32_t drainMs = cappedRunMs(c.durationMs, EXCHANGE_DRAIN_MS);
      const uint32_t fillMs = cappedRunMs(c.durationMs, EXCHANGE_FILL_MS);
      if (!drainMs || !fillMs) return "rejected_duration_out_of_range";
      startExchange(drainMs, fillMs); return "accepted";
    }
    if (a == "FILL_TO_TARGET") {
      if (!tankMountCalibrated() || !tankTargetConfigured()) return "rejected_tank_not_calibrated";
      if (!ultraS.connected || !isfinite(ultraS.value) || !isfinite(tankDepthCm)) return "rejected_no_ultrasonic";
      if (tankDepthCm >= tankCal.targetDepthCm - (isfinite(tankCal.stopHysteresisCm) ? tankCal.stopHysteresisCm : 0.2f)) {
        return "rejected_already_at_target";
      }
      const uint32_t maxMs = (c.durationMs >= 1 && c.durationMs <= PUMP_HARD_MAX_MS) ? c.durationMs : PUMP_HARD_MAX_MS;
      startFillToTarget(maxMs);
      return "accepted";
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
  if (!httpPost("/hardware/device/sync", body, response)) return;
  // The reply carries the dashboard's saved thresholds for the buzzer alarm.
  StaticJsonDocument<64> filter;
  filter["data"]["thresholdBands"] = true;
  DynamicJsonDocument reply(1024);
  if (deserializeJson(reply, response, DeserializationOption::Filter(filter))) return;
  applyThresholdBands(reply["data"]["thresholdBands"]);
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
float tempPtX[3], tempPtY[3]; uint8_t tempPts = 0;
bool calWatch = false;
uint32_t lastWatchPrint = 0;
char serialLine[64];
uint8_t serialLen = 0;

void loadTankCalibration() {
  if (prefs.getBytesLength(TANK_NVS_KEY) == sizeof(TankCalibration)) {
    prefs.getBytes(TANK_NVS_KEY, &tankCal, sizeof(tankCal));
  }
  if (!tankTargetConfigured()) tankCal.targetDepthCm = DEFAULT_TANK_CAL.targetDepthCm;
  if (!isfinite(tankCal.stopHysteresisCm) || tankCal.stopHysteresisCm < 0.0f || tankCal.stopHysteresisCm > 5.0f) {
    tankCal.stopHysteresisCm = DEFAULT_TANK_CAL.stopHysteresisCm;
  }
}

void saveTankCalibration() {
  prefs.putBytes(TANK_NVS_KEY, &tankCal, sizeof(tankCal));
}

void loadAnalogFrontEnd() {
  if (prefs.getBytesLength(AFE_NVS_KEY) == sizeof(AnalogFrontEnd)) {
    prefs.getBytes(AFE_NVS_KEY, &afe, sizeof(afe));
  }
  if (!(afe.phDivider >= 1.0f && afe.phDivider <= 10.0f)) afe.phDivider = DEFAULT_AFE.phDivider;
  if (!(afe.orpDivider >= 1.0f && afe.orpDivider <= 10.0f)) afe.orpDivider = DEFAULT_AFE.orpDivider;
  if (!(afe.turbDivider >= 1.0f && afe.turbDivider <= 10.0f)) afe.turbDivider = DEFAULT_AFE.turbDivider;
  if (!(afe.orpModuleSupplyV >= 4.5f && afe.orpModuleSupplyV <= 5.5f)) afe.orpModuleSupplyV = DEFAULT_AFE.orpModuleSupplyV;
  if (prefs.getBytesLength(AFE_OK_NVS_KEY) == sizeof(AfeCommission)) {
    prefs.getBytes(AFE_OK_NVS_KEY, &afeOk, sizeof(afeOk));
  }
  // Legacy: a non-default saved ratio means the channel was already commissioned.
  if (!afeOk.ph && fabsf(afe.phDivider - DEFAULT_AFE.phDivider) > 0.0001f) afeOk.ph = 1;
  if (!afeOk.orp && fabsf(afe.orpDivider - DEFAULT_AFE.orpDivider) > 0.0001f) afeOk.orp = 1;
  if (!afeOk.turb && fabsf(afe.turbDivider - DEFAULT_AFE.turbDivider) > 0.0001f) afeOk.turb = 1;
}

void saveAnalogFrontEnd() {
  prefs.putBytes(AFE_NVS_KEY, &afe, sizeof(afe));
  prefs.putBytes(AFE_OK_NVS_KEY, &afeOk, sizeof(afeOk));
}

void printAnalogFrontEnd() {
  Serial.println("---- analog front-end ----");
  Serial.printf("pH divider   : %.3f  %s  (Vsensor = Vadc * ratio)\n",
                afe.phDivider, afeOk.ph ? "[set]" : "[NOT SET — run: afe ph <ratio>]");
  Serial.printf("ORP divider  : %.3f  %s\n", afe.orpDivider, afeOk.orp ? "[set]" : "[NOT SET]");
  Serial.printf("Turb divider : %.3f  %s\n", afe.turbDivider, afeOk.turb ? "[set]" : "[NOT SET]");
  Serial.printf("ORP Vmodule  : %.3f V (SEN0165 supply; DFRobot wants ~5.00 V)\n", afe.orpModuleSupplyV);
  Serial.println("Set measured ratios before calibration: afe ph|orp|turb <ratio> (1.0–10.0).");
  Serial.println("Ratio = (Rtop + Rbottom) / Rbottom; measure resistors. Use 1.0 only if PO wires straight to the GPIO and stays under ~3.3 V.");
}

void printTankCalibration() {
  Serial.println("---- tank depth (depth = mount - distance) ----");
  if (tankMountCalibrated()) Serial.printf("Mount height : %.2f cm (sensor to bottom)\n", tankCal.mountHeightCm);
  else Serial.println("Mount height : not calibrated (capture empty tub)");
  Serial.printf("Target depth : %.2f cm\n", tankCal.targetDepthCm);
  Serial.printf("Stop hysteresis: %.2f cm\n", tankCal.stopHysteresisCm);
  if (isfinite(tankDepthCm)) Serial.printf("Live depth   : %.2f cm\n", tankDepthCm);
  else Serial.println("Live depth   : --");
}

void loadCalibration() {
  loadAnalogFrontEnd();
  if (prefs.getBytesLength(TEMP_CAL_NVS_KEY) == sizeof(TempCalibration)) prefs.getBytes(TEMP_CAL_NVS_KEY, &tempCal, sizeof(tempCal));
  if (prefs.getBytesLength(CAL_NVS_KEY) == sizeof(Calibration)) {
    prefs.getBytes(CAL_NVS_KEY, &cal, sizeof(cal));
  } else if (prefs.getBytesLength("cal") == sizeof(Calibration)) {
    // Older "cal" blob used ADC counts for turbidity — keep pH, reset turb/ORP models.
    prefs.getBytes("cal", &cal, sizeof(cal));
    cal.turbSlope = DEFAULT_CAL.turbSlope;
    cal.turbOffset = DEFAULT_CAL.turbOffset;
    cal.orpSlope = DEFAULT_CAL.orpSlope;
    cal.orpOffset = DEFAULT_CAL.orpOffset;
    prefs.putBytes(CAL_NVS_KEY, &cal, sizeof(cal));
  }

  const uint8_t ver = prefs.getUChar(CAL_VER_KEY, 0);
  if (ver < 3) {
    // Migrate off the old linear ORP model (slope ≈ 1333 mV/V, offset ≈ -2000).
    if (fabsf(cal.orpSlope - 1333.33f) < 80.0f || fabsf(cal.orpOffset + 2000.0f) < 50.0f) {
      Serial.println("[CAL] Migrating ORP to SEN0165 circuit equation; previous ORP cal cleared.");
      cal.orpSlope = 0.0f;
      cal.orpOffset = 0.0f;
      orpUserCalibrated = false;
    }
    prefs.putBytes(CAL_NVS_KEY, &cal, sizeof(cal));
    prefs.putUChar(CAL_VER_KEY, CAL_FORMULA_VERSION);
  }

  if (ver < 5) {
    // v5 moves turbidity to the SEN0189 curve; a fit for the previous sensor does not carry over.
    cal.turbSlope = DEFAULT_CAL.turbSlope;
    cal.turbOffset = DEFAULT_CAL.turbOffset;
    prefs.putBytes(CAL_NVS_KEY, &cal, sizeof(cal));
    prefs.putBool("turbCal", false);
    Serial.println("[CAL] Turbidity now uses the SEN0189 curve. Capture clean water to calibrate.");
  }

  // Formula v4 changes runtime pH compensation/calibration policy but does not
  // change the Calibration struct layout or invalidate a valid v3 voltage fit.
  prefs.putUChar(CAL_VER_KEY, CAL_FORMULA_VERSION);

  // Prefer explicit flags; fall back to coefficient heuristics for older flash.
  phUserCalibrated = prefs.getBool("phCal", false)
    || (fabsf(cal.phSlope - DEFAULT_CAL.phSlope) > 0.01f)
    || (fabsf(cal.phOffset - DEFAULT_CAL.phOffset) > 0.05f);
  orpUserCalibrated = prefs.getBool("orpCal", false) || fabsf(cal.orpOffset) > 0.5f;
  turbUserCalibrated = prefs.getBool("turbCal", false);
  loadTankCalibration();
}

void saveCalibration() {
  prefs.putBytes(CAL_NVS_KEY, &cal, sizeof(cal));
  prefs.putBytes(TEMP_CAL_NVS_KEY, &tempCal, sizeof(tempCal));
  prefs.putUChar(CAL_VER_KEY, CAL_FORMULA_VERSION);
  prefs.putBool("orpCal", orpUserCalibrated);
  prefs.putBool("phCal", phUserCalibrated);
  prefs.putBool("turbCal", turbUserCalibrated);
}

void printCalibration() {
  Serial.println("---- calibration ----");
  Serial.printf("pH   : slope %.4f pH/V   offset %.4f   (%.1f mV per pH)  [%s]\n",
                cal.phSlope, cal.phOffset, cal.phSlope != 0 ? 1000.0f / fabsf(cal.phSlope) : 0.0f,
                phUserCalibrated ? "user" : "factory/provisional");
  Serial.printf("ORP  : SEN0165  ORP=400*Vmod-1000*Vs-OFFSET  OFFSET=%.2f mV  Vmod=%.3f V  [%s]\n",
                cal.orpOffset, afe.orpModuleSupplyV, orpUserCalibrated ? "user" : "factory");
  Serial.printf("Turb : SEN0189  NTU = %.4f * curve(Vs) + %.3f   [%s]\n", cal.turbSlope, cal.turbOffset,
                turbUserCalibrated ? "user" : "manufacturer curve, not calibrated");
  Serial.printf("Temp : slope %.4f   offset %.3f C   (optional; DS18B20 is factory calibrated)\n", tempCal.slope, tempCal.offset);
  Serial.printf("Captured points: pH %u, ORP %u, turbidity %u, temperature %u\n", phPts, orpPts, turbPts, tempPts);
  printAnalogFrontEnd();
  printTankCalibration();
}

void printWatchLine() {
  auto fmt = [](const Sensor& s, int digits) -> String {
    if (!s.connected || !isfinite(s.value)) return String("--");
    return String(s.value, digits);
  };
  Serial.printf("PH  ADC=%d Vad=%.3f Vs=%.3f Vf=%.3f -> %s pH  %s | ",
                phS.diag.rawAdc, phS.diag.voltage, phS.diag.sensorVoltage, phS.diag.filteredVoltage,
                fmt(phS, 2).c_str(), qualityName(phS.quality));
  Serial.printf("ORP ADC=%d Vad=%.3f Vs=%.3f Vf=%.3f -> %s mV  %s | ",
                orpS.diag.rawAdc, orpS.diag.voltage, orpS.diag.sensorVoltage, orpS.diag.filteredVoltage,
                fmt(orpS, 1).c_str(), qualityName(orpS.quality));
  Serial.printf("TURB ADC=%d Vad=%.3f Vs=%.3f Vf=%.3f -> %s NTU  %s | ",
                turbS.diag.rawAdc, turbS.diag.voltage, turbS.diag.sensorVoltage, turbS.diag.filteredVoltage,
                fmt(turbS, 1).c_str(), qualityName(turbS.quality));
  Serial.printf("TEMP raw=%.2f -> %s C\n", tempRawC, tempS.connected ? String(tempS.value, 2).c_str() : "--");
}

// Plain-language wiring hints for the two faults that no calibration can correct.
void printSignalHints() {
  if (phS.sampledAtMs && phS.diag.rawAdc > PH_CONNECT_MAX) {
    Serial.println("[pH] PO is near the top of its range. Short the BNC and turn the offset trimmer until Vs reads about 2.50 V; check module 5 V and GND.");
  }
  if (turbS.sampledAtMs && turbS.diag.rawAdc <= 5) {
    Serial.println("[TURB] GPIO34 is at 0 V, so the sensor output is not reaching the pin. Check the signal wire, breadboard row and any A/D switch.");
  }
}

void printStatus() {
  Serial.println("==== AquaSense status ====");
  Serial.printf("WiFi %s  MQTT %s  uptime %lu ms\n",
                WiFi.status() == WL_CONNECTED ? "OK" : "down",
                mqtt.connected() ? "OK" : "down", (unsigned long)millis());
  Serial.printf("pH   connected=%d quality=%s value=%s\n", phS.connected, qualityName(phS.quality),
                phS.connected && isfinite(phS.value) ? String(phS.value, 2).c_str() : "--");
  Serial.printf("ORP  connected=%d quality=%s value=%s\n", orpS.connected, qualityName(orpS.quality),
                orpS.connected && isfinite(orpS.value) ? String(orpS.value, 1).c_str() : "--");
  Serial.printf("TURB connected=%d quality=%s value=%s\n", turbS.connected, qualityName(turbS.quality),
                turbS.connected && isfinite(turbS.value) ? String(turbS.value, 1).c_str() : "--");
  Serial.printf("TEMP connected=%d value=%s raw=%.2f\n", tempS.connected,
                tempS.connected && isfinite(tempS.value) ? String(tempS.value, 2).c_str() : "--", tempRawC);
  printSignalHints();
  printCalibration();
}

void printHelp() {
  Serial.println();
  Serial.println("==== AquaSense calibration (Serial Monitor: 115200 baud, Newline) ====");
  Serial.println("watch                 toggle live ADC / voltage / engineering diagnostics");
  Serial.println("status | cal show     ESP32, sensors, calibration, front-end, MQTT");
  Serial.println("show                  same as cal show");
  Serial.println("ph <buffer>           PH-4502C PO: capture all three: ph 4.01, ph 6.86, ph 9.18");
  Serial.println("orp <mV>              SEN0165: set OFFSET from a known ORP standard (user supplies mV)");
  Serial.println("orp zero              SEN0165 zero OFFSET from current circuit reading (probe disconnected)");
  Serial.println("turb <NTU>            SEN0189: turb 0 in clean water; a second standard also fits the gain");
  Serial.println("temp <C>              optional DS18B20 match to a trusted thermometer");
  Serial.println("clear ph|orp|turb|temp           forget captured points (keeps saved calibration)");
  Serial.println("reset ph|orp|turb|temp|tank|all  restore factory defaults and save");
  Serial.println("cal reset confirm     same as reset all (requires the word confirm)");
  Serial.println("set ph|turb|temp <slope> <offset>   type a calibration in directly");
  Serial.println("afe                   show voltage-divider / ORP supply settings");
  Serial.println("afe ph|orp|turb <ratio>           set divider Vsensor/Vadc (measured resistors only)");
  Serial.println("afe orp-vmod <volts>              set SEN0165 module supply (measure near 5.00 V)");
  Serial.println("tank / tank empty / tank target <cm> / tank mount <cm>");
  Serial.println("Rinse between solutions. ORP may need ~20 s. Never press SEN0165 cal button with probe attached.");
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
  Serial.println("==== Automatic water exchange ====");
  Serial.println("exchange               show volume, pump flows, run times and state");
  Serial.println("exchange volume <L>    tank water volume in litres (saved)");
  Serial.println("exchange drain <L/min> measured drain pump flow (saved)");
  Serial.println("exchange fill <L/min>  measured fill pump flow (saved)");
  Serial.println("exchange on|off        automatic exchange: Warning 5%, Critical 10% + aerator");
  Serial.println("==== Water alarm (buzzer) ====");
  Serial.println("alarm                  show Normal/Warning/Alert state and the limits in use");
  Serial.println("alarm off|on           silence / restore the beeps (off lasts until a restart)");
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

// Set by captureInput on failure so callers can return a stable dashboard code.
const char* captureRejectCode = nullptr;

// Average ~3 s of reconstructed sensor voltages; refuse if still drifting or at a rail.
bool captureInput(int pin, float dividerRatio, float maxSpread, float& mean) {
  captureRejectCode = nullptr;
  const int n = 30;
  float sum = 0, adcSum = 0, lo = 1e9f, hi = -1e9f;
  int clipHits = 0, rawLo = 4095, rawHi = 0;
  Serial.print("Sampling 3 s, keep the probe still");
  for (int i = 0; i < n; i++) {
    const AnalogDiag d = sampleADC(pin, dividerRatio);
    const float x = d.sensorVoltage;
    sum += x; adcSum += d.voltage; lo = min(lo, x); hi = max(hi, x);
    rawLo = min(rawLo, d.rawAdc); rawHi = max(rawHi, d.rawAdc);
    if (d.clipped > 0 || d.rawAdc <= 0 || d.rawAdc >= 4095) clipHits++;
    if (i % 6 == 0) Serial.print('.');
    mqtt.loop();
    delay(80);
  }
  mean = sum / n;
  const float meanAdc = adcSum / n;
  const float spread = hi - lo;
  Serial.printf(" mean Vsensor=%.4f V  Vadc=%.4f V  spread %.4f V  raw %d..%d\n",
                mean, meanAdc, spread, rawLo, rawHi);
  if (clipHits >= n / 3 || rawLo <= 5 || rawHi >= 4090 || meanAdc >= 3.15f || meanAdc <= 0.05f) {
    Serial.println("ADC at a rail or open. Check sensor wiring, module power/GND, and any divider.");
    captureRejectCode = "rejected_adc_saturated";
    return false;
  }
  if (spread > maxSpread) {
    Serial.printf("Not steady (spread above %.3f V). Wait for the reading to settle and try again.\n", maxSpread);
    captureRejectCode = "rejected_not_steady";
    return false;
  }
  return true;
}

// True when a new capture voltage is too close to a stored point for a different
// reference. A point for the same reference is skipped so it can be recaptured.
bool voltageAlreadyCaptured(const float* xs, const float* ys, uint8_t count, float mean, float reference, float sameRef, float minDelta) {
  for (uint8_t i = 0; i < count; i++) {
    if (fabsf(ys[i] - reference) <= sameRef) continue;
    if (fabsf(xs[i] - mean) < minDelta) return true;
  }
  return false;
}

// DS18B20 version: average 5 uncorrected conversions (~4 s); false if one fails or they drift.
bool captureTemperature(float maxSpread, float& mean) {
  const int n = 5;
  float sum = 0, lo = 1e9f, hi = -1e9f;
  bool ok = true;
  Serial.print("Sampling the DS18B20, keep the probe still");
  tempSensor.setWaitForConversion(true);
  for (int i = 0; i < n && ok; i++) {
    tempSensor.requestTemperatures();
    const float t = tempSensor.getTempCByIndex(0);
    if (t == DEVICE_DISCONNECTED_C || t <= -55.0f || t >= 125.0f) { ok = false; break; }
    sum += t; lo = min(lo, t); hi = max(hi, t);
    Serial.print('.');
    mqtt.loop();
  }
  // Back to the non-blocking reads that readTemperature() expects.
  tempSensor.setWaitForConversion(false);
  tempSensor.requestTemperatures();
  tempConversionPending = true;
  if (!ok) { Serial.println(" no reading. Check the DS18B20 wiring and its 4.7 kOhm pull-up."); return false; }
  mean = sum / n;
  Serial.printf(" mean %.3f C spread %.3f C\n", mean, hi - lo);
  if (hi - lo > maxSpread) {
    Serial.printf("Not steady (spread above %.2f C). Stir, wait for the reading to settle and try again.\n", maxSpread);
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
  // Hold previous coefficients so a failed fit does not wipe a good calibration.
  const Calibration previous = cal;
  const TempCalibration previousTemp = tempCal;

  if (sensor == "ph") {
    if (!afeOk.ph || !(afe.phDivider >= 1.0f && afe.phDivider <= 10.0f)) {
      Serial.println("Calibration blocked: enter the measured divider ratio first using afe ph <ratio>.");
      setResult(result, resultSize, "rejected_divider_ratio_unset"); return;
    }
    if (reference < 0 || reference > 14) { Serial.println("pH buffer must be 0-14."); setResult(result, resultSize, "rejected_out_of_range"); return; }
    if (!phS.connected) {
      Serial.println("pH PO input looks disconnected (ADC near rail or open). Fix wiring before capturing.");
      setResult(result, resultSize, "rejected_disconnected"); return;
    }
    // These three buffers span the working pH range and reduce sensitivity
    // to noise/non-linearity compared with a two-point fit.
    const bool supportedBuffer =
      fabsf(reference - 4.01f) <= 0.08f ||
      fabsf(reference - 6.86f) <= 0.08f ||
      fabsf(reference - 9.18f) <= 0.08f;
    if (!supportedBuffer) {
      Serial.println("Use the supported pH buffers: 4.01, 6.86, or 9.18.");
      setResult(result, resultSize, "rejected_unsupported_buffer"); return;
    }
    // PH-4502C: use PO analog only. Spread limit ~20 mV at the reconstructed sensor node.
    if (!captureInput(PH_PIN, afe.phDivider, 0.02f, mean)) {
      setResult(result, resultSize, captureRejectCode ? captureRejectCode : "rejected_not_steady");
      return;
    }
    if (voltageAlreadyCaptured(phPtX, phPtY, phPts, mean, reference, 0.05f, 0.05f)) {
      Serial.println("This buffer produced almost the same voltage as a point already captured. Probe may be stuck, dry, or miswired.");
      setResult(result, resultSize, "rejected_same_input"); return;
    }
    phPts = points = addPoint(phPtX, phPtY, phPts, mean, reference, 0.05f);
    Serial.printf("Recorded pH %.2f at Vsensor %.4f V (%u/3 buffers)\n", reference, mean, phPts);
    if (phPts < 3) {
      Serial.println("Point recorded only in RAM. Capture all three distinct buffers (4.01, 6.86, 9.18); existing saved calibration remains active.");
      if (result) snprintf(result, resultSize, "recorded n=%u need=3", phPts);
      return;
    }
    float slope, offset;
    if (inputRange(phPtX, phPts) < 0.05f || !fitLine(phPtX, phPtY, phPts, slope, offset)) {
      Serial.println("Buffers gave almost the same voltage: check probe, wiring, divider ratio, and buffers.");
      phPts = 0;
      setResult(result, resultSize, "rejected_same_input"); return;
    }
    const float mvPerPh = 1000.0f / fabsf(slope);
    if (!isfinite(slope) || !isfinite(offset) || mvPerPh < 30.0f || mvPerPh > 400.0f) {
      Serial.printf("Rejected: %.1f mV per pH is implausible. Previous calibration kept.\n", mvPerPh);
      setResult(result, resultSize, "rejected_implausible_slope"); return;
    }
    // The 3-point fit must predict each captured buffer reasonably closely.
    float maxResidual = 0.0f;
    for (uint8_t i = 0; i < phPts; ++i) {
      maxResidual = max(maxResidual, fabsf((slope * phPtX[i] + offset) - phPtY[i]));
    }
    if (maxResidual > 0.35f) {
      Serial.printf("Rejected: 3-point pH fit residual %.3f pH exceeds 0.35. Check probe cleanliness and buffer freshness.\n", maxResidual);
      setResult(result, resultSize, "rejected_poor_fit"); return;
    }
    cal.phSlope = slope;
    cal.phOffset = offset;
    phUserCalibrated = true;
  } else if (sensor == "orp") {
    // SEN0165: circuit equation is fixed; calibration adjusts OFFSET only.
    // Do NOT press the board zero button while the ORP probe is connected.
    if (!afeOk.orp || !(afe.orpDivider >= 1.0f && afe.orpDivider <= 10.0f)) {
      Serial.println("Calibration blocked: enter the measured divider ratio first using afe orp <ratio>.");
      setResult(result, resultSize, "rejected_divider_ratio_unset"); return;
    }
    if (reference < -2000 || reference > 2000) { Serial.println("ORP standard must be -2000..2000 mV."); setResult(result, resultSize, "rejected_out_of_range"); return; }
    if (!captureInput(ORP_PIN, afe.orpDivider, 0.025f, mean)) {
      setResult(result, resultSize, captureRejectCode ? captureRejectCode : "rejected_not_steady"); return;
    }
    orpPts = points = addPoint(orpPtX, orpPtY, orpPts, mean, reference, 5.0f);
    const float circuit = 400.0f * afe.orpModuleSupplyV - 1000.0f * mean;   // before OFFSET
    const float newOffset = circuit - reference;
    Serial.printf("Recorded ORP ref %.1f mV at Vsensor %.4f V; circuit=%.1f mV => OFFSET=%.2f mV\n",
                  reference, mean, circuit, newOffset);
    if (fabsf(newOffset) > 500.0f) {
      Serial.println("Rejected: OFFSET > 500 mV is not plausible for SEN0165. Previous calibration kept.");
      Serial.println("Check module 5.00 V supply, divider ratio (afe orp), and that the probe is settled (~20 s).");
      cal = previous;
      setResult(result, resultSize, "rejected_implausible_slope"); return;
    }
    cal.orpSlope = 0.0f;
    cal.orpOffset = newOffset;
    orpUserCalibrated = true;
  } else if (sensor == "turb") {
    // SEN0189: one reference corrects the offset; two or more also fit the gain.
    if (!afeOk.turb || !(afe.turbDivider >= 1.0f && afe.turbDivider <= 10.0f)) {
      Serial.println("Calibration blocked: enter the measured divider ratio first using afe turb <ratio>.");
      setResult(result, resultSize, "rejected_divider_ratio_unset"); return;
    }
    if (reference < 0 || reference > TURB_MAX_NTU) {
      Serial.printf("Turbidity standard must be 0-%.0f NTU for this module class.\n", TURB_MAX_NTU);
      setResult(result, resultSize, "rejected_out_of_range"); return;
    }
    if (!captureInput(TURB_PIN, afe.turbDivider, 0.05f, mean)) {
      setResult(result, resultSize, captureRejectCode ? captureRejectCode : "rejected_not_steady"); return;
    }
    if (mean < 0.10f) {
      Serial.println("Turbidity sensor voltage is too low. Check 5 V power, the A/D switch, wiring to GPIO34, and the divider.");
      setResult(result, resultSize, "rejected_turb_voltage_low"); return;
    }
    if (mean < TURB_CURVE_MIN_V) {
      Serial.printf("Sensor voltage %.3f V is below the %.1f V limit of the SEN0189 curve. Use cleaner water and check the divider ratio.\n", mean, TURB_CURVE_MIN_V);
      setResult(result, resultSize, "rejected_turb_curve"); return;
    }
    // Near clear water the curve moves about 37 NTU per 10 mV, so 0 and 100 NTU sit only ~30 mV apart.
    if (voltageAlreadyCaptured(turbPtX, turbPtY, turbPts, mean, reference, 0.5f, 0.015f)) {
      Serial.println("This standard produced almost the same voltage as a point already captured.");
      setResult(result, resultSize, "rejected_same_input"); return;
    }
    turbPts = points = addPoint(turbPtX, turbPtY, turbPts, mean, reference, 0.5f);
    Serial.printf("Recorded %.1f NTU at Vsensor %.4f V (%u point%s)\n", reference, mean, turbPts, turbPts > 1 ? "s" : "");
    float slope = cal.turbSlope, offset = reference - cal.turbSlope * turbidityCurveNtu(mean);
    if (turbPts >= 2) {
      float curveNtu[3];
      for (uint8_t i = 0; i < turbPts; i++) curveNtu[i] = turbidityCurveNtu(turbPtX[i]);
      if (inputRange(turbPtX, turbPts) < 0.015f || !fitLine(curveNtu, turbPtY, turbPts, slope, offset)) {
        Serial.println("Standards gave almost the same voltage. Previous calibration kept.");
        setResult(result, resultSize, "rejected_same_input"); return;
      }
      // Dirtier water raises both the curve and the reference, so the gain must be positive.
      if (!isfinite(slope) || !isfinite(offset) || slope < 0.05f || slope > 20.0f || fabsf(offset) > 5000.0f) {
        Serial.println("Rejected: turbidity fit is not plausible. Check that the standards were not swapped. Previous calibration kept.");
        setResult(result, resultSize, "rejected_implausible_slope"); return;
      }
    } else {
      Serial.println("Offset corrected. A second known standard also fits the gain.");
    }
    cal.turbSlope = slope; cal.turbOffset = offset; turbUserCalibrated = true;
  } else if (sensor == "temp") {
    if (reference < -10 || reference > 60) { Serial.println("Reference temperature must be -10 to 60 C."); setResult(result, resultSize, "rejected_out_of_range"); return; }
    if (!captureTemperature(0.25f, mean)) { setResult(result, resultSize, "rejected_not_steady"); return; }
    tempPts = points = addPoint(tempPtX, tempPtY, tempPts, mean, reference, 0.5f);
    Serial.printf("Recorded %.2f C at sensor %.3f C (%u point%s)\n", reference, mean, tempPts, tempPts > 1 ? "s" : "");
    float slope = tempCal.slope, offset;
    if (tempPts >= 2 && inputRange(tempPtX, tempPts) >= 5.0f && fitLine(tempPtX, tempPtY, tempPts, slope, offset)) {
      if (slope < 0.8f || slope > 1.25f) {
        Serial.printf("Rejected: slope %.3f is not plausible for a DS18B20. Previous calibration kept.\n", slope);
        tempCal = previousTemp;
        setResult(result, resultSize, "rejected_implausible_slope"); return;
      }
    } else {
      offset = reference - tempCal.slope * mean;
      Serial.println("Offset corrected, slope kept. A second point at least 5 C away also fits the slope.");
    }
    tempCal.slope = slope; tempCal.offset = offset;
    if (isfinite(tempRawC)) tempS.value = tempCal.slope * tempRawC + tempCal.offset;
  } else {
    Serial.println("Unknown sensor. Use ph, orp, turb or temp.");
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
// ORP reports slope=0 and offset=OFFSET (SEN0165).
bool calibrationOf(const String& sensor, float& slope, float& offset) {
  if (sensor == "ph") { slope = cal.phSlope; offset = cal.phOffset; return true; }
  if (sensor == "orp") { slope = 0.0f; offset = cal.orpOffset; return true; }
  if (sensor == "turb") { slope = cal.turbSlope; offset = cal.turbOffset; return true; }
  if (sensor == "temp") { slope = tempCal.slope; offset = tempCal.offset; return true; }
  return false;
}

uint8_t capturedPoints(const String& sensor) {
  return sensor == "ph" ? phPts : sensor == "orp" ? orpPts : sensor == "turb" ? turbPts : sensor == "temp" ? tempPts : 0;
}

void resetCalibration(const String& sensor) {
  if (sensor == "ph") { cal.phSlope = DEFAULT_CAL.phSlope; cal.phOffset = DEFAULT_CAL.phOffset; phPts = 0; phUserCalibrated = false; }
  else if (sensor == "orp") { cal.orpSlope = DEFAULT_CAL.orpSlope; cal.orpOffset = DEFAULT_CAL.orpOffset; orpPts = 0; orpUserCalibrated = false; }
  else if (sensor == "turb") { cal.turbSlope = DEFAULT_CAL.turbSlope; cal.turbOffset = DEFAULT_CAL.turbOffset; turbPts = 0; turbUserCalibrated = false; }
  else if (sensor == "temp") { tempCal = DEFAULT_TEMP_CAL; tempPts = 0; }
  else if (sensor == "tank") { tankCal = DEFAULT_TANK_CAL; }
}

bool clearPoints(const String& sensor) {
  if (sensor == "ph") phPts = 0;
  else if (sensor == "orp") orpPts = 0;
  else if (sensor == "turb") turbPts = 0;
  else if (sensor == "temp") tempPts = 0;
  else if (sensor == "tank") return true;   // tank has no ephemeral capture buffer
  else return false;
  return true;
}

// Tank capture: "tank:empty" stores mount height; "tank:target:<cm>" sets desired depth.
bool runTankCalibrationCommand(const char* action, const String& rest, char* result, size_t resultSize) {
  if (!strcmp(action, "CAL_CAPTURE")) {
    if (rest == "empty") {
      // Take five fresh echoes instead of trusting one cached loop sample.
      float sum = 0.0f, lo = 1e6f, hi = -1e6f;
      uint8_t good = 0;
      for (uint8_t i = 0; i < 5; ++i) {
        digitalWrite(ULTRASONIC_TRIG, LOW); delayMicroseconds(2);
        digitalWrite(ULTRASONIC_TRIG, HIGH); delayMicroseconds(10);
        digitalWrite(ULTRASONIC_TRIG, LOW);
        const unsigned long duration = pulseIn(ULTRASONIC_ECHO, HIGH, 30000);
        const float d = duration * 0.0343f / 2.0f;
        if (duration > 0 && d >= 20.0f && d <= 800.0f) {
          sum += d; lo = min(lo, d); hi = max(hi, d); ++good;
        }
        delay(70);
      }
      if (good < 4 || (hi - lo) > 1.5f) {
        Serial.printf("Tank capture rejected: valid=%u/5, spread=%.2f cm. Keep the tank empty and sensor still.\n", good, good ? hi-lo : 999.0f);
        setResult(result, resultSize, "rejected_not_steady"); return true;
      }
      tankCal.mountHeightCm = sum / good;
      saveTankCalibration();
      Serial.printf("Tank mount height saved from %u readings: %.2f cm\n", good, tankCal.mountHeightCm);
      printTankCalibration();
      snprintf(result, resultSize, "saved n=%u slope=%.5f offset=%.4f", good, tankCal.mountHeightCm, tankCal.targetDepthCm);
      return true;
    }
    if (rest.startsWith("target:")) {
      const float target = rest.substring(7).toFloat();
      if (!(target > 0.0f && target <= 200.0f)) { setResult(result, resultSize, "rejected_out_of_range"); return true; }
      tankCal.targetDepthCm = target;
      saveTankCalibration();
      Serial.printf("Tank target depth saved: %.2f cm\n", tankCal.targetDepthCm);
      printTankCalibration();
      snprintf(result, resultSize, "saved n=%u slope=%.5f offset=%.4f",
               tankMountCalibrated() ? 1u : 0u, tankMountCalibrated() ? tankCal.mountHeightCm : 0.0f, tankCal.targetDepthCm);
      return true;
    }
    setResult(result, resultSize, "rejected_bad_param");
    return true;
  }
  if (!strcmp(action, "CAL_CLEAR")) {
    setResult(result, resultSize, "cleared");
    return true;
  }
  if (!strcmp(action, "CAL_RESET")) {
    tankCal = DEFAULT_TANK_CAL;
    saveTankCalibration();
    snprintf(result, resultSize, "reset n=0 slope=%.5f offset=%.4f", 0.0f, tankCal.targetDepthCm);
    return true;
  }
  // CAL_STATUS — slope carries mount height, offset carries target depth.
  snprintf(result, resultSize, "status n=%u slope=%.5f offset=%.4f",
           tankMountCalibrated() ? 1u : 0u,
           tankMountCalibrated() ? tankCal.mountHeightCm : 0.0f,
           tankCal.targetDepthCm);
  return true;
}

// Dashboard calibration commands: CAL_CAPTURE "<sensor>:<reference>", CAL_STATUS/CAL_CLEAR/CAL_RESET "<sensor>".
void runCalibrationCommand(const char* action, const char* param, char* result, size_t resultSize) {
  String p = param; p.trim(); p.toLowerCase();
  const int colon = p.indexOf(':');
  const String sensor = colon < 0 ? p : p.substring(0, colon);
  if (sensor == "tank") {
    runTankCalibrationCommand(action, colon < 0 ? String("") : p.substring(colon + 1), result, resultSize);
    return;
  }
  float slope = 0, offset = 0;
  if (!calibrationOf(sensor, slope, offset)) { setResult(result, resultSize, "rejected_bad_param"); return; }
  if (!strcmp(action, "CAL_CAPTURE")) {
    if (colon < 0) { setResult(result, resultSize, "rejected_bad_param"); return; }
    calibrate(sensor, p.substring(colon + 1).toFloat(), result, resultSize);
    return;
  }
  if (!strcmp(action, "CAL_CLEAR")) {
    clearPoints(sensor);
    setResult(result, resultSize, "cleared");
    return;
  }
  if (!strcmp(action, "CAL_RESET")) {
    resetCalibration(sensor);
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
  if (cmd == "status") { printStatus(); return; }
  if (cmd == "show" || (cmd == "cal" && rest == "show")) { printStatus(); return; }
  if (cmd == "cal" && rest == "reset confirm") {
    for (const char* s : {"ph", "orp", "turb", "temp", "tank"}) resetCalibration(s);
    saveCalibration(); saveTankCalibration();
    Serial.println("All calibration restored to factory/provisional defaults.");
    printCalibration();
    return;
  }
  if (cmd == "cal") { Serial.println("Use: cal show | cal reset confirm"); return; }
  if (cmd == "watch") { calWatch = !calWatch; Serial.printf("watch %s\n", calWatch ? "on" : "off"); return; }
  if (cmd == "afe") {
    if (!rest.length()) { printAnalogFrontEnd(); return; }
    if (rest.startsWith("ph ")) {
      const float r = rest.substring(3).toFloat();
      if (!(r >= 1.0f && r <= 10.0f)) { Serial.println("Divider ratio must be 1.0–10.0 (measured)."); return; }
      if (fabsf(r - afe.phDivider) > 0.0001f) {
        afe.phDivider = r; cal.phSlope = DEFAULT_CAL.phSlope; cal.phOffset = DEFAULT_CAL.phOffset;
        phUserCalibrated = false; phPts = 0; saveCalibration();
        Serial.println("pH calibration invalidated because its divider ratio changed.");
      }
      afeOk.ph = 1;
      saveAnalogFrontEnd(); printAnalogFrontEnd(); return;
    }
    if (rest.startsWith("orp ")) {
      const float r = rest.substring(4).toFloat();
      if (!(r >= 1.0f && r <= 10.0f)) { Serial.println("Divider ratio must be 1.0–10.0 (measured)."); return; }
      if (fabsf(r - afe.orpDivider) > 0.0001f) {
        afe.orpDivider = r; cal.orpOffset = DEFAULT_CAL.orpOffset;
        orpUserCalibrated = false; orpPts = 0; saveCalibration();
        Serial.println("ORP calibration invalidated because its divider ratio changed.");
      }
      afeOk.orp = 1;
      saveAnalogFrontEnd(); printAnalogFrontEnd(); return;
    }
    if (rest.startsWith("turb ")) {
      const float r = rest.substring(5).toFloat();
      if (!(r >= 1.0f && r <= 10.0f)) { Serial.println("Divider ratio must be 1.0–10.0 (measured)."); return; }
      if (fabsf(r - afe.turbDivider) > 0.0001f) {
        afe.turbDivider = r; cal.turbSlope = DEFAULT_CAL.turbSlope; cal.turbOffset = DEFAULT_CAL.turbOffset;
        turbUserCalibrated = false; turbPts = 0; saveCalibration();
        Serial.println("Turbidity calibration invalidated because its divider ratio changed.");
      }
      afeOk.turb = 1;
      saveAnalogFrontEnd(); printAnalogFrontEnd(); return;
    }
    if (rest.startsWith("orp-vmod ")) {
      const float v = rest.substring(9).toFloat();
      if (!(v >= 4.5f && v <= 5.5f)) { Serial.println("ORP module supply must be 4.5–5.5 V (measure it)."); return; }
      if (fabsf(v - afe.orpModuleSupplyV) > 0.001f) {
        afe.orpModuleSupplyV = v; cal.orpOffset = DEFAULT_CAL.orpOffset;
        orpUserCalibrated = false; orpPts = 0; saveCalibration();
        Serial.println("ORP calibration invalidated because the module supply value changed.");
      }
      saveAnalogFrontEnd(); printAnalogFrontEnd(); return;
    }
    Serial.println("Use: afe | afe ph|orp|turb <ratio> | afe orp-vmod <volts>");
    return;
  }
  if (cmd == "orp" && rest == "zero") {
    // Manufacturer-style zero OFFSET from the circuit reading. Probe must be
    // disconnected from the BNC; do not press the board button with probe attached.
    if (!afeOk.orp || !(afe.orpDivider >= 1.0f && afe.orpDivider <= 10.0f)) {
      Serial.println("ORP zero blocked: enter the measured ratio first using afe orp <ratio>.");
      return;
    }
    float mean = 0;
    if (!captureInput(ORP_PIN, afe.orpDivider, 0.025f, mean)) return;
    const float circuit = 400.0f * afe.orpModuleSupplyV - 1000.0f * mean;
    cal.orpOffset = circuit;
    cal.orpSlope = 0.0f;
    orpUserCalibrated = true;
    saveCalibration();
    Serial.printf("ORP zero OFFSET set to %.2f mV (circuit reading with current Vsensor).\n", cal.orpOffset);
    printCalibration();
    return;
  }
  if (cmd == "ph" || cmd == "orp" || cmd == "turb" || cmd == "temp") {
    if (!rest.length()) {
      Serial.printf("Give the reference value, e.g. %s\n", cmd == "ph" ? "ph 6.86" : cmd == "orp" ? "orp 225" : cmd == "turb" ? "turb 100" : "temp 28.4");
      return;
    }
    calibrate(cmd, rest.toFloat(), nullptr, 0);
    return;
  }
  if (cmd == "clear") {
    if (!clearPoints(rest)) { Serial.println("Use: clear ph|orp|turb|temp"); return; }
    Serial.println("Captured points cleared.");
    return;
  }
  if (cmd == "tank") {
    if (!rest.length()) { printTankCalibration(); return; }
    if (rest == "empty") {
      char result[64];
      runTankCalibrationCommand("CAL_CAPTURE", String("empty"), result, sizeof(result));
      Serial.println(result);
      return;
    }
    if (rest.startsWith("target ")) {
      const float target = rest.substring(7).toFloat();
      char result[64];
      char param[32];
      snprintf(param, sizeof(param), "target:%.3f", target);
      runTankCalibrationCommand("CAL_CAPTURE", String(param), result, sizeof(result));
      Serial.println(result);
      return;
    }
    if (rest.startsWith("mount ")) {
      const float mount = rest.substring(6).toFloat();
      if (!(mount >= 20.0f && mount <= 800.0f)) { Serial.println("Mount height must be 20-800 cm."); return; }
      tankCal.mountHeightCm = mount;
      saveTankCalibration();
      printTankCalibration();
      return;
    }
    Serial.println("Use: tank | tank empty | tank target <cm> | tank mount <cm>");
    return;
  }
  if (cmd == "reset") {
    if (rest == "all") { for (const char* s : {"ph", "orp", "turb", "temp", "tank"}) resetCalibration(s); }
    else if (rest == "ph" || rest == "orp" || rest == "turb" || rest == "temp" || rest == "tank") resetCalibration(rest);
    else { Serial.println("Use: reset ph|orp|turb|temp|tank|all"); return; }
    saveCalibration();
    if (rest == "tank" || rest == "all") saveTankCalibration();
    printCalibration();
    return;
  }
  if (cmd == "set") {
    const int sp2 = rest.indexOf(' ');
    const int sp3 = sp2 < 0 ? -1 : rest.indexOf(' ', sp2 + 1);
    if (sp2 < 0 || sp3 < 0) { Serial.println("Use: set ph|turb|temp <slope> <offset>  (ORP uses orp <mV> / orp zero)"); return; }
    const String which = rest.substring(0, sp2);
    const float slope = rest.substring(sp2 + 1, sp3).toFloat();
    const float offset = rest.substring(sp3 + 1).toFloat();
    if (which == "orp") { Serial.println("ORP uses the SEN0165 circuit equation. Use: orp <mV> or orp zero"); return; }
    if (slope == 0) { Serial.println("Slope cannot be 0."); return; }
    if (which == "ph") { cal.phSlope = slope; cal.phOffset = offset; phUserCalibrated = true; }
    else if (which == "turb") { cal.turbSlope = slope; cal.turbOffset = offset; turbUserCalibrated = true; }
    else if (which == "temp") { tempCal.slope = slope; tempCal.offset = offset; }
    else { Serial.println("Use: set ph|turb|temp <slope> <offset>"); return; }
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
  if (cmd == "exchange") {
    const int sp = rest.indexOf(' ');
    const String what = sp < 0 ? rest : rest.substring(0, sp);
    const String arg = sp < 0 ? "" : rest.substring(sp + 1);
    if (what == "on" || what == "off") {
      if (what == "on" && !exchangeCommissioned()) { Serial.println("Set volume, drain and fill first."); return; }
      if (what == "on" && !relaysEnabled) { Serial.println("Relays are disabled. Check them with 'relay test', then 'relay enable'."); return; }
      waterAutomation = what == "on";
      Serial.printf("Automatic water exchange %s.\n", waterAutomation ? "ON" : "off");
      return;
    }
    if (what == "volume" || what == "drain" || what == "fill") {
      const float v = arg.toFloat();
      const bool ok = what == "volume" ? (v >= 1.0f && v <= 5000.0f) : (v >= 0.05f && v <= 200.0f);
      if (!ok) { Serial.println(what == "volume" ? "Tank volume must be 1-5000 litres." : "Flow must be 0.05-200 litres per minute."); return; }
      if (what == "volume") exchangeSetup.tankVolumeL = v;
      else if (what == "drain") exchangeSetup.drainLpm = v;
      else exchangeSetup.fillLpm = v;
      saveExchangeSetup();
      Serial.println("Saved.");
    } else if (what.length()) {
      Serial.println("Use: exchange | exchange volume <L> | exchange drain <L/min> | exchange fill <L/min> | exchange on|off");
      return;
    }
    auto shown = [](float v) { return isfinite(v) ? String(v, 2) : String("not set"); };
    Serial.printf("Tank volume  : %s L\n", shown(exchangeSetup.tankVolumeL).c_str());
    Serial.printf("Drain flow   : %s L/min\n", shown(exchangeSetup.drainLpm).c_str());
    Serial.printf("Fill flow    : %s L/min\n", shown(exchangeSetup.fillLpm).c_str());
    const float pcts[] = {WARNING_EXCHANGE_PERCENT, CRITICAL_EXCHANGE_PERCENT};
    const char* names[] = {"Warning ", "Critical"};
    for (int i = 0; i < 2; i++) {
      const uint32_t d = exchangeRunMs(pcts[i], exchangeSetup.drainLpm), f = exchangeRunMs(pcts[i], exchangeSetup.fillLpm);
      if (d && f) Serial.printf("%s %4.1f%% : %.2f L, drain %.1f s, fill %.1f s\n", names[i], pcts[i],
                                exchangeSetup.tankVolumeL * pcts[i] / 100.0f, d / 1000.0f, f / 1000.0f);
      else Serial.printf("%s %4.1f%% : run time not usable (needs 1 s to 10 min per pump)\n", names[i], pcts[i]);
    }
    Serial.printf("Automation   : %s; water quality %s (confirmed %s)\n", waterAutomation ? "ON" : "off",
                  alarmLevelName(qualityLevelNow), alarmLevelName(exchangeLevel));
    if (exchangeWindowOpen) Serial.printf("Last 24 h    : %.0f%% of %.0f%% allowed\n", exchangePercentInWindow, MAX_AUTO_EXCHANGE_PERCENT_PER_DAY);
    return;
  }
  if (cmd == "alarm") {
    if (rest == "on" || rest == "off") {
      alarmEnabled = rest == "on";
      alarmPatternStart = millis();
      Serial.printf("Water alarm beeps %s%s.\n", alarmEnabled ? "ON" : "OFF",
                    alarmEnabled ? "" : " until 'alarm on' or a restart");
      return;
    }
    Serial.printf("Water alarm: %s%s%s, beeps %s\n", alarmLevelName(alarmLevel),
                  alarmReason[0] ? " (" : "", alarmReason[0] ? (String(alarmReason) + ")").c_str() : "",
                  alarmEnabled ? "on" : "OFF");
    printThresholdBands();
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
uint8_t lcdPageCount = 3;

void lcdLine(uint8_t row, const char* text) {
  char buf[LCD_COLS + 1];
  snprintf(buf, sizeof(buf), "%-20.20s", text);
  lcd.setCursor(0, row);
  lcd.print(buf);
}

void lcdFmtRemaining(char* out, size_t outSize, uint32_t remainingMs) {
  const uint32_t totalSec = (remainingMs + 999) / 1000;
  const uint32_t min = totalSec / 60;
  const uint32_t sec = totalSec % 60;
  if (min > 99) snprintf(out, outSize, "%lu:%02lu", (unsigned long)min, (unsigned long)sec);
  else snprintf(out, outSize, "%u:%02u", (unsigned)min, (unsigned)sec);
}

const char* lcdPhaseLabel() {
  if (!strcmp(waterPhase, "DRAINING")) return "Drain";
  if (!strcmp(waterPhase, "REFILLING")) return fillToTargetActive ? "Fill->tgt" : "Fill";
  if (!strcmp(waterPhase, "SETTLING_AFTER_DRAIN")) return "Settle";
  if (!strcmp(waterPhase, "COOLDOWN")) return "Cooldown";
  if (!strcmp(waterPhase, "COMPLETE")) return "Done";
  if (!strcmp(waterPhase, "FAULT")) return "FAULT";
  return "Idle";
}

void updateLCD() {
  if (!lcdPresent) return;
  char b[24];
  char clock[20];

  // While pumps run, pin the activity page so the countdown stays visible.
  if (waterBusy() || !strcmp(waterPhase, "FAULT") || fillOn || drainOn) lcdPage = 2;

  if (lcdPage == 0) {
    // All four live readings on one page (held longer via LCD_SENSOR_PAGE_MS).
    if (phS.connected && isfinite(phS.value)) snprintf(b, sizeof(b), "pH   %.2f", phS.value);
    else snprintf(b, sizeof(b), "pH   --");
    lcdLine(0, b);
    if (tempS.connected && isfinite(tempS.value)) snprintf(b, sizeof(b), "Temp %.1f C", tempS.value);
    else snprintf(b, sizeof(b), "Temp --");
    lcdLine(1, b);
    if (turbS.connected && isfinite(turbS.value)) snprintf(b, sizeof(b), "Turb %.1f NTU", turbS.value);
    else snprintf(b, sizeof(b), "Turb --");
    lcdLine(2, b);
    if (orpS.connected && isfinite(orpS.value)) snprintf(b, sizeof(b), "ORP  %.0f mV", orpS.value);
    else snprintf(b, sizeof(b), "ORP  --");
    lcdLine(3, b);
  } else if (lcdPage == 1) {
    lcdLine(0, "Tank level");
    if (ultraS.connected && isfinite(ultraS.value)) {
      snprintf(b, sizeof(b), "Air  %.1f cm", ultraS.value); lcdLine(1, b);
      if (isfinite(tankDepthCm)) {
        if (tankTargetConfigured()) snprintf(b, sizeof(b), "D %.2f / %.1f cm", tankDepthCm, tankCal.targetDepthCm);
        else snprintf(b, sizeof(b), "Depth %.2f cm", tankDepthCm);
      } else if (isfinite(tankLevelPercent)) {
        snprintf(b, sizeof(b), "Level %.0f %%", tankLevelPercent);
      } else {
        snprintf(b, sizeof(b), "Depth --");
      }
      lcdLine(2, b);
    } else {
      lcdLine(1, "Air  --");
      lcdLine(2, "Depth --");
    }
    if (tankMountCalibrated()) snprintf(b, sizeof(b), "Mount %.1f cm", tankCal.mountHeightCm);
    else snprintf(b, sizeof(b), "Mount need cal");
    lcdLine(3, b);
  } else {
    // Activity / status: countdown when pumps move, otherwise link + feeder.
    snprintf(b, sizeof(b), "Status  %s", lcdPhaseLabel());
    lcdLine(0, b);
    if (waterBusy() && phaseDurationMs > 0) {
      lcdFmtRemaining(clock, sizeof(clock), phaseRemainingMs());
      snprintf(b, sizeof(b), "Left  %s", clock);
      lcdLine(1, b);
      snprintf(b, sizeof(b), "Fill %s  Drain %s", fillOn ? "ON " : "off", drainOn ? "ON " : "off");
      lcdLine(2, b);
    } else if (!strcmp(waterPhase, "FAULT")) {
      snprintf(b, sizeof(b), "%.20s", waterFault[0] ? waterFault : "fault");
      lcdLine(1, b);
      snprintf(b, sizeof(b), "Fill %s  Drain %s", fillOn ? "ON " : "off", drainOn ? "ON " : "off");
      lcdLine(2, b);
    } else {
      snprintf(b, sizeof(b), "WiFi %s MQTT %s",
               WiFi.status() == WL_CONNECTED ? "OK" : "--",
               mqtt.connected() ? "OK" : "--");
      lcdLine(1, b);
      snprintf(b, sizeof(b), "Aer %s  Feed %s", aeratorOn ? "ON " : "off", feederStateText());
      lcdLine(2, b);
    }
    char date[12], hm[6];
    if (localDateTime(date, sizeof(date), hm, sizeof(hm))) snprintf(b, sizeof(b), "%s %s", date + 5, hm);
    else snprintf(b, sizeof(b), "Clock not set");
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
  loadThresholdBands();
  loadExchangeSetup();
  waterAutomation = automationSaved = prefs.getBool("autoX", false) && exchangeCommissioned();
  if (waterAutomation) Serial.println("[WATER] automatic water exchange is ON");
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
    const bool keepAutomation = waterAutomation;
    waterStop();
    // Automation stays on: it only starts pumps again once the link is back.
    waterAutomation = keepAutomation;
  }
  networkWasUp = networkUp;

  if (now - lastSensor >= SENSOR_INTERVAL_MS) { lastSensor = now; readSensors(); }
  if (now - lastFrame >= FRAME_INTERVAL_MS) { lastFrame = now; publishFrame(); }

  processCommands();
  if (waterAutomation != automationSaved) {
    // Automatic exchange survives a restart; Stop pumps, All off or a fault turn it off.
    automationSaved = waterAutomation;
    prefs.putBool("autoX", waterAutomation);
  }
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
    // Jump to the status page and keep it up for a full page interval.
    feederStateChanged = false;
    lcdPage = 2; lastPage = now; lastLcd = now; updateLCD();
  }
  if (now - lastLcd >= LCD_INTERVAL_MS) { lastLcd = now; updateLCD(); }
  // Longer dwell on the sensor page; while pumps run stay on the activity page.
  const uint32_t pageMs = (waterBusy() || fillOn || drainOn || !strcmp(waterPhase, "FAULT"))
    ? LCD_ACTIVITY_PAGE_MS
    : (lcdPage == 0 ? LCD_SENSOR_PAGE_MS : LCD_PAGE_MS);
  if (now - lastPage >= pageMs) {
    lastPage = now;
    if (!(waterBusy() || fillOn || drainOn || !strcmp(waterPhase, "FAULT"))) {
      lcdPage = (lcdPage + 1) % lcdPageCount;
    }
  }
}
