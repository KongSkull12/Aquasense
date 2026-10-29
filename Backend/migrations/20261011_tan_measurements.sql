CREATE TABLE IF NOT EXISTS tan_measurements (
  id UUID PRIMARY KEY,
  device_id VARCHAR(120) NOT NULL,
  entered_by_user_id UUID NOT NULL,
  value DOUBLE PRECISION NOT NULL CHECK (value >= 0),
  unit VARCHAR(16) NOT NULL CHECK (unit = 'mg/L as N'),
  source VARCHAR(24) NOT NULL CHECK (source IN ('test_kit', 'laboratory', 'external_sensor', 'manual')),
  sample_collected_at TIMESTAMPTZ NOT NULL,
  entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  validation_evidence TEXT NOT NULL,
  validation_status VARCHAR(24) NOT NULL DEFAULT 'USER_ATTESTED' CHECK (validation_status = 'USER_ATTESTED'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tan_measurements_device_sample_idx
  ON tan_measurements (device_id, sample_collected_at DESC);
CREATE INDEX IF NOT EXISTS tan_measurements_user_entry_idx
  ON tan_measurements (entered_by_user_id, entered_at DESC);
