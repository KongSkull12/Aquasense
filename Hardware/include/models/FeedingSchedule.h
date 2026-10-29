#pragma once
#include <stdint.h>

constexpr uint8_t MAX_FEEDING_SCHEDULES = 20;
struct FeedingSchedule {
    char id[37] = {};
    char date[11] = {}; // Empty means daily, otherwise YYYY-MM-DD.
    char time[6] = {};  // HH:mm, Asia/Manila.
};
struct FeedingSchedules {
    uint8_t count = 0;
    FeedingSchedule items[MAX_FEEDING_SCHEDULES] = {};
};
