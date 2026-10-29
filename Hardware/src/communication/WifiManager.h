#pragma once
#include <stdint.h>

class WifiManager {
public:
    void begin();
    void update(uint32_t nowMs);
    bool isConnected() const;
    uint32_t reconnectAttempts() const;
private:
    uint32_t lastReconnectMs = 0;
    uint32_t lastCheckMs = 0;
    uint32_t retryDelayMs = 3000;
    uint32_t reconnectAttemptCount = 0;
    bool wasConnected = false;
};
