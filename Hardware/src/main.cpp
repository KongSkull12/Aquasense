/*
  AquaSense - ESP32 Water Quality Monitor
  ----------------------------------------
  LCD: 20x4 I2C at 0x27
  Flow: Boot → WiFi progress → MQTT progress → Readings
  Sensors: pH, Temperature (DS18B20), Turbidity, ORP, Ultrasonic (AJ-SR04M)
*/

#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <RTClib.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <esp_system.h>
#include <time.h>
#include "secrets/Secrets.h"
#include "config/DeviceConfig.h"
#include "models/SensorReadings.h"
#include "communication/MqttManager.h"

// =====================================================
// WIFI / MQTT CONFIG
// =====================================================

const char *MQTT_SERVER = "broker.hivemq.com";
const int MQTT_PORT = 1883;
constexpr char AQUASENSE_FIRMWARE_VERSION[] = "2026.10.24-sensor-telemetry-v2";

WiFiClient espClient;
PubSubClient mqtt(espClient);
MqttManager signedTelemetryManager;
uint32_t telemetrySequence = 0;
char firmwareBootId[17] = {};
bool ntpSyncStarted = false;

// =====================================================
// LCD (20x4)
// =====================================================

#define LCD_ADDRESS 0x27
#define LCD_COLS 20
#define LCD_ROWS 4

LiquidCrystal_I2C lcd(LCD_ADDRESS, LCD_COLS, LCD_ROWS);

// =====================================================
// RTC (optional)
// =====================================================

RTC_DS3231 rtc;

// =====================================================
// SENSOR CONFIG
// =====================================================

#define HAS_PH_SENSOR true
#define HAS_TEMP_SENSOR true
#define HAS_TURB_SENSOR true
#define HAS_ORP_SENSOR true
#define HAS_ULTRASONIC true

#define PH_PIN 35
#define TURB_PIN 34
#define ORP_PIN 32
#define ONE_WIRE_BUS 4

// AJ-SR04M ultrasonic
#define ULTRASONIC_TRIG 14 // Trigger pin
#define ULTRASONIC_ECHO 13 // Echo pin (through voltage divider!)

OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature tempSensor(&oneWire);

// =====================================================
// CALIBRATION
// =====================================================

float PH_SLOPE = -5.70;
float PH_OFFSET = 21.34;

float ORP_SLOPE = 1333.33;
float ORP_OFFSET = -2000.0;

float TURB_CLEAR_ADC = 3000.0;
float TURB_DIRTY_ADC = 500.0;
float TURB_DIRTY_NTU = 1000.0;

// Ultrasonic tank calibration (adjust to your tank)
const float TANK_FULL_DISTANCE_CM = 10.0;   // Existing tank calibration; verify against measured full-tank distance
const float TANK_EMPTY_DISTANCE_CM = 100.0; // distance from sensor when empty
const float ULTRASONIC_MIN_DISTANCE_CM = 20.0;
const float ULTRASONIC_MAX_DISTANCE_CM = 800.0;

// =====================================================
// ADC
// =====================================================

#define ADC_MAX_VALUE 4095.0
#define ADC_REFERENCE 3.3

// =====================================================
// PER-SENSOR CONNECTION WINDOWS
// =====================================================

// pH — board + 10k/20k divider on GPIO 35
#define PH_CONNECT_MIN 200
#define PH_CONNECT_MAX 3900

// Turbidity — board on GPIO 34 (with 100k pulldown)
#define TURB_CONNECT_MIN 50
#define TURB_CONNECT_MAX 4050

// ORP — board on GPIO 32 (with 100k pulldown)
#define ORP_CONNECT_MIN 50
#define ORP_CONNECT_MAX 4050

// Stability: peak-to-peak ADC counts across the sample
// window. Floating pins jump far more than this.
#define STABILITY_MAX_DEV 400

// Confirmation counts
#define CONNECT_CONFIRM_COUNT 1
#define DISCONNECT_CONFIRM_COUNT 4

// =====================================================
// SENSOR STATES
// =====================================================

bool phConnected = false;
bool turbConnected = false;
bool orpConnected = false;
bool tempConnected = false;
bool ultrasonicConnected = false;

int phConnectCounter = 0, phDisconnectCounter = 0;
int turbConnectCounter = 0, turbDisconnectCounter = 0;
int orpConnectCounter = 0, orpDisconnectCounter = 0;
int tempConnectCounter = 0, tempDisconnectCounter = 0;
int ultrConnectCounter = 0, ultrDisconnectCounter = 0;

float temperatureC = NAN;
float phValue = NAN;
float turbidityNTU = NAN;
float orpValue = NAN;
float tankDistanceCm = NAN;
AnalogDiagnostics phDiagnostics;
AnalogDiagnostics turbidityDiagnostics;
AnalogDiagnostics orpDiagnostics;

// =====================================================
// TIMERS
// =====================================================

unsigned long lastSensorRead = 0;
unsigned long lastLCDUpdate = 0;
unsigned long lastMQTTPublish = 0;
unsigned long lastWiFiCheck = 0;
unsigned long lastLCDPageFlip = 0;

const unsigned long SENSOR_INTERVAL = 1000;
const unsigned long LCD_INTERVAL = 500;
const unsigned long MQTT_INTERVAL = 5000;
const unsigned long WIFI_CHECK_INTERVAL = 5000;
const unsigned long LCD_PAGE_INTERVAL = 4000; // rotate LCD pages

// LCD page rotation (0 = rows 0-3 main, 1 = ultrasonic/tank)
uint8_t lcdPage = 0;

// =====================================================
// CONNECTION STATE MACHINE
// =====================================================

enum AppState
{
    STATE_BOOT,
    STATE_WIFI_CONNECTING,
    STATE_MQTT_CONNECTING,
    STATE_RUNNING
};

AppState appState = STATE_BOOT;

// Non-blocking WiFi
unsigned long wifiStartTime = 0;
unsigned long wifiLastAttempt = 0;
int wifiAttemptCount = 0;
const unsigned long WIFI_TIMEOUT = 20000;
const unsigned long WIFI_RETRY_INTERVAL = 3000;
bool wifiBeginCalled = false;

// Non-blocking MQTT
unsigned long mqttStartTime = 0;
unsigned long mqttLastAttempt = 0;
int mqttAttemptCount = 0;
const unsigned long MQTT_TIMEOUT = 20000;
const unsigned long MQTT_RETRY_INTERVAL = 3000;

// Screen transition helpers
unsigned long stateStartTime = 0;
bool showSuccessScreen = false;
const unsigned long SUCCESS_HOLD = 1000;

// =====================================================
// HELPER: LCD progress bar
// =====================================================

void lcdCreateBarChars()
{
    byte fullBlock[8] = {
        B11111, B11111, B11111, B11111,
        B11111, B11111, B11111, B11111};
    byte lightShade[8] = {
        B10101, B01010, B10101, B01010,
        B10101, B01010, B10101, B01010};
    lcd.createChar(0, fullBlock);
    lcd.createChar(1, lightShade);
}

void lcdDrawBar(uint8_t row, float percent)
{
    if (percent < 0)
        percent = 0;
    if (percent > 100)
        percent = 100;

    int filled = (int)((percent / 100.0) * LCD_COLS + 0.5);

    lcd.setCursor(0, row);
    for (int i = 0; i < LCD_COLS; i++)
        lcd.write(i < filled ? byte(0) : byte(1));
}

void lcdPrintLine(uint8_t row, const char *text)
{
    lcd.setCursor(0, row);
    int len = strlen(text);
    if (len > LCD_COLS)
        len = LCD_COLS;

    for (int i = 0; i < len; i++)
        lcd.print(text[i]);

    for (int i = len; i < LCD_COLS; i++)
        lcd.print(' ');
}

// =====================================================
// HELPERS
// =====================================================

float clampFloat(float v, float lo, float hi)
{
    if (v < lo)
        return lo;
    if (v > hi)
        return hi;
    return v;
}

// Compute avg + peak-to-peak deviation in one pass so the
// ADC is only hammered once per sensor per cycle.
struct AnalogSample
{
    int avg;
    int dev;
    int minimum;
    int maximum;
    int last;
    uint8_t clipped;
};

AnalogSample sampleADC(int pin, int samples = 12)
{
    long total = 0;
    int minV = 4095;
    int maxV = 0;
    int lastV = 0;
    uint8_t clipped = 0;

    for (int i = 0; i < samples; i++)
    {
        int v = analogRead(pin);
        lastV = v;
        total += v;
        if (v < minV)
            minV = v;
        if (v > maxV)
            maxV = v;
        if (v <= 8 || v >= 4087)
            clipped++;
        delayMicroseconds(500);
    }

    AnalogSample s;
    s.avg = (int)(total / samples);
    s.dev = maxV - minV;
    s.minimum = minV;
    s.maximum = maxV;
    s.last = lastV;
    s.clipped = clipped;
    return s;
}

void storeAnalogDiagnostics(AnalogDiagnostics &diagnostics, const AnalogSample &sample,
                            float voltage, uint32_t sampledAtMs)
{
    diagnostics.rawAdc = sample.avg;
    diagnostics.voltage = voltage;
    diagnostics.minimum = (uint16_t)sample.minimum;
    diagnostics.maximum = (uint16_t)sample.maximum;
    diagnostics.last = (uint16_t)sample.last;
    diagnostics.clipped = sample.clipped;
    diagnostics.sampledAtMs = sampledAtMs;
}

float readVoltageCalibrated(int pin, int samples = 20)
{
    uint32_t total = 0;
    for (int i = 0; i < samples; i++)
    {
        total += analogReadMilliVolts(pin);
        delayMicroseconds(500);
    }
    return (total / (float)samples) / 1000.0;
}

bool adcLooksConnected(int raw, int dev, int lo, int hi)
{
    if (raw < lo || raw > hi)
        return false;
    if (dev > STABILITY_MAX_DEV)
        return false;
    return true;
}

bool i2cDevicePresent(uint8_t address)
{
    Wire.beginTransmission(address);
    return (Wire.endTransmission() == 0);
}

// =====================================================
// CONNECTION TRACKING
// =====================================================

void updatePHConnection(int raw, int dev)
{
    if (!HAS_PH_SENSOR)
    {
        phConnected = false;
        return;
    }
    bool valid = adcLooksConnected(raw, dev, PH_CONNECT_MIN, PH_CONNECT_MAX);

    if (valid)
    {
        phConnectCounter++;
        phDisconnectCounter = 0;
        if (!phConnected && phConnectCounter >= CONNECT_CONFIRM_COUNT)
        {
            phConnected = true;
            Serial.println("[pH] SENSOR CONNECTED");
        }
    }
    else
    {
        phDisconnectCounter++;
        phConnectCounter = 0;
        if (phConnected && phDisconnectCounter >= DISCONNECT_CONFIRM_COUNT)
        {
            phConnected = false;
            phValue = NAN;
            Serial.println("[pH] SENSOR DISCONNECTED");
        }
    }
}

void updateTurbConnection(int raw, int dev)
{
    if (!HAS_TURB_SENSOR)
    {
        turbConnected = false;
        return;
    }
    bool valid = adcLooksConnected(raw, dev, TURB_CONNECT_MIN, TURB_CONNECT_MAX);

    if (valid)
    {
        turbConnectCounter++;
        turbDisconnectCounter = 0;
        if (!turbConnected && turbConnectCounter >= CONNECT_CONFIRM_COUNT)
        {
            turbConnected = true;
            Serial.println("[TURB] SENSOR CONNECTED");
        }
    }
    else
    {
        turbDisconnectCounter++;
        turbConnectCounter = 0;
        if (turbConnected && turbDisconnectCounter >= DISCONNECT_CONFIRM_COUNT)
        {
            turbConnected = false;
            turbidityNTU = NAN;
            Serial.println("[TURB] SENSOR DISCONNECTED");
        }
    }
}

void updateORPConnection(int raw, int dev)
{
    if (!HAS_ORP_SENSOR)
    {
        orpConnected = false;
        return;
    }
    bool valid = adcLooksConnected(raw, dev, ORP_CONNECT_MIN, ORP_CONNECT_MAX);

    if (valid)
    {
        orpConnectCounter++;
        orpDisconnectCounter = 0;
        if (!orpConnected && orpConnectCounter >= CONNECT_CONFIRM_COUNT)
        {
            orpConnected = true;
            Serial.println("[ORP] SENSOR CONNECTED");
        }
    }
    else
    {
        orpDisconnectCounter++;
        orpConnectCounter = 0;
        if (orpConnected && orpDisconnectCounter >= DISCONNECT_CONFIRM_COUNT)
        {
            orpConnected = false;
            orpValue = NAN;
            Serial.println("[ORP] SENSOR DISCONNECTED");
        }
    }
}

void updateTemperatureConnection()
{
    if (!HAS_TEMP_SENSOR)
    {
        tempConnected = false;
        temperatureC = NAN;
        return;
    }
    int deviceCount = tempSensor.getDeviceCount();
    tempSensor.requestTemperatures();
    float temp = tempSensor.getTempCByIndex(0);

    bool valid = (deviceCount > 0 &&
                  temp != DEVICE_DISCONNECTED_C &&
                  temp > -55.0 && temp < 125.0);

    if (valid)
    {
        tempConnectCounter++;
        tempDisconnectCounter = 0;
        if (!tempConnected && tempConnectCounter >= CONNECT_CONFIRM_COUNT)
        {
            tempConnected = true;
            Serial.println("[TEMP] SENSOR CONNECTED");
        }
        temperatureC = temp;
    }
    else
    {
        tempDisconnectCounter++;
        tempConnectCounter = 0;
        if (tempConnected && tempDisconnectCounter >= DISCONNECT_CONFIRM_COUNT)
        {
            tempConnected = false;
            temperatureC = NAN;
            Serial.println("[TEMP] SENSOR DISCONNECTED");
        }
    }
}

// =====================================================
// SENSOR READS
// =====================================================
//
// IMPORTANT: We insert a short settle delay between ADC
// pins. When the pH pin is unplugged it rails at 4095,
// and the ESP32's shared SAR ADC can bleed that reading
// into the next pin sampled. The delay lets the mux settle.
//

void readPH()
{
    if (!HAS_PH_SENSOR)
        return;

    AnalogSample s = sampleADC(PH_PIN);
    const float v = readVoltageCalibrated(PH_PIN);
    storeAnalogDiagnostics(phDiagnostics, s, v, millis());
    updatePHConnection(s.avg, s.dev);

    Serial.print("[pH] RAW=");
    Serial.print(s.avg);
    Serial.print(" DEV=");
    Serial.print(s.dev);

    if (!phConnected)
    {
        phValue = NAN;
        Serial.println(" -> DISCONNECTED");
        return;
    }

    phValue = clampFloat((v * PH_SLOPE) + PH_OFFSET, 0.0, 14.0);

    Serial.print(" V=");
    Serial.print(v, 3);
    Serial.print(" pH=");
    Serial.println(phValue, 2);

    delayMicroseconds(200); // settle before next ADC pin
}

void readTurbidity()
{
    if (!HAS_TURB_SENSOR)
        return;

    delay(2); // let ADC mux settle after pH read

    AnalogSample s = sampleADC(TURB_PIN);
    const float v = readVoltageCalibrated(TURB_PIN);
    storeAnalogDiagnostics(turbidityDiagnostics, s, v, millis());
    updateTurbConnection(s.avg, s.dev);

    Serial.print("[TURB] RAW=");
    Serial.print(s.avg);
    Serial.print(" DEV=");
    Serial.print(s.dev);

    // Retain the raw-derived estimate for display/diagnostics when the
    // connection check fails. The MQTT frame carries connected/valid
    // separately, so this value remains explicitly untrusted.
    turbidityNTU = ((TURB_CLEAR_ADC - s.avg) /
                    (TURB_CLEAR_ADC - TURB_DIRTY_ADC)) *
                   TURB_DIRTY_NTU;
    turbidityNTU = clampFloat(turbidityNTU, 0.0, TURB_DIRTY_NTU);

    Serial.print(" NTU=");
    Serial.println(turbidityNTU, 1);
    if (!turbConnected)
        Serial.println("[TURB] estimate retained for diagnostics; health is disconnected/unstable");

    delayMicroseconds(200);
}

void readORP()
{
    if (!HAS_ORP_SENSOR)
        return;

    delay(2); // let ADC mux settle after turbidity read

    AnalogSample s = sampleADC(ORP_PIN);
    const float v = readVoltageCalibrated(ORP_PIN);
    storeAnalogDiagnostics(orpDiagnostics, s, v, millis());
    updateORPConnection(s.avg, s.dev);

    Serial.print("[ORP] RAW=");
    Serial.print(s.avg);
    Serial.print(" DEV=");
    Serial.print(s.dev);

    if (!orpConnected)
    {
        orpValue = NAN;
        Serial.println(" -> DISCONNECTED");
        return;
    }

    orpValue = (v * ORP_SLOPE) + ORP_OFFSET;

    Serial.print(" V=");
    Serial.print(v, 3);
    Serial.print(" ORP=");
    Serial.print(orpValue, 1);
    Serial.println(" mV");

    delayMicroseconds(200);
}

void readTemperature()
{
    if (!HAS_TEMP_SENSOR)
    {
        temperatureC = NAN;
        tempConnected = false;
        return;
    }
    updateTemperatureConnection();
    if (!tempConnected)
    {
        temperatureC = NAN;
        Serial.println("[TEMP] DISCONNECTED");
        return;
    }
    Serial.print("[TEMP] ");
    Serial.print(temperatureC, 2);
    Serial.println(" C");
}

// =====================================================
// ULTRASONIC (AJ-SR04M) READ
// =====================================================
//
// Mode 1 (default): 10µs trigger pulse, measure echo pulse
// width. Distance = duration * 0.0343 / 2 (cm).
// Echo pin is 5V on many modules; use a divider before GPIO 13.
//

void readUltrasonic()
{
    if (!HAS_ULTRASONIC)
    {
        ultrasonicConnected = false;
        tankDistanceCm = NAN;
        return;
    }

    // Send 10µs trigger pulse
    digitalWrite(ULTRASONIC_TRIG, LOW);
    delayMicroseconds(2);
    digitalWrite(ULTRASONIC_TRIG, HIGH);
    delayMicroseconds(10);
    digitalWrite(ULTRASONIC_TRIG, LOW);

    // Read echo pulse (timeout ~30ms = ~5m max range)
    long duration = pulseIn(ULTRASONIC_ECHO, HIGH, 30000);

    // Convert to distance (speed of sound ~343 m/s = 0.0343 cm/µs)
    float distance = duration * 0.0343 / 2.0;

    // Validate: AJ-SR04M blind zone ~20cm, max ~800cm.
    const bool distanceReported = duration > 0 && distance > 0.0 &&
                                  distance <= ULTRASONIC_MAX_DISTANCE_CM;
    const bool valid = distanceReported && distance >= ULTRASONIC_MIN_DISTANCE_CM;

    Serial.print("[ULTR] dur=");
    Serial.print(duration);
    Serial.print(" dist=");
    Serial.print(distance, 1);
    tankDistanceCm = distanceReported ? distance : NAN;

    if (valid)
    {
        ultrConnectCounter++;
        ultrDisconnectCounter = 0;
        if (!ultrasonicConnected && ultrConnectCounter >= CONNECT_CONFIRM_COUNT)
        {
            ultrasonicConnected = true;
        }
        tankDistanceCm = distance;
        Serial.println(ultrasonicConnected ? " -> CONNECTED" : " -> VALID");
    }
    else
    {
        ultrDisconnectCounter++;
        ultrConnectCounter = 0;
        if (ultrasonicConnected && ultrDisconnectCounter >= DISCONNECT_CONFIRM_COUNT)
        {
            ultrasonicConnected = false;
            tankDistanceCm = distanceReported ? distance : NAN;
            Serial.println(" -> DISCONNECTED");
        }
        else
        {
            Serial.println(" -> OUT OF RANGE");
        }
    }
}

float getTankLevelPercent()
{
    if (!isfinite(tankDistanceCm))
        return NAN;

    float percent = (TANK_EMPTY_DISTANCE_CM - tankDistanceCm) /
                    (TANK_EMPTY_DISTANCE_CM - TANK_FULL_DISTANCE_CM) * 100.0;
    return clampFloat(percent, 0.0, 100.0);
}

// =====================================================
// BOOT SCREEN
// =====================================================

void showBootScreen()
{
    lcd.clear();

    lcd.setCursor((LCD_COLS - 9) / 2, 0);
    lcd.print("AQUASENSE");

    lcd.setCursor(0, 1);
    lcd.print(" Water Quality Mon. ");

    lcdDrawBar(3, 0);
    for (int i = 1; i <= 100; i += 5)
    {
        lcdDrawBar(3, i);
        delay(80);
    }

    for (int i = 0; i < 2; i++)
    {
        delay(250);
        lcd.noDisplay();
        delay(150);
        lcd.display();
    }
    delay(300);
    lcd.clear();
}

// =====================================================
// WIFI CONNECTING SCREEN (non-blocking)
// =====================================================

void startWiFiConnection()
{
    Serial.println();
    Serial.println("Starting WiFi connection...");
    WiFi.mode(WIFI_STA);
    WiFi.begin(Secrets::WIFI_SSID, Secrets::WIFI_PASSWORD);

    wifiStartTime = millis();
    wifiLastAttempt = wifiStartTime;
    wifiAttemptCount = 1;
    wifiBeginCalled = true;

    lcd.clear();
    lcdPrintLine(0, "   Connecting WiFi");
    lcdPrintLine(1, "Waiting for router");
    lcdDrawBar(3, 0);
}

bool serviceWiFiConnection()
{
    unsigned long now = millis();

    if (WiFi.status() == WL_CONNECTED)
    {
        if (!showSuccessScreen)
        {
            lcdPrintLine(0, "     WiFi OK");
            lcdPrintLine(1, String("  " + WiFi.localIP().toString()).c_str());
            lcdDrawBar(3, 100);
            showSuccessScreen = true;
            stateStartTime = now;
            Serial.println("WiFi connected: " + WiFi.localIP().toString());
        }
        return true;
    }

    unsigned long elapsed = now - wifiStartTime;
    float progress = (elapsed / (float)WIFI_TIMEOUT) * 100.0;
    if (progress > 100)
        progress = 100;

    lcdDrawBar(3, progress);

    if (now - wifiLastAttempt > WIFI_RETRY_INTERVAL)
    {
        wifiLastAttempt = now;
        wifiAttemptCount++;
        Serial.print("WiFi retry #");
        Serial.println(wifiAttemptCount);

        WiFi.disconnect();
        WiFi.begin(Secrets::WIFI_SSID, Secrets::WIFI_PASSWORD);
    }

    // Local sensor display must not depend on an Internet connection.
    if (elapsed >= WIFI_TIMEOUT)
    {
        if (!showSuccessScreen)
        {
            lcdPrintLine(0, "WiFi unavailable");
            lcdPrintLine(1, "Local sensor mode");
            lcdDrawBar(3, 100);
            showSuccessScreen = true;
            stateStartTime = now;
            Serial.println("WiFi unavailable; starting local sensor monitoring.");
        }
        return true;
    }

    return false;
}

// =====================================================
// MQTT CONNECTING SCREEN (non-blocking)
// =====================================================

void startMQTTConnection()
{
    Serial.println();
    Serial.println("Starting MQTT connection...");

    mqtt.setServer(MQTT_SERVER, MQTT_PORT);

    mqttStartTime = millis();
    mqttLastAttempt = mqttStartTime;
    mqttAttemptCount = 1;

    lcd.clear();
    lcdPrintLine(0, "   Connecting MQTT");
    lcdPrintLine(1, String("   " + String(MQTT_SERVER)).c_str());
    lcdDrawBar(3, 0);
}

bool serviceMQTTConnection()
{
    unsigned long now = millis();

    if (WiFi.status() != WL_CONNECTED)
    {
        appState = STATE_WIFI_CONNECTING;
        wifiStartTime = now;
        wifiLastAttempt = now;
        wifiAttemptCount = 1;
        showSuccessScreen = false;
        lcd.clear();
        lcdPrintLine(0, "   Connecting WiFi");
            lcdPrintLine(1, "Waiting for router");
        lcdDrawBar(3, 0);
        return false;
    }

    if (mqtt.connected())
    {
        if (!showSuccessScreen)
        {
            lcdPrintLine(0, "     MQTT OK");
            lcdPrintLine(1, "   Ready for data");
            lcdDrawBar(3, 100);
            showSuccessScreen = true;
            stateStartTime = now;
            Serial.println("MQTT connected");
        }
        mqtt.loop();
        return true;
    }

    unsigned long elapsed = now - mqttStartTime;
    float progress = (elapsed / (float)MQTT_TIMEOUT) * 100.0;
    if (progress > 100)
        progress = 100;
    lcdDrawBar(3, progress);

    if (now - mqttLastAttempt > MQTT_RETRY_INTERVAL)
    {
        mqttLastAttempt = now;
        mqttAttemptCount++;
        Serial.print("MQTT retry #");
        Serial.println(mqttAttemptCount);

        String clientID = "AquaSense-" +
                          String((uint32_t)ESP.getEfuseMac(), HEX);

        if (mqtt.connect(clientID.c_str()))
        {
            Serial.println("MQTT connected");
            lcdPrintLine(0, "     MQTT OK");
            lcdPrintLine(1, "   Ready for data");
            lcdDrawBar(3, 100);
            showSuccessScreen = true;
            stateStartTime = now;
            return true;
        }
        else
        {
            Serial.print("MQTT connect failed, state=");
            Serial.println(mqtt.state());
        }

    }

    mqtt.loop();

    // Keep sensor acquisition and the LCD useful when the broker is offline.
    if (elapsed >= MQTT_TIMEOUT)
    {
        if (!showSuccessScreen)
        {
            lcdPrintLine(0, "MQTT unavailable");
            lcdPrintLine(1, "Local sensor mode");
            lcdDrawBar(3, 100);
            showSuccessScreen = true;
            stateStartTime = now;
            Serial.println("MQTT unavailable; starting local sensor monitoring.");
        }
        return true;
    }

    return false;
}

// =====================================================
// MQTT PUBLISH
// =====================================================

void publishSensorStates()
{
    const uint32_t sampledAtMs = millis();
    SensorReadings reading{};
    reading.temperatureC = temperatureC;
    reading.ph = phValue;
    reading.turbidityRaw = turbidityNTU;
    reading.orpMv = orpValue;
    reading.temperatureConnected = tempConnected;
    reading.phConnected = phConnected;
    reading.turbidityConnected = turbConnected;
    reading.orpConnected = orpConnected;
    reading.temperatureValid = tempConnected && isfinite(temperatureC);
    reading.phValid = phConnected && isfinite(phValue);
    reading.turbidityValid = turbConnected && isfinite(turbidityNTU);
    reading.orpValid = orpConnected && isfinite(orpValue);
    reading.tankDistanceCm = tankDistanceCm;
    reading.tankLevelPercent = getTankLevelPercent();
    reading.ultrasonicConnected = ultrasonicConnected;
    reading.ultrasonicValid = ultrasonicConnected && isfinite(tankDistanceCm) && isfinite(reading.tankLevelPercent);
    reading.sampledAtMs = sampledAtMs;
    reading.temperatureSampledAtMs = sampledAtMs;
    reading.ultrasonicSampledAtMs = sampledAtMs;
    reading.sequence = ++telemetrySequence;
    strlcpy(reading.bootId, firmwareBootId, sizeof(reading.bootId));
    reading.phDiagnostics = phDiagnostics;
    reading.turbidityDiagnostics = turbidityDiagnostics;
    reading.orpDiagnostics = orpDiagnostics;
    reading.calibrated = false;
    signedTelemetryManager.update(reading);

    if (!mqtt.connected())
        return;

    if (phConnected && !isnan(phValue))
    {
        char v[20];
        snprintf(v, sizeof(v), "%.2f", phValue);
        mqtt.publish("aquasense/ph", v, true);
        mqtt.publish("aquasense/ph/status", "CONNECTED", true);
    }
    else
    {
        mqtt.publish("aquasense/ph", "DISCONNECTED", true);
        mqtt.publish("aquasense/ph/status", "DISCONNECTED", true);
    }

    if (tempConnected && !isnan(temperatureC))
    {
        char v[20];
        snprintf(v, sizeof(v), "%.2f", temperatureC);
        mqtt.publish("aquasense/temperature", v, true);
        mqtt.publish("aquasense/temperature/status", "CONNECTED", true);
    }
    else
    {
        mqtt.publish("aquasense/temperature", "DISCONNECTED", true);
        mqtt.publish("aquasense/temperature/status", "DISCONNECTED", true);
    }

    if (turbConnected && !isnan(turbidityNTU))
    {
        char v[20];
        snprintf(v, sizeof(v), "%.1f", turbidityNTU);
        mqtt.publish("aquasense/turbidity", v, true);
        mqtt.publish("aquasense/turbidity/status", "CONNECTED", true);
    }
    else
    {
        mqtt.publish("aquasense/turbidity", "DISCONNECTED", true);
        mqtt.publish("aquasense/turbidity/status", "DISCONNECTED", true);
    }

    if (orpConnected && !isnan(orpValue))
    {
        char v[20];
        snprintf(v, sizeof(v), "%.1f", orpValue);
        mqtt.publish("aquasense/orp", v, true);
        mqtt.publish("aquasense/orp/status", "CONNECTED", true);
    }
    else
    {
        mqtt.publish("aquasense/orp", "DISCONNECTED", true);
        mqtt.publish("aquasense/orp/status", "DISCONNECTED", true);
    }

    // Ultrasonic / tank
    if (ultrasonicConnected && !isnan(tankDistanceCm))
    {
        char v[20];
        snprintf(v, sizeof(v), "%.1f", tankDistanceCm);
        mqtt.publish("aquasense/tank_distance", v, true);
        mqtt.publish("aquasense/tank_distance/status", "CONNECTED", true);

        float pct = getTankLevelPercent();
        if (!isnan(pct))
        {
            snprintf(v, sizeof(v), "%.1f", pct);
            mqtt.publish("aquasense/tank_level", v, true);
        }
    }
    else
    {
        mqtt.publish("aquasense/tank_distance", "DISCONNECTED", true);
        mqtt.publish("aquasense/tank_distance/status", "DISCONNECTED", true);
    }
}

// =====================================================
// MAIN READINGS SCREEN
// =====================================================

void updateLCD()
{
    if (!i2cDevicePresent(LCD_ADDRESS))
        return;

    char buf[24];

    if (lcdPage == 0)
    {
        // Page 0: pH, Temp, Turbidity, ORP
        if (phConnected && !isnan(phValue))
            snprintf(buf, sizeof(buf), "pH: %.2f", phValue);
        else
            snprintf(buf, sizeof(buf), "pH: DISCONNECTED");
        lcdPrintLine(0, buf);

        if (tempConnected && !isnan(temperatureC))
            snprintf(buf, sizeof(buf), "Temp: %.2f C", temperatureC);
        else
            snprintf(buf, sizeof(buf), "Temp: DISCONNECTED");
        lcdPrintLine(1, buf);

        if (turbConnected && !isnan(turbidityNTU))
            snprintf(buf, sizeof(buf), "Turbidity: %.1f", turbidityNTU);
        else
            snprintf(buf, sizeof(buf), "Turbidity: DISCONN");
        lcdPrintLine(2, buf);

        if (orpConnected && !isnan(orpValue))
            snprintf(buf, sizeof(buf), "ORP: %.1f mV", orpValue);
        else
            snprintf(buf, sizeof(buf), "ORP: DISCONNECTED");
        lcdPrintLine(3, buf);
    }
    else
    {
        // Page 1: Ultrasonic / tank info
        lcdPrintLine(0, "  TANK ULTRASONIC");

        if (ultrasonicConnected && !isnan(tankDistanceCm))
        {
            snprintf(buf, sizeof(buf), "Dist: %.1f cm", tankDistanceCm);
            lcdPrintLine(1, buf);

            float pct = getTankLevelPercent();
            if (!isnan(pct))
                snprintf(buf, sizeof(buf), "Level: %.1f %%", pct);
            else
                snprintf(buf, sizeof(buf), "Level: --");
            lcdPrintLine(2, buf);
        }
        else
        {
            lcdPrintLine(1, "Dist: DISCONNECTED");
            lcdPrintLine(2, "Level: --");
        }

        lcdPrintLine(3, "  AJ-SR04M");
    }
}

// =====================================================
// SERIAL STATUS
// =====================================================

void printStatus()
{
    Serial.println();
    Serial.println("========== AQUASENSE ==========");

    Serial.print("pH: ");
    if (phConnected)
        Serial.println(phValue, 2);
    else
        Serial.println("DISCONNECTED");

    Serial.print("Temperature: ");
    if (tempConnected)
        Serial.println(temperatureC, 2);
    else
        Serial.println("DISCONNECTED");

    Serial.print("Turbidity: ");
    if (turbConnected)
        Serial.println(turbidityNTU, 1);
    else
        Serial.println("DISCONNECTED");

    Serial.print("ORP: ");
    if (orpConnected)
    {
        Serial.print(orpValue, 1);
        Serial.println(" mV");
    }
    else
        Serial.println("DISCONNECTED");

    Serial.print("Tank Distance: ");
    if (ultrasonicConnected)
    {
        Serial.print(tankDistanceCm, 1);
        Serial.println(" cm");
    }
    else
        Serial.println("DISCONNECTED");

    Serial.print("Tank Level: ");
    float pct = getTankLevelPercent();
    if (!isnan(pct))
    {
        Serial.print(pct, 1);
        Serial.println(" %");
    }
    else
        Serial.println("--");

    Serial.println("===============================");
}

// =====================================================
// SETUP
// =====================================================

void setup()
{
    Serial.begin(115200);
    delay(1000);

    Serial.println();
    Serial.println("================================");
    Serial.println("       AQUASENSE STARTING       ");
    Serial.println("================================");
    Serial.printf("[BOOT] firmware=%s ultrasonic_trig=GPIO%u ultrasonic_echo=GPIO%u tank_full_cm=%.1f tank_empty_cm=%.1f\n",
                  AQUASENSE_FIRMWARE_VERSION, ULTRASONIC_TRIG, ULTRASONIC_ECHO,
                  double(TANK_FULL_DISTANCE_CM), double(TANK_EMPTY_DISTANCE_CM));

    Wire.begin();
    Wire.setTimeOut(50);
    delay(50);

    Serial.println("Checking I2C devices...");
    Wire.beginTransmission(LCD_ADDRESS);
    if (Wire.endTransmission() == 0)
        Serial.println("  + LCD found at 0x27");
    else
        Serial.println("  - LCD NOT responding at 0x27");

    Wire.beginTransmission(0x68);
    if (Wire.endTransmission() == 0)
        Serial.println("  + DS3231 found at 0x68");
    else
        Serial.println("  - DS3231 NOT responding (optional)");

    lcd.begin(LCD_COLS, LCD_ROWS);
    lcd.backlight();
    lcdCreateBarChars();
    showBootScreen();

    analogReadResolution(12);
    analogSetPinAttenuation(PH_PIN, ADC_11db);
    analogSetPinAttenuation(TURB_PIN, ADC_11db);
    analogSetPinAttenuation(ORP_PIN, ADC_11db);

    tempSensor.begin();
    Serial.print("DS18B20 devices found: ");
    Serial.println(tempSensor.getDeviceCount());

    // Ultrasonic pins
    pinMode(ULTRASONIC_TRIG, OUTPUT);
    pinMode(ULTRASONIC_ECHO, INPUT);
    digitalWrite(ULTRASONIC_TRIG, LOW);

    if (!i2cDevicePresent(0x68))
        Serial.println("RTC: not present (skipping)");
    else if (!rtc.begin())
        Serial.println("RTC: present but rtc.begin() failed");
    else
        Serial.println("RTC: DS3231 detected");

    snprintf(firmwareBootId, sizeof(firmwareBootId), "%08lx%08lx",
        static_cast<unsigned long>(esp_random()), static_cast<unsigned long>(esp_random()));
    if (!signedTelemetryManager.begin())
        Serial.println("Signed MQTT telemetry worker failed to start.");

    startWiFiConnection();
    appState = STATE_WIFI_CONNECTING;

    Serial.println("AquaSense setup complete — entering state machine.");
}

// =====================================================
// LOOP
// =====================================================

void loop()
{
    unsigned long now = millis();

    if (WiFi.status() == WL_CONNECTED && !ntpSyncStarted)
    {
        configTime(0, 0, DeviceConfig::NTP_PRIMARY, DeviceConfig::NTP_SECONDARY);
        ntpSyncStarted = true;
        Serial.println("NTP synchronization started for signed MQTT telemetry.");
    }

    switch (appState)
    {
    case STATE_WIFI_CONNECTING:
    {
        bool connected = serviceWiFiConnection();

        if (connected && showSuccessScreen &&
            (now - stateStartTime >= SUCCESS_HOLD))
        {
            showSuccessScreen = false;
            if (WiFi.status() == WL_CONNECTED)
            {
                startMQTTConnection();
                appState = STATE_MQTT_CONNECTING;
            }
            else
            {
                lcd.clear();
                appState = STATE_RUNNING;
                Serial.println("AquaSense running in local sensor mode.");
            }
        }
        break;
    }

    case STATE_MQTT_CONNECTING:
    {
        bool connected = serviceMQTTConnection();

        if (connected && showSuccessScreen &&
            (now - stateStartTime >= SUCCESS_HOLD))
        {
            lcd.clear();
            appState = STATE_RUNNING;
            Serial.println(mqtt.connected()
                ? "AquaSense running with MQTT."
                : "AquaSense running in local sensor mode.");
        }
        break;
    }

    case STATE_RUNNING:
    {
        if (now - lastSensorRead >= SENSOR_INTERVAL)
        {
            lastSensorRead = now;

            // Order matters: pH first (worst offender when unplugged),
            // then turbidity, then ORP. The settle delays inside each
            // read function let the ESP32 SAR mux recover between pins.
            readPH();
            readTurbidity();
            readORP();
            readTemperature();
            readUltrasonic();

            printStatus();
        }

        if (now - lastLCDUpdate >= LCD_INTERVAL)
        {
            lastLCDUpdate = now;
            updateLCD();
        }

        // Rotate LCD page every few seconds
        if (now - lastLCDPageFlip >= LCD_PAGE_INTERVAL)
        {
            lastLCDPageFlip = now;
            lcdPage = (lcdPage + 1) % 2;
        }

        if (now - lastMQTTPublish >= MQTT_INTERVAL)
        {
            lastMQTTPublish = now;
            publishSensorStates();
        }

        if (now - lastWiFiCheck >= WIFI_CHECK_INTERVAL)
        {
            lastWiFiCheck = now;

            if (WiFi.status() != WL_CONNECTED)
            {
                Serial.println("WiFi lost! Returning to WiFi screen.");
                showSuccessScreen = false;
                startWiFiConnection();
                appState = STATE_WIFI_CONNECTING;
            }
        }

        if (WiFi.status() == WL_CONNECTED && !mqtt.connected())
        {
            Serial.println("MQTT lost! Returning to MQTT screen.");
            showSuccessScreen = false;
            startMQTTConnection();
            appState = STATE_MQTT_CONNECTING;
        }
        else
        {
            mqtt.loop();
        }

        break;
    }

    default:
        break;
    }
}
