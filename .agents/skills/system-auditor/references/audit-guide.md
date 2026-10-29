# AquaSense audit guide

## Establish the real system boundary

Inspect the current checkout, not assumptions in prior conversations. Useful starting points include `README.md`, `Backend/src`, `Frontend/src`, `Hardware/README.md`, `Hardware/src`, `Hardware/include`, package manifests, tests, deployment/configuration files, and `.codex/agents/`. Follow actual imports, API routes, message topics, data models, and command paths. Treat documentation as a claim to verify; record significant code/documentation conflicts.

The repository has a React/TypeScript frontend, Node.js/Express/TypeScript backend, PostgreSQL/Sequelize persistence, and ESP32/PlatformIO firmware. Verify current state rather than assuming every documented target or integration is present or enabled. Sensor availability and quality depend on the selected device, calibration, ingestion route, and measurement provenance. Common fields include temperature, pH, dissolved oxygen, turbidity, and ammonia; ORP may exist as a distinct optional measurement. Never substitute ORP for dissolved oxygen or describe an estimate as a direct measurement.

The analytics implementation should be characterized from its code and evidence. Risk scores and threshold/trend estimates are preliminary water-quality indicators unless the repository demonstrates suitable scientific validation. Do not call them a validated crayfish mortality model. Check whether labels, confidence, recommendations, or estimated time-to-threshold overstate the methodology or input quality.

Distinguish interface behavior, backend command support, firmware implementation, commissioning/configuration, and verified physical behavior. A command acknowledgement proves software-level acceptance/receipt only unless independent physical feedback is implemented. Report disabled-by-default controls, safety gates, stale data handling, missing sensors, and commissioning assumptions. Never issue commands to devices.

## Review areas

Select areas relevant to the requested audit; do not force a finding in every area.

- **Architecture:** actual directory and dependency boundaries, duplicated or legacy paths, broken imports, circular dependencies, and cross-layer data/command flow. Claim static-analysis findings only when supported by tool output or import/reference evidence.
- **Backend/data:** route and controller validation, authentication/authorization, response/error behavior, ownership, database queries/transactions, schema evolution, timestamps, units, missing/invalid/stale values, and measurement provenance.
- **Frontend:** API paths, live updates, loading/error/empty states, accessible semantics, and responsive behavior. Mark visual heuristic concerns as potential unless reproducibly verified.
- **Analytics/water quality:** formulas, thresholds, risk categories, trend window/slope, confidence, ETA assumptions, calibration and scientific support, unavailable-input behavior, and displayed claims.
- **IoT/automation:** MQTT/HTTP authentication, reconnect/recovery, stale telemetry, command validation and acknowledgement, idempotency/replay, bounds, expiry/timeouts, relay interlocks, startup/reset state, communication loss, manual controls, and failure recovery where implemented.
- **Security:** secret exposure (report location/type only, never the value), session/device auth, access control, injection, CORS, rate limits, sensitive logs, and administrative routes. Do not perform destructive or intrusive testing.
- **Validation:** discover existing lint/type-check/build/test commands. Use only safe checks with available dependencies and no external side effects. Do not install dependencies, run migrations/deployments, or claim unrun checks passed.

## Findings and report

Use severity labels consistently (Critical, High, Medium, Low); explain confidence. A finding should include affected file and line when available, evidence, technical explanation, impact, recommendation, and verification status. Keep confirmed defects distinct from potential risks, documentation mismatches, and unverified questions. Avoid speculative claims and duplicate findings.

For a full system audit, structure the report as:

1. Executive Summary
2. Repository Architecture
3. Critical Findings
4. High-Priority Findings
5. Medium-Priority Findings
6. Low-Priority Findings
7. Security Assessment
8. IoT and Automation Safety Assessment
9. Risk Scoring and Trend Analysis Assessment
10. Test and Build Results
11. Recommended Fixes
12. Final Audit Status

For a narrower audit, keep the output proportional while retaining evidence, limitations, and verification status. State which checks were not run and why. Never report secrets, fabricate file references or results, or imply deployment/hardware validation from a code review.
