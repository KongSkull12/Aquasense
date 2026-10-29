---
name: code-exploration
description: Map relevant AquaSense code paths and dependencies before a change or bug investigation; use when the responsible files or execution flow are unclear.
---

# AquaSense Code Exploration

Use targeted searches and inspect the smallest relevant set of files. Trace the
actual route, call, import, topic, data, or command path and its related tests.
Map only boundaries supported by repository evidence across frontend, backend,
database, analytics, MQTT, and ESP32 firmware. Treat documentation as a claim to
verify; distinguish implemented behavior from configured, commissioned, or
physically verified behavior.

Return relevant paths and symbols, a concise execution/data flow, dependencies,
related tests, likely impact areas, and unresolved questions. Keep investigation
proportional to the task. This is a reusable exploration procedure; continue the
requested work after mapping rather than treating exploration as an end state.
