#include "MqttManager.h"
#include <ArduinoJson.h>
#include <Arduino.h>
#include <mbedtls/md.h>
#include <esp_system.h>
#include <math.h>
#include <sys/time.h>
#include <time.h>
#include <stdio.h>
#include <string.h>
#include "config/DeviceConfig.h"
#if __has_include("secrets/Secrets.h")
#include "secrets/Secrets.h"
#else
#include "secrets/Secrets.example.h"
#endif

namespace {
constexpr size_t COMMAND_BUFFER_BYTES = 1024;
constexpr size_t STATE_BUFFER_BYTES = 2048;
constexpr size_t FRAME_BUFFER_BYTES = 2048;
constexpr size_t SIGNED_FRAME_BUFFER_BYTES = FRAME_BUFFER_BYTES + 256;
// Only the single MQTT worker uses these staging buffers. Keeping them static
// avoids consuming several kilobytes of its 6 KiB task stack on each publish.
char unsignedFramePayload[FRAME_BUFFER_BYTES];
char signedFramePayload[SIGNED_FRAME_BUFFER_BYTES];

bool hmacHex(const char* message, char* output, size_t outputSize) {
    if (!Secrets::DEVICE_KEY[0] || outputSize < 65) return false;
    uint8_t digest[32];
    const mbedtls_md_info_t* info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
    if (!info || mbedtls_md_hmac(info, reinterpret_cast<const unsigned char*>(Secrets::DEVICE_KEY),
            strlen(Secrets::DEVICE_KEY), reinterpret_cast<const unsigned char*>(message),
            strlen(message), digest) != 0) return false;
    for (size_t i = 0; i < sizeof(digest); ++i) snprintf(output + i * 2, 3, "%02x", digest[i]);
    output[64] = '\0';
    return true;
}

bool signatureMatches(const char* message, const char* signature) {
    if (!signature || strlen(signature) != 64) return false;
    char expected[65];
    if (!hmacHex(message, expected, sizeof(expected))) return false;
    uint8_t difference = 0;
    for (size_t i = 0; i < 64; ++i) difference |= uint8_t(expected[i] ^ signature[i]);
    return difference == 0;
}

bool validId(const char* id) {
    if (!id || strlen(id) != 36) return false;
    for (size_t i = 0; i < 36; ++i) {
        const char c = id[i];
        if (i == 8 || i == 13 || i == 18 || i == 23) { if (c != '-') return false; }
        else if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'))) return false;
    }
    return true;
}

CommandAction actionFor(const char* action, bool feeding) {
    if (feeding) {
        if (!strcmp(action, "TRIGGER")) return CommandAction::FeedTrigger;
        if (!strcmp(action, "ON")) return CommandAction::FeedOn;
        if (!strcmp(action, "OFF")) return CommandAction::FeedOff;
        return CommandAction::Invalid;
    }
    const char* names[] = {"FILL", "DRAIN", "WATER_EXCHANGE", "WATER_STOP", "AERATOR_ON", "AERATOR_OFF", "AERATOR_AUTO",
        "AUTOMATION_ON", "AUTOMATION_OFF", "BUZZER_ON", "BUZZER_OFF", "ALL_OFF", "CLEAR_FAULT"};
    for (uint8_t i = 0; i < sizeof(names) / sizeof(names[0]); ++i)
        if (!strcmp(action, names[i])) return static_cast<CommandAction>(i);
    return CommandAction::Invalid;
}

const char* actionName(CommandAction action) {
    switch (action) {
        case CommandAction::Fill: return "FILL"; case CommandAction::Drain: return "DRAIN";
        case CommandAction::WaterExchange: return "WATER_EXCHANGE"; case CommandAction::WaterStop: return "WATER_STOP";
        case CommandAction::AeratorOn: return "AERATOR_ON"; case CommandAction::AeratorOff: return "AERATOR_OFF";
        case CommandAction::AeratorAuto: return "AERATOR_AUTO"; case CommandAction::AutomationOn: return "AUTOMATION_ON";
        case CommandAction::AutomationOff: return "AUTOMATION_OFF"; case CommandAction::BuzzerOn: return "BUZZER_ON";
        case CommandAction::BuzzerOff: return "BUZZER_OFF"; case CommandAction::AllOff: return "ALL_OFF";
        case CommandAction::ClearFault: return "CLEAR_FAULT"; case CommandAction::FeedTrigger: return "TRIGGER";
        case CommandAction::FeedOn: return "ON"; case CommandAction::FeedOff: return "OFF"; default: return "INVALID";
    }
}

uint64_t epochMillis() {
    timeval value{};
    // SNTP status can return to IN_PROGRESS during background resynchronization
    // even while the system clock remains valid. Gate telemetry on the clock
    // value itself, which is initialized by SNTP or a trusted persisted RTC.
    if (gettimeofday(&value, nullptr) != 0 || value.tv_sec < time_t(DeviceConfig::MIN_VALID_EPOCH)) return 0;
    return uint64_t(value.tv_sec) * 1000ULL + uint64_t(value.tv_usec / 1000);
}

bool isoTimestampAtAge(uint64_t currentUtcMs, uint32_t currentMonoMs, uint32_t sampledAtMs,
                       char* output, size_t outputSize) {
    if (!currentUtcMs || !sampledAtMs || !output || outputSize < 25) return false;
    const uint32_t ageMs = uint32_t(currentMonoMs - sampledAtMs);
    if (ageMs > DeviceConfig::TELEMETRY_MAX_AGE_MS || currentUtcMs < ageMs) return false;
    const time_t seconds = time_t((currentUtcMs - ageMs) / 1000ULL);
    const uint16_t milliseconds = uint16_t((currentUtcMs - ageMs) % 1000ULL);
    tm utc{};
    if (!gmtime_r(&seconds, &utc)) return false;
    return snprintf(output, outputSize, "%04d-%02d-%02dT%02d:%02d:%02d.%03uZ",
        utc.tm_year + 1900, utc.tm_mon + 1, utc.tm_mday, utc.tm_hour, utc.tm_min,
        utc.tm_sec, unsigned(milliseconds)) == 24;
}

}

MqttManager* MqttManager::callbackOwner = nullptr;
MqttManager::MqttManager() : client(transport), controlClient(controlTransport) {}

bool MqttManager::begin() {
    if (task != nullptr) return true;
    controlConfigured = DeviceConfig::MQTT_ACTUATOR_COMMANDS_ENABLED &&
        Secrets::DEVICE_KEY[0] && (DeviceConfig::MQTT_CONTROL_PUBLIC_ENABLED ||
        (DeviceConfig::MQTT_CONTROL_TLS_ENABLED && DeviceConfig::MQTT_CONTROL_AUTHENTICATION_ENABLED &&
         Secrets::MQTT_USERNAME[0] && Secrets::MQTT_PASSWORD[0] && Secrets::MQTT_CA_CERT[0]));
    Serial.printf("[BOOT] target=water-monitor device=%s telemetry=%s:%u control=%s\n",
                  DeviceConfig::DEVICE_ID, DeviceConfig::MQTT_HOST, DeviceConfig::MQTT_PORT,
                  controlConfigured ? (DeviceConfig::MQTT_CONTROL_PUBLIC_ENABLED ? "public-hmac-enabled" : "private-tls-enabled")
                                     : "disabled-unconfigured");
    client.setServer(DeviceConfig::MQTT_HOST, DeviceConfig::MQTT_PORT);
    client.setSocketTimeout(DeviceConfig::MQTT_SOCKET_TIMEOUT_SECONDS);
    client.setCallback(messageCallback);
    if (!client.setBufferSize(3072)) return false;
    if (controlConfigured && !DeviceConfig::MQTT_CONTROL_PUBLIC_ENABLED) {
        controlTransport.setCACert(Secrets::MQTT_CA_CERT);
        controlClient.setServer(DeviceConfig::MQTT_CONTROL_HOST, DeviceConfig::MQTT_CONTROL_PORT);
        controlClient.setSocketTimeout(DeviceConfig::MQTT_SOCKET_TIMEOUT_SECONDS);
        controlClient.setCallback(controlMessageCallback);
        if (!controlClient.setBufferSize(3072)) controlConfigured = false;
    } else {
        Serial.println("[MQTT] Private actuator channel disabled: configure TLS credentials, CA, and device key.");
    }
    snapshots = xQueueCreateStatic(1, sizeof(SensorReadings), queueBytes, &queueStorage);
    commands = xQueueCreate(4, sizeof(MqttActuatorCommand));
    states = xQueueCreate(1, sizeof(SystemState));
    acknowledgements = xQueueCreate(4, sizeof(MqttPendingAcknowledgement));
    if (!snapshots || !commands || !states || !acknowledgements) return false;
    callbackOwner = this;
    if (xTaskCreate(runTask, "aquasense-mqtt", DeviceConfig::MQTT_TASK_STACK_BYTES,
                    this, 1, &task) != pdPASS) {
        task = nullptr;
        Serial.println("MQTT worker unavailable; local monitoring continues.");
        return false;
    }
    return true;
}

void MqttManager::update(const SensorReadings& readings) {
    if (task == nullptr || readings.sequence == lastQueuedSequence) return;
    xQueueOverwrite(snapshots, &readings);
    lastQueuedSequence = readings.sequence;
}
void MqttManager::updateState(const SystemState& state) { if (states) xQueueOverwrite(states, &state); }
bool MqttManager::takeCommand(MqttActuatorCommand& command) { return commands && xQueueReceive(commands, &command, 0) == pdTRUE; }
void MqttManager::acknowledge(const MqttActuatorCommand& command, const CommandReceipt& receipt) {
    if (!acknowledgements) return;
    MqttPendingAcknowledgement pending{};
    pending.command = command;
    pending.receipt = receipt;
    if (xQueueSend(acknowledgements, &pending, 0) != pdTRUE)
        Serial.printf("MQTT acknowledgement queue full; command %s result %s was not queued.\n",
                      command.command.id, receipt.result);
}
bool MqttManager::isConnected() const { return connected.load(); }
bool MqttManager::isRunning() const { return task != nullptr; }
void MqttManager::runTask(void* context) { static_cast<MqttManager*>(context)->run(); }
void MqttManager::messageCallback(char* topic, uint8_t* payload, unsigned int length) {
    if (callbackOwner && DeviceConfig::MQTT_CONTROL_PUBLIC_ENABLED)
        callbackOwner->onMessage(topic, payload, length);
}
void MqttManager::controlMessageCallback(char* topic, uint8_t* payload, unsigned int length) {
    if (callbackOwner) callbackOwner->onMessage(topic, payload, length);
}

void MqttManager::onMessage(const char* topic, const uint8_t* payload, unsigned int length) {
    if (!DeviceConfig::MQTT_ACTUATOR_COMMANDS_ENABLED) return;
    char expectedTopic[96];
    snprintf(expectedTopic, sizeof(expectedTopic), "%s/%s/command",
             DeviceConfig::MQTT_CONTROL_TOPIC_NAMESPACE, DeviceConfig::DEVICE_ID);
    if (!topic || strcmp(topic, expectedTopic) || !payload || length == 0 || length >= COMMAND_BUFFER_BYTES) return;
    // PubSubClient exposes the retain bit through its packet state only in some versions;
    // its callback does not provide it. Commands therefore also carry a short expiry and ID.
    // The MQTT layer additionally subscribes with no replay-safe persistent-session setup.
    char input[COMMAND_BUFFER_BYTES]; memcpy(input, payload, length); input[length] = '\0';
    StaticJsonDocument<768> doc;
    if (deserializeJson(doc, input) || !doc.is<JsonObject>()) return;
    const char* id = doc["id"] | ""; const char* deviceId = doc["deviceId"] | "";
    const char* source = doc["source"] | ""; const char* action = doc["action"] | "";
    const char* signature = doc["signature"] | "";
    const uint8_t version = doc["v"] | 0;
    const uint32_t duration = doc["durationMs"] | 0u;
    const uint64_t expiresAt = doc["expiresAt"] | uint64_t(0);
    if (version != 1 || strcmp(deviceId, DeviceConfig::DEVICE_ID) || !validId(id) ||
        (strcmp(source, "hardware") && strcmp(source, "feeding")) || !action[0] || strlen(action) >= 24) return;
    const bool feeding = !strcmp(source, "feeding");
    const CommandAction parsedAction = actionFor(action, feeding);
    if (parsedAction == CommandAction::Invalid) return;
    char canonical[320];
    snprintf(canonical, sizeof(canonical), "v1|%s|%s|%s|%s|%lu|%llu", deviceId, id, source, action,
             static_cast<unsigned long>(duration), static_cast<unsigned long long>(expiresAt));
    if (!signatureMatches(canonical, signature)) return;
    const uint64_t now = epochMillis();
    if (!now || expiresAt <= now || expiresAt - now > uint64_t(DeviceConfig::COMMAND_MAX_TTL_MS)) return;
    MqttActuatorCommand queued{};
    strlcpy(queued.command.id, id, sizeof(queued.command.id));
    queued.command.feedingSource = feeding; queued.command.action = parsedAction;
    queued.command.durationMs = duration; queued.command.receivedAtMs = millis();
    queued.command.ttlMs = uint32_t(expiresAt - now);
    strlcpy(queued.source, source, sizeof(queued.source)); strlcpy(queued.action, action, sizeof(queued.action));
    if (xQueueSend(commands, &queued, 0) != pdTRUE) {
        // Reject explicitly instead of silently losing a valid command. This callback
        // runs from the MQTT worker's client.loop(); only queue work here, and let the
        // worker publish the signed acknowledgement on its next iteration.
        CommandReceipt receipt{};
        strlcpy(receipt.id, id, sizeof(receipt.id));
        receipt.feedingSource = feeding;
        strlcpy(receipt.result, "queue_full", sizeof(receipt.result));
        acknowledge(queued, receipt);
        Serial.printf("MQTT command queue full; rejected command %s.\n", id);
    } else {
        Serial.printf("[MQTT][CONTROL] command queued id=%s action=%s source=%s\n", id, action, source);
    }
}

bool MqttManager::publishReadings(const SensorReadings& reading) {
    const auto publishSensor = [&](const char* name, bool sensorConnected, bool valid, float value, uint8_t decimals) {
        char topic[128], statusTopic[136], valueText[24];
        snprintf(topic, sizeof(topic), "%s/devices/%s/telemetry/%s",
                 DeviceConfig::MQTT_TOPIC_NAMESPACE, DeviceConfig::DEVICE_ID, name);
        snprintf(statusTopic, sizeof(statusTopic), "%s/status", topic);
        if (sensorConnected && valid) snprintf(valueText, sizeof(valueText), decimals == 1 ? "%.1f" : "%.2f", double(value));
        else snprintf(valueText, sizeof(valueText), "DISCONNECTED");
        const bool effectiveConnected = sensorConnected && valid;
        const bool valuePublished = client.publish(topic, valueText, false);
        const bool statusPublished = client.publish(statusTopic, effectiveConnected ? "CONNECTED" : "DISCONNECTED", false);
        return valuePublished && statusPublished;
    };
    bool scalarTopicsPublished = true;
    scalarTopicsPublished = publishSensor("orp", reading.orpConnected, reading.orpValid, reading.orpMv, 1) && scalarTopicsPublished;
    scalarTopicsPublished = publishSensor("temperature", reading.temperatureConnected, reading.temperatureValid, reading.temperatureC, 2) && scalarTopicsPublished;
    scalarTopicsPublished = publishSensor("ph", reading.phConnected, reading.phValid, reading.ph, 2) && scalarTopicsPublished;
    // Preserve the existing topic contract: the backend interprets
    // `turbidity` as raw ADC and `turbidity-ntu` as calibrated NTU.
    scalarTopicsPublished = publishSensor("turbidity-ntu", reading.turbidityConnected, reading.turbidityValid, reading.turbidityRaw, 1) && scalarTopicsPublished;
    char rawTopic[128], rawStatusTopic[136], valueText[24];
    snprintf(rawTopic, sizeof(rawTopic), "%s/devices/%s/telemetry/turbidity-raw-adc",
             DeviceConfig::MQTT_TOPIC_NAMESPACE, DeviceConfig::DEVICE_ID);
    snprintf(rawStatusTopic, sizeof(rawStatusTopic), "%s/status", rawTopic);
    if (reading.turbidityConnected && reading.turbidityValid)
        snprintf(valueText, sizeof(valueText), "%.0f", double(reading.turbidityDiagnostics.rawAdc));
    else
        snprintf(valueText, sizeof(valueText), "DISCONNECTED");
    const bool rawValuePublished = client.publish(rawTopic, valueText, false);
    const bool rawStatusPublished = client.publish(rawStatusTopic,
        reading.turbidityConnected && reading.turbidityValid ? "CONNECTED" : "DISCONNECTED", false);
    scalarTopicsPublished = rawValuePublished && rawStatusPublished && scalarTopicsPublished;

    // Require a valid system UTC clock. Frame timestamps are reconstructed from
    // monotonic sample ages, never from broker receipt time.
    const uint64_t currentUtcMs = epochMillis();
    const uint32_t currentMonoMs = millis();
    bool framePublished = false;
    bool timestampsValid = false;
    bool frameOverflowed = false;
    bool signatureCreated = false;
    bool envelopeCreated = false;
    if (currentUtcMs) {
        StaticJsonDocument<FRAME_BUFFER_BYTES> frame;
        frame["v"] = 1;
        frame["deviceId"] = DeviceConfig::DEVICE_ID;
        frame["bootId"] = reading.bootId;
        frame["sequence"] = reading.sequence;
        JsonObject sensorTimestamps = frame.createNestedObject("sensorTimestamps");
        JsonObject sensors = frame.createNestedObject("sensors");
        timestampsValid = true;
        char acquiredAt[25] = {};
        timestampsValid = isoTimestampAtAge(currentUtcMs, currentMonoMs, reading.sampledAtMs,
                                             acquiredAt, sizeof(acquiredAt)) && timestampsValid;
        frame["acquiredAt"] = acquiredAt;

        const auto addSensor = [&](const char* name, bool connected, bool valid, float value,
                                   bool valueFinite, uint32_t sampledAtMs,
                                   bool analog, const AnalogDiagnostics& diagnostics) {
            JsonObject sensor = sensors.createNestedObject(name);
            char sensorAt[25] = {};
            const bool timestampValid = isoTimestampAtAge(currentUtcMs, currentMonoMs, sampledAtMs,
                                                           sensorAt, sizeof(sensorAt));
            timestampsValid = timestampValid && timestampsValid;
            sensorTimestamps[name] = sensorAt;
            sensor["connected"] = connected;
            sensor["valid"] = connected && valid && valueFinite && timestampValid;
            sensor["sampleAgeMs"] = uint32_t(currentMonoMs - sampledAtMs);
            const bool usable = connected && valid && valueFinite && timestampValid;
            if (usable) frame[name] = value;
            else frame[name] = nullptr;
            if (analog) {
                sensor["rawAdc"] = diagnostics.rawAdc;
                sensor["voltage"] = diagnostics.voltage;
                sensor["adcMinimum"] = diagnostics.minimum;
                sensor["adcMaximum"] = diagnostics.maximum;
                sensor["adcLast"] = diagnostics.last;
                sensor["clippedSamples"] = diagnostics.clipped;
            }
        };

        addSensor("temperature", reading.temperatureConnected, reading.temperatureValid,
                  reading.temperatureC, isfinite(reading.temperatureC), reading.temperatureSampledAtMs,
                  false, reading.phDiagnostics);
        addSensor("ph", reading.phConnected, reading.phValid, reading.ph,
                  isfinite(reading.ph), reading.phDiagnostics.sampledAtMs, true, reading.phDiagnostics);
        addSensor("orp", reading.orpConnected, reading.orpValid, reading.orpMv,
                  isfinite(reading.orpMv), reading.orpDiagnostics.sampledAtMs, true, reading.orpDiagnostics);

        JsonObject turbidity = sensors.createNestedObject("turbidity");
        char turbidityAt[25] = {};
        const bool turbidityTimestampValid = isoTimestampAtAge(currentUtcMs, currentMonoMs,
            reading.turbidityDiagnostics.sampledAtMs, turbidityAt, sizeof(turbidityAt));
        timestampsValid = turbidityTimestampValid && timestampsValid;
        sensorTimestamps["turbidity"] = turbidityAt;
        turbidity["connected"] = reading.turbidityConnected;
        const bool turbidityReported = isfinite(reading.turbidityRaw) && turbidityTimestampValid;
        const bool turbidityUsable = reading.turbidityConnected && reading.turbidityValid && turbidityReported;
        turbidity["valid"] = turbidityUsable;
        turbidity["sampleAgeMs"] = uint32_t(currentMonoMs - reading.turbidityDiagnostics.sampledAtMs);
        turbidity["rawAdc"] = reading.turbidityDiagnostics.rawAdc;
        turbidity["voltage"] = reading.turbidityDiagnostics.voltage;
        turbidity["adcMinimum"] = reading.turbidityDiagnostics.minimum;
        turbidity["adcMaximum"] = reading.turbidityDiagnostics.maximum;
        turbidity["adcLast"] = reading.turbidityDiagnostics.last;
        turbidity["clippedSamples"] = reading.turbidityDiagnostics.clipped;
        if (turbidityReported) frame["turbidity"] = reading.turbidityRaw;
        else frame["turbidity"] = nullptr;
        frame["turbidityUnit"] = "NTU";

        JsonObject ultrasonic = sensors.createNestedObject("ultrasonic");
        char ultrasonicAt[25] = {};
        const bool ultrasonicTimestampValid = isoTimestampAtAge(currentUtcMs, currentMonoMs,
            reading.ultrasonicSampledAtMs, ultrasonicAt, sizeof(ultrasonicAt));
        timestampsValid = ultrasonicTimestampValid && timestampsValid;
        sensorTimestamps["ultrasonic"] = ultrasonicAt;
        const bool ultrasonicReported = isfinite(reading.tankDistanceCm) &&
            reading.tankDistanceCm > 0.0f && reading.tankDistanceCm <= 800.0f &&
            isfinite(reading.tankLevelPercent) && reading.tankLevelPercent >= 0.0f &&
            reading.tankLevelPercent <= 100.0f && ultrasonicTimestampValid;
        const bool ultrasonicUsable = reading.ultrasonicConnected && reading.ultrasonicValid && ultrasonicReported;
        ultrasonic["connected"] = reading.ultrasonicConnected;
        ultrasonic["valid"] = ultrasonicUsable;
        ultrasonic["sampleAgeMs"] = uint32_t(currentMonoMs - reading.ultrasonicSampledAtMs);
        if (ultrasonicReported) {
            frame["tankDistanceCm"] = reading.tankDistanceCm;
            frame["tankLevelPercent"] = reading.tankLevelPercent;
        } else {
            frame["tankDistanceCm"] = nullptr;
            frame["tankLevelPercent"] = nullptr;
        }

        frameOverflowed = frame.overflowed();
        if (timestampsValid && !frameOverflowed) {
            char topic[160], signature[65];
            snprintf(topic, sizeof(topic), "%s/devices/%s/telemetry/frame",
                     DeviceConfig::MQTT_TOPIC_NAMESPACE, DeviceConfig::DEVICE_ID);
            const size_t frameSize = serializeJson(frame, unsignedFramePayload, sizeof(unsignedFramePayload));
            size_t payloadSize = 0;
            if (frameSize > 0 && frameSize < sizeof(unsignedFramePayload) &&
                (signatureCreated = hmacHex(unsignedFramePayload, signature, sizeof(signature)))) {
                int prefixSize = snprintf(signedFramePayload, sizeof(signedFramePayload), "{\"frame\":\"");
                if (prefixSize > 0 && size_t(prefixSize) < sizeof(signedFramePayload)) {
                    payloadSize = size_t(prefixSize);
                    for (size_t i = 0; i < frameSize && payloadSize + 80 < sizeof(signedFramePayload); ++i) {
                        const char value = unsignedFramePayload[i];
                        if (value == '"' || value == '\\') signedFramePayload[payloadSize++] = '\\';
                        if (uint8_t(value) < 0x20) { payloadSize = 0; break; }
                        signedFramePayload[payloadSize++] = value;
                    }
                    if (payloadSize > 0) {
                        const int suffixSize = snprintf(signedFramePayload + payloadSize,
                            sizeof(signedFramePayload) - payloadSize, "\",\"signature\":\"%s\"}", signature);
                        if (suffixSize > 0 && size_t(suffixSize) < sizeof(signedFramePayload) - payloadSize) {
                            payloadSize += size_t(suffixSize);
                            envelopeCreated = true;
                            framePublished = client.publish(topic,
                                reinterpret_cast<const uint8_t*>(signedFramePayload), payloadSize, false);
                        }
                    }
                }
            }
        }
    }
    if (!framePublished) {
        const char* failure = !currentUtcMs ? "utc_unavailable" : !timestampsValid ? "sample_timestamp_invalid" :
            frameOverflowed ? "frame_overflow" : !signatureCreated ? "signing_or_serialization_failed" :
            !envelopeCreated ? "signed_envelope_failed" : "broker_rejected_frame";
        Serial.printf("[MQTT] frame publish failed seq=%lu reason=%s scalarTopics=%s\n",
            static_cast<unsigned long>(reading.sequence), failure,
            scalarTopicsPublished ? "ok" : "partial");
    }
    // Public-dev ingestion accepts signed timestamped frames. Legacy scalar
    // topics remain best-effort and cannot determine dashboard delivery.
    return framePublished;
}

bool MqttManager::publishAcknowledgement(const MqttActuatorCommand& command, const CommandReceipt& receipt,
                                         const SystemState& state) {
    if (!DeviceConfig::MQTT_ACTUATOR_COMMANDS_ENABLED) return false;
    const uint64_t reportedAt = epochMillis();
    if (!reportedAt) return false;
    char signature[65];
    const char* source = command.source;
    // The publish occurs only while the MQTT connection is active.
    char fullCanonical[680];
    snprintf(fullCanonical, sizeof(fullCanonical),
        "v1|%s|%s|%s|%s|%s|%llu|%d|%d|%d|%d|%d|%d|%s|%s|%d|%d|%d|%d|%lu",
        DeviceConfig::DEVICE_ID, command.command.id, source, command.action, receipt.result,
        static_cast<unsigned long long>(reportedAt), state.fillPump, state.drainPump, state.aerator,
        state.feederBusy, state.buzzer, state.automation, state.waterPhase, state.fault,
        state.relaysReady, state.rtcTimeValid, state.wifiConnected, 1,
        static_cast<unsigned long>(state.uptimeMs));
    if (!hmacHex(fullCanonical, signature, sizeof(signature))) return false;
    StaticJsonDocument<STATE_BUFFER_BYTES> doc;
    doc["v"] = 1; doc["deviceId"] = DeviceConfig::DEVICE_ID; doc["id"] = command.command.id;
    doc["source"] = source; doc["action"] = command.action; doc["result"] = receipt.result; doc["reportedAt"] = reportedAt;
    JsonObject reported = doc.createNestedObject("state");
    reported["fillPump"] = state.fillPump; reported["drainPump"] = state.drainPump; reported["aerator"] = state.aerator;
    reported["feederBusy"] = state.feederBusy; reported["buzzer"] = state.buzzer; reported["automation"] = state.automation;
    reported["waterPhase"] = state.waterPhase; reported["fault"] = state.fault; reported["relaysReady"] = state.relaysReady;
    reported["timeValid"] = state.rtcTimeValid; reported["wifiConnected"] = state.wifiConnected;
    reported["mqttConnected"] = true; reported["uptimeMs"] = state.uptimeMs; doc["signature"] = signature;
    char topic[96], payload[STATE_BUFFER_BYTES];
    snprintf(topic, sizeof(topic), "%s/%s/state", DeviceConfig::MQTT_CONTROL_TOPIC_NAMESPACE, DeviceConfig::DEVICE_ID);
    const size_t size = serializeJson(doc, payload, sizeof(payload));
    PubSubClient& publisher = DeviceConfig::MQTT_CONTROL_PUBLIC_ENABLED ? client : controlClient;
    return size > 0 && publisher.publish(topic, reinterpret_cast<const uint8_t*>(payload), size, false);
}

void MqttManager::run() {
    SensorReadings latest{}; SystemState latestState{};
    bool hasSnapshot = false, attemptedConnection = false, attemptedPublish = false, staleStatusPublished = false;
    bool controlSubscriptionReady = false;
    uint32_t lastReconnectMs = 0, lastControlReconnectMs = 0, lastPublishMs = 0, publishedSequence = 0;
    bool attemptedControlConnection = false;
    uint32_t reconnectDelayMs = DeviceConfig::MQTT_RECONNECT_INTERVAL_MS;
    uint32_t reconnectAttempts = 0, reconnectFailures = 0, consecutiveReconnectFailures = 0;
    uint32_t publishSuccesses = 0, publishFailures = 0;
    uint32_t lastDiagnosticsMs = millis();
    for (;;) {
        if (xQueueReceive(snapshots, &latest, 0) == pdTRUE) { hasSnapshot = true; staleStatusPublished = false; }
        xQueueReceive(states, &latestState, 0);
        const uint32_t nowMs = millis();
        if (WiFi.status() != WL_CONNECTED) {
            transport.stop(); controlTransport.stop(); connected.store(false); controlConnected.store(false);
            controlSubscriptionReady = false;
        }
        else {
            if (!client.connected() && (!attemptedConnection || uint32_t(nowMs - lastReconnectMs) >= reconnectDelayMs)) {
                attemptedConnection = true; connected.store(false);
                ++reconnectAttempts;
                const bool useMqttAuthentication = DeviceConfig::MQTT_AUTHENTICATION_ENABLED && Secrets::MQTT_USERNAME[0] != '\0';
                const bool ok = useMqttAuthentication
                    ? client.connect(DeviceConfig::MQTT_CLIENT_ID, Secrets::MQTT_USERNAME, Secrets::MQTT_PASSWORD)
                    : client.connect(DeviceConfig::MQTT_CLIENT_ID);
                lastReconnectMs = millis();
                if (ok) {
                    reconnectDelayMs = DeviceConfig::MQTT_RECONNECT_INTERVAL_MS;
                    consecutiveReconnectFailures = 0;
                    Serial.printf("[MQTT] connected attempts=%lu\n", static_cast<unsigned long>(reconnectAttempts));
                    if (controlConfigured && DeviceConfig::MQTT_CONTROL_PUBLIC_ENABLED) {
                        char topic[128];
                        snprintf(topic, sizeof(topic), "%s/%s/command", DeviceConfig::MQTT_CONTROL_TOPIC_NAMESPACE,
                                 DeviceConfig::DEVICE_ID);
                        const bool subscribed = client.subscribe(topic, 1);
                        controlSubscriptionReady = subscribed;
                        controlConnected.store(subscribed);
                        Serial.printf("[MQTT][CONTROL] public HMAC subscription=%d\n", subscribed);
                    }
                } else {
                    ++reconnectFailures;
                    ++consecutiveReconnectFailures;
                    const uint32_t exponential = consecutiveReconnectFailures <= 1
                        ? DeviceConfig::MQTT_RECONNECT_INTERVAL_MS
                        : (reconnectDelayMs >= DeviceConfig::MQTT_RECONNECT_MAX_MS / 2
                            ? DeviceConfig::MQTT_RECONNECT_MAX_MS : reconnectDelayMs * 2);
                    const uint32_t jitterMs = esp_random() % 1000U;
                    reconnectDelayMs = exponential > DeviceConfig::MQTT_RECONNECT_MAX_MS - jitterMs
                        ? DeviceConfig::MQTT_RECONNECT_MAX_MS : exponential + jitterMs;
                }
                if (!ok) Serial.printf("[MQTT] connect failed state=%d retryInMs=%lu\n", client.state(),
                                       static_cast<unsigned long>(reconnectDelayMs));
            }
            client.loop(); connected.store(client.connected());
            if (controlConfigured && !DeviceConfig::MQTT_CONTROL_PUBLIC_ENABLED && !controlClient.connected() &&
                (!attemptedControlConnection || uint32_t(nowMs - lastControlReconnectMs) >= DeviceConfig::MQTT_RECONNECT_INTERVAL_MS)) {
                attemptedControlConnection = true;
                const bool controlOk = controlClient.connect(DeviceConfig::MQTT_CONTROL_CLIENT_ID,
                    Secrets::MQTT_USERNAME, Secrets::MQTT_PASSWORD);
                lastControlReconnectMs = millis();
                if (controlOk) {
                    char topic[128];
                    snprintf(topic, sizeof(topic), "%s/%s/command", DeviceConfig::MQTT_CONTROL_TOPIC_NAMESPACE,
                             DeviceConfig::DEVICE_ID);
                    const bool subscribed = controlClient.subscribe(topic, 1);
                    Serial.printf("[MQTT][CONTROL] connected subscribed=%d\n", subscribed);
                } else {
                    Serial.printf("[MQTT][CONTROL] connect failed state=%d\n", controlClient.state());
                }
            }
            if (controlConfigured && DeviceConfig::MQTT_CONTROL_PUBLIC_ENABLED) {
                controlConnected.store(client.connected() && controlSubscriptionReady);
            } else if (controlConfigured) {
                controlClient.loop(); controlConnected.store(controlClient.connected());
            }
            if (xQueueReceive(snapshots, &latest, 0) == pdTRUE) { hasSnapshot = true; staleStatusPublished = false; }
            xQueueReceive(states, &latestState, 0);
            MqttPendingAcknowledgement pending{};
            if (controlConfigured && (DeviceConfig::MQTT_CONTROL_PUBLIC_ENABLED ? client.connected() : controlClient.connected()) &&
                xQueueReceive(acknowledgements, &pending, 0) == pdTRUE) {
                const bool publishedAck = publishAcknowledgement(pending.command, pending.receipt, latestState);
                Serial.printf("[MQTT][CONTROL] ack id=%s result=%s published=%d\n",
                              pending.command.command.id, pending.receipt.result, publishedAck);
            }
            const uint32_t publishMs = millis();
            const bool stale = hasSnapshot && uint32_t(publishMs - latest.sampledAtMs) > DeviceConfig::TELEMETRY_MAX_AGE_MS;
            if (client.connected() && stale && !staleStatusPublished &&
                (!attemptedPublish || uint32_t(publishMs - lastPublishMs) >= DeviceConfig::MQTT_PUBLISH_INTERVAL_MS)) {
                SensorReadings disconnected = latest;
                disconnected.phValid = disconnected.temperatureValid = disconnected.turbidityValid = disconnected.orpValid = false;
                disconnected.phConnected = disconnected.temperatureConnected = disconnected.turbidityConnected = disconnected.orpConnected = false;
                attemptedPublish = true; lastPublishMs = publishMs; staleStatusPublished = publishReadings(disconnected);
                if (staleStatusPublished) ++publishSuccesses; else ++publishFailures;
                Serial.printf("[MQTT] stale telemetry seq=%lu %s\n",
                              static_cast<unsigned long>(latest.sequence),
                              staleStatusPublished ? "unavailable status published" : "status publish failed");
            }
            if (client.connected() && hasSnapshot && latest.sequence != publishedSequence && !stale &&
                (!attemptedPublish || uint32_t(publishMs - lastPublishMs) >= DeviceConfig::MQTT_PUBLISH_INTERVAL_MS)) {
                attemptedPublish = true; lastPublishMs = publishMs;
                const bool published = publishReadings(latest);
                if (published) ++publishSuccesses; else ++publishFailures;
                Serial.printf("[MQTT] telemetry seq=%lu %s\n",
                              static_cast<unsigned long>(latest.sequence), published ? "published" : "publish failed");
                if (published) publishedSequence = latest.sequence;
            }
            if (uint32_t(publishMs - lastDiagnosticsMs) >= 60000) {
                Serial.printf("[MQTT][HEALTH] reconnectAttempts=%lu reconnectFailures=%lu publishSuccesses=%lu publishFailures=%lu workerStackHighWaterWords=%u state=%d\n",
                    static_cast<unsigned long>(reconnectAttempts), static_cast<unsigned long>(reconnectFailures),
                    static_cast<unsigned long>(publishSuccesses), static_cast<unsigned long>(publishFailures),
                    unsigned(uxTaskGetStackHighWaterMark(nullptr)), client.state());
                reconnectAttempts = reconnectFailures = publishSuccesses = publishFailures = 0;
                lastDiagnosticsMs = publishMs;
            }
        }
        vTaskDelay(pdMS_TO_TICKS(DeviceConfig::MQTT_TASK_POLL_MS));
    }
}
