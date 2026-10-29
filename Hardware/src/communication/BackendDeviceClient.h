#pragma once
#include <ArduinoJson.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>
#include "models/SystemState.h"
#include "models/FeedingSchedule.h"

// Authenticated HTTP remains responsible for schedule delivery and state reporting.
// Hardware and feeding one-shot commands arrive only through signed MQTT.
class BackendDeviceClient {
public:
    bool begin();
    void update(const SystemState& state);
    bool takeSchedules(FeedingSchedules& schedules);
private:
    static void taskEntry(void* context);
    void run();
    bool sync(const SystemState& state);
    void decode(uint32_t elapsedMs);
    QueueHandle_t states = nullptr, schedulesQueue = nullptr;
    TaskHandle_t task = nullptr;
    StaticJsonDocument<8192> document;
};
