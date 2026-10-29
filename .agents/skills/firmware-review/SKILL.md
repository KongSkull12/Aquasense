---
name: firmware-review
description: Trace or review AquaSense ESP32 firmware behavior for sensor acquisition, MQTT, timing, display, feeding, or actuator control.
---

# AquaSense Firmware Review

Verify the active PlatformIO environment, board definition, pins, and current
hardware documentation before relying on target assumptions. Trace readings
from raw acquisition through conversion, calibration, filtering, validation,
and publication. For control paths, follow command validation, state changes,
timeouts, startup/restart, and communication recovery.

Treat firmware support as distinct from physical installation and commissioning.
ORP is not dissolved oxygen, raw ADC is not automatically calibrated, and pH
plus temperature do not directly measure total ammonia. Report evidence and
focused verification; avoid broad rewrites for a local defect.
