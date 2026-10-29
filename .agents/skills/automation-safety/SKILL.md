---
name: automation-safety
description: Evaluate AquaSense pump, aerator, feeder, relay, and manual-control safety when analyzing an actuator path or failure scenario.
---

# AquaSense Automation Safety

Inspect implemented logic and active configuration for startup states, sensor
validity and freshness, timeouts, runtime limits, interlocks, manual override,
restart, communication loss, and recovery as relevant. Treat absent safeguards
as gaps and disabled or uncommissioned controls accordingly. Do not infer that
relay polarity, wiring, or physical behavior is safe from source code alone.

Describe the current behavior and failure scenario, cite evidence, identify the
safety consequence, and recommend a bounded correction and verification. Never
send device commands or activate hardware during a code review.
