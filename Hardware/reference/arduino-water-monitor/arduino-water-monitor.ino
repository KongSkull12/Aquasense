#include <WiFi.h>
#include <PubSubClient.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <RTClib.h>

// WIFI
const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

// MQTT
const char* mqtt_server = "broker.hivemq.com";

// PIN SETUP (based on wiring diagram)
#define PH_PIN 35        // GPIO35 - PH-4502C via voltage divider
#define TURB_PIN 34      // GPIO34 - Turbidity Transducer Module
#define ORP_PIN 32       // GPIO32 - SEN0165 ORP Sensor Module
#define ONE_WIRE_BUS 4   // GPIO4  - DS18B20 Temperature Sensor
#define I2C_SDA 21       // GPIO21 - shared by LCD + RTC
#define I2C_SCL 22       // GPIO22 - shared by LCD + RTC

// ORP CALIBRATION (adjust ORP_OFFSET after calibrating with known solution)
#define ORP_VOLTAGE_MV 3300.0  // ESP32 system voltage in mV (3.3V)
float ORP_OFFSET = 0;          // calibration offset, adjust as needed

// LCD SETUP (I2C 16x2, address 0x27 - adjust to 0x3F if display doesn't show)
LiquidCrystal_I2C lcd(0x27, 16, 2);

// RTC SETUP (DS3231)
RTC_DS3231 rtc;
bool rtcAvailable = false;

// TEMP SENSOR
OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature sensors(&oneWire);

// MQTT
WiFiClient espClient;
PubSubClient client(espClient);

// VARIABLES
float phValue = 0;
float turbidity = 0;
float temperature = 0;
float orpValue = 0;

// SMOOTHING
float smooth(float prev, float current) {
  return (prev * 0.7) + (current * 0.3);
}

// WIFI CONNECT
void setup_wifi() {
  Serial.println("Connecting to WiFi...");
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Connecting WiFi");

  WiFi.begin(ssid, password);

  while (WiFi.status() != WL_CONNECTED) {
    delay(1000);
    Serial.print(".");
  }

  Serial.println("\nWiFi Connected!");
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("WiFi Connected!");
  delay(1000);
}

// MQTT RECONNECT
void reconnect() {
  while (!client.connected()) {
    Serial.print("Connecting to MQTT...");
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("MQTT Connecting");

    if (client.connect("ESP32_AquaSense")) {
      Serial.println("Connected!");
      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("MQTT Connected!");
      delay(1000);
    } else {
      Serial.print("Failed, rc=");
      Serial.print(client.state());
      lcd.setCursor(0, 1);
      lcd.print("Failed, retry..");
      delay(2000);
    }
  }
}

// UPDATE LCD DISPLAY - ALL 4 SENSOR READINGS AT ONCE (compressed, 2 lines)
void updateLCD() {
  lcd.clear();

  // Row 0: Temperature + pH
  lcd.setCursor(0, 0);
  lcd.print("T:");
  lcd.print(temperature, 1);
  lcd.print((char)223); // degree symbol
  lcd.print(" pH:");
  lcd.print(phValue, 1);

  // Row 1: Turbidity + ORP
  lcd.setCursor(0, 1);
  lcd.print("Tb:");
  lcd.print(turbidity, 0);
  lcd.print(" O:");
  lcd.print(orpValue, 0);
}

void setup() {
  Serial.begin(115200);

  analogSetAttenuation(ADC_11db); // full range

  // INIT I2C BUS (shared by LCD + RTC)
  Wire.begin(I2C_SDA, I2C_SCL);

  // INIT LCD
  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0);
  lcd.print("AquaSense");
  lcd.setCursor(0, 1);
  lcd.print("Starting...");
  delay(1500);

  // INIT RTC
  if (!rtc.begin()) {
    Serial.println("Couldn't find RTC module!");
    rtcAvailable = false;
  } else {
    rtcAvailable = true;
    if (rtc.lostPower()) {
      Serial.println("RTC lost power, setting time to compile time.");
      rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
    }
  }

  setup_wifi();
  client.setServer(mqtt_server, 1883);

  sensors.begin();
}

void loop() {
  if (!client.connected()) {
    reconnect();
  }
  client.loop();

  // 🌡️ TEMPERATURE
  sensors.requestTemperatures();
  float tempReading = sensors.getTempCByIndex(0);
  temperature = smooth(temperature, tempReading);

  // 🌊 TURBIDITY (average)
  int turbRaw = 0;
  for (int i = 0; i < 10; i++) {
    turbRaw += analogRead(TURB_PIN);
    delay(10);
  }
  turbRaw /= 10;
  turbidity = smooth(turbidity, turbRaw);

  // 🧪 PH SENSOR (average)
  int phRaw = 0;
  for (int i = 0; i < 10; i++) {
    phRaw += analogRead(PH_PIN);
    delay(10);
  }
  phRaw /= 10;

  float voltage = phRaw * (3.3 / 4095.0);

  // ⚠️ Calibration needed (this is default estimate)
  phValue = 7 + ((2.5 - voltage) / 0.18);

  // ⚡ ORP SENSOR (SEN0165, average)
  int orpRaw = 0;
  for (int i = 0; i < 10; i++) {
    orpRaw += analogRead(ORP_PIN);
    delay(10);
  }
  orpRaw /= 10;

  float orpVoltageMv = orpRaw * (ORP_VOLTAGE_MV / 4095.0);

  // DFRobot SEN0165 reference formula (mV output)
  // ⚠️ Calibrate ORP_OFFSET using a known ORP calibration solution
  float orpRaw_mV = ((30.0 * ORP_VOLTAGE_MV) - (75.0 * orpVoltageMv)) / 75.0;
  orpValue = smooth(orpValue, orpRaw_mV + ORP_OFFSET);

  // 📡 MQTT PUBLISH
  client.publish("aquasense/temperature", String(temperature).c_str());
  client.publish("aquasense/turbidity", String(turbidity).c_str());
  client.publish("aquasense/ph", String(phValue).c_str());
  client.publish("aquasense/orp", String(orpValue).c_str());

  // 📟 UPDATE LCD - shows all 4 readings simultaneously
  updateLCD();

  // DEBUG
  Serial.println("===== SENSOR DATA =====");
  if (rtcAvailable) {
    DateTime now = rtc.now();
    Serial.print("Time: ");
    Serial.print(now.year()); Serial.print('/');
    Serial.print(now.month()); Serial.print('/');
    Serial.print(now.day()); Serial.print(' ');
    Serial.print(now.hour()); Serial.print(':');
    Serial.print(now.minute()); Serial.print(':');
    Serial.println(now.second());
  }
  Serial.print("Temp: "); Serial.println(temperature);
  Serial.print("Turbidity: "); Serial.println(turbidity);
  Serial.print("pH: "); Serial.println(phValue);
  Serial.print("ORP: "); Serial.println(orpValue);

  delay(5000);
}