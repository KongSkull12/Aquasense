# AquaSense — Final ERD (Implemented + Architecture)

![Final ERD](docs/ERD_final.png)

**Overview:**

- This document describes the final, comprehensive ERD that combines the repository's implemented schema and the additional architecture elements (tanks, sensors, solar, relays, control logs, notifications) from your system diagram.

**Tables & Columns (concise):**

- **`users`**: PK `id` (UUID); `full_name`, `email` (unique), `role`, `password_hash`, `created_at`, `updated_at`.

- **`tanks`**: PK `tank_id` (UUID); FK `user_id` → `users.id`; `tank_name`, `location`, `created_at`, `updated_at`.

- **`devices`**: PK `id` (UUID); FK `user_id` → `users.id`; FK `tank_id` → `tanks.tank_id`; `device_id` (external id, string), `name`, `is_active`, `created_at`, `updated_at`.

- **`sensor_types`**: PK `sensor_type_id` (UUID); `name` (e.g., pH, temperature), `unit`, `description`, `created_at`, `updated_at`.

- **`sensors`**: PK `sensor_id` (UUID); FK `tank_id` → `tanks.tank_id`; FK `device_id` → `devices.id`; FK `sensor_type_id` → `sensor_types.sensor_type_id`; `status`, `installed_at`, `created_at`, `updated_at`.

- **`sensor_readings`**: PK `reading_id` (UUID); FK `sensor_id` → `sensors.sensor_id`; FK `device_id` → `devices.device_id` (or `devices.id` if you prefer UUID link); `value` (double), `recorded_at`, `location`, `created_at`, `updated_at`.

- **`water_quality_rules`**: PK `rule_id` (UUID); FK `sensor_type_id` → `sensor_types.sensor_type_id`; `min_value`, `max_value`, `severity`, `description`.

- **`relays`**: PK `relay_id` (UUID); FK `tank_id` → `tanks.tank_id`; `type` (pump, aerator, feeder), `status`, `created_at`, `updated_at`.

- **`water_control_logs`**: PK `water_log_id` (UUID); FK `tank_id` → `tanks.tank_id`; FK `relay_id` → `relays.relay_id`; `action`, `reason`, `triggered_at`, `created_at`.

- **`feeding_schedules`**: PK `id` (UUID); FK `user_id` → `users.id`; FK `tank_id` → `tanks.tank_id`; `time`, `date`, `enabled`, `label`, `last_triggered_at`, `created_at`, `updated_at`.

- **`feeding_commands`**: PK `id` (UUID); FK `user_id` → `users.id`; FK `device_id` → `devices.device_id` (or `devices.id`); `action` (ON/OFF/TRIGGER), `source` (MANUAL/SCHEDULE), `status`, `metadata` (JSONB), `executed_at`, `created_at`, `updated_at`.

- **`solar_systems`**: PK `solar_id` (UUID); FK `tank_id` → `tanks.tank_id`; FK `device_id` → `devices.id`; `panel_voltage`, `battery_level` (percent), `power_output`, `recorded_at`, `created_at`, `updated_at`.

- **`battery_logs`**: PK `battery_log_id` (UUID); FK `solar_id` → `solar_systems.solar_id`; FK `device_id` → `devices.id`; `voltage`, `percentage`, `recorded_at`, `created_at`, `updated_at`.

- **`alerts`**: PK `id` (UUID); FK `tank_id` → `tanks.tank_id` (nullable); FK `device_id` → `devices.device_id`; FK `sensor_id` → `sensors.sensor_id` (nullable); `category`, `severity`, `current_value`, `threshold_value`, `unit`, `action`, `message`, `status`, `sms_sent_at`, `created_at`, `updated_at`.

- **`sms_notifications`**: PK `sms_id` (UUID); FK `alert_id` → `alerts.id`; `phone_number`, `status` (sent/failed/pending), `sent_at`, `created_at`.

- **`sms_logs`**: PK `id` (UUID); FK `alert_id` → `alerts.id`; FK `device_id` → `devices.device_id`; `category`, `severity`, `recipient`, `provider`, `provider_response` (text), `success` (boolean), `retry_count`, `sent_at`, `created_at`, `updated_at`.

- **`system_logs`**: PK `log_id` (UUID); FK `tank_id` → `tanks.tank_id`; FK `device_id` → `devices.device_id`; `action`, `description`, `created_at`.

- **`prediction_logs`**: PK `id` (UUID); `risk_score`, `risk_level`, `predicted_issue`, `eta_minutes`, FK `triggered_alert_id` → `alerts.id`, `created_at`, `updated_at`.

- **`audit_logs`**: PK `id` (UUID); FK `user_id` → `users.id`; FK `device_id` → `devices.device_id`; `action`, `status`, `ip_address`, `metadata` (JSONB), `created_at`, `updated_at`.

**Relationships (textual):**

- `users` 1 — \* `tanks` (a user can own many tanks).
- `users` 1 — \* `devices` (a user may own many devices).
- `tanks` 1 — \* `devices` (a tank can host multiple devices).
- `tanks` 1 — \* `sensors` (a tank contains multiple sensors).
- `devices` 1 — \* `sensors` (a device may host multiple sensors).
- `sensors` 1 — \* `sensor_readings` (each sensor produces many readings).
- `sensor_types` 1 — \* `sensors` and `water_quality_rules` (types define rules and sensors).
- `water_quality_rules` are checked against `sensor_readings` to generate `alerts`.
- `alerts` 1 — \* `sms_notifications` / `sms_logs` (alerts trigger notifications and logs).
- `relays` 1 — \* `water_control_logs` (relays produce control logs when actuated).
- `tanks` 1 — \* `solar_systems` and `battery_logs` (solar/battery are associated with tanks/devices).
- `feeding_schedules` 1 — \* `feeding_commands` (schedules may result in commands; commands are executed on devices).
- `prediction_logs` reference `alerts` when predictions trigger alerts.
- `audit_logs` track user/device actions across the system.

**Notes & Recommendations:**

- Implemented schema in the repo uses `devices` + `sensor_readings` (multi-metric rows) rather than separate `sensors`/`sensor_types`. If you adopt the final ERD above, update models and migrations to add `tanks`, `sensors`, `sensor_types`, `solar_systems`, `battery_logs`, `water_control_logs`, and `sms_notifications` tables and preserve backward compatibility (data migration) for existing `sensor_readings`.
- For referential consistency use `devices.id` (UUID) for FK links rather than mixing `device_id` string and UUID; choose one canonical device identifier.

If you want, I can:

- Create Sequelize model stubs + migrations for the missing tables, or
- Export this Markdown to your README and commit the changes.

Which should I do next?
