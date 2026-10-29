#pragma once
#include <stdint.h>

enum class CommandAction {
    Fill, Drain, WaterExchange, WaterStop, AeratorOn, AeratorOff, AeratorAuto,
    AutomationOn, AutomationOff, BuzzerOn, BuzzerOff, AllOff, ClearFault,
    FeedTrigger, FeedOn, FeedOff, Invalid
};
struct Command {
    char id[37] = {};
    bool feedingSource = false;
    CommandAction action = CommandAction::Invalid;
    uint32_t durationMs = 0;
    uint32_t receivedAtMs = 0;
    uint32_t ttlMs = 0;
};
struct CommandReceipt {
    char id[37] = {};
    bool feedingSource = false;
    char result[64] = {};
};
