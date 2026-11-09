# AquaSense - Implemented Database ERD

This file contains a Mermaid ER diagram that represents the final implemented schema (based on the Sequelize models and migrations in `Backend/src/database/models`).

```mermaid
erDiagram
    USERS {
        UUID id PK
        string full_name
        string email
        enum role
        string password_hash
        timestamptz created_at
        timestamptz updated_at
    }

    DEVICES {
        UUID id PK
        UUID user_id FK
        string device_id
        string name
        boolean is_active
        timestamptz created_at
        timestamptz updated_at
    }

    SENSOR_READINGS {
        UUID id PK
        string device_id FK
        double temperature
        double ph
        double do
        double turbidity
        double ammonia
        string location
        timestamptz timestamp
        timestamptz created_at
        timestamptz updated_at
    }

    ALERTS {
        UUID id PK
        string device_id FK
        string category
        string severity
        double current_value
        double threshold_value
        string unit
        string action
        string message
        string status
        timestamptz sms_sent_at
        timestamptz created_at
        timestamptz updated_at
    }

    SMS_LOGS {
        UUID id PK
        UUID alert_id FK
        string device_id FK
        string category
        string severity
        string recipient
        string provider
        text provider_response
        boolean success
        int retry_count
        timestamptz sent_at
        timestamptz created_at
        timestamptz updated_at
    }

    FEEDING_SCHEDULES {
        UUID id PK
        UUID user_id FK
        string time
        string date
        boolean enabled
        string label
        timestamptz last_triggered_at
        timestamptz created_at
        timestamptz updated_at
    }

    FEEDING_COMMANDS {
        UUID id PK
        UUID user_id FK
        string device_id FK
        enum action
        enum source
        enum status
        jsonb metadata
        timestamptz executed_at
        timestamptz created_at
        timestamptz updated_at
    }

    PREDICTION_LOGS {
        UUID id PK
        double risk_score
        string risk_level
        string predicted_issue
        int eta_minutes
        UUID triggered_alert_id FK
        timestamptz created_at
        timestamptz updated_at
    }

    AUDIT_LOGS {
        UUID id PK
        UUID user_id FK
        string device_id FK
        string action
        string status
        string ip_address
        jsonb metadata
        timestamptz created_at
        timestamptz updated_at
    }

    %% Relationships
    USERS ||--o{ DEVICES : "owns"
    USERS ||--o{ FEEDING_SCHEDULES : "creates"
    USERS ||--o{ FEEDING_COMMANDS : "issues"

    DEVICES ||--o{ SENSOR_READINGS : "records"
    DEVICES ||--o{ ALERTS : "triggers"
    DEVICES ||--o{ FEEDING_COMMANDS : "target"
    DEVICES ||--o{ AUDIT_LOGS : "audited_in"

    ALERTS ||--o{ SMS_LOGS : "notified_by"
    ALERTS ||--o{ PREDICTION_LOGS : "may_trigger"

    PREDICTION_LOGS }o--|| ALERTS : "triggered_alert"

    AUDIT_LOGS }o--|| USERS : "performed_by"
    AUDIT_LOGS }o--|| DEVICES : "related_to"

```

Notes:

- This ERD describes the schema implemented in `Backend/src/database/models` and the migration in `Backend/migrations/20260512_alert_sms.sql`.
- The original diagram you provided (tanks, sensors, sensor_types, relays, solar_system, etc.) is not present in code; instead the implementation uses `devices` and embeds multiple sensor metrics in `sensor_readings`.

Rendering:

- You can preview this Mermaid diagram in VS Code with the "Markdown Preview Mermaid Support" or the "Mermaid Preview" extension, or use the `mmdc` CLI to export to PNG/SVG.

Example `mmdc` command to export to PNG:

```bash
# install mermaid-cli globally if needed
npm install -g @mermaid-js/mermaid-cli
# render
mmdc -i docs/ERD.md -o docs/ERD.png
```
