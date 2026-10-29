#pragma once
#include <stdint.h>

// Reporting snapshot. Managers retain ownership of their actual state.
struct SystemState {
    bool wifiConnected = false;
    bool mqttConnected = false;
    bool mqttWorkerRunning = false;
    bool rtcAvailable = false;
    bool rtcTimeValid = false;
    bool fillPump = false;
    bool drainPump = false;
    bool aerator = false;
    bool feederBusy = false;
    bool buzzer = false;
    bool automation = false;
    bool relaysReady = false;
    char waterPhase[24] = "IDLE";
    char fault[64] = {};
    uint32_t uptimeMs = 0;
};
