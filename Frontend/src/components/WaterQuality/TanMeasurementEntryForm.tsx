import React, { useEffect, useState } from 'react';
import { apiClient, getApiErrorMessage } from '../../services/apiClient';
import type { TanMeasurementEntry, TanMeasurementRecord, TanSource } from '../../types/water';

interface DeviceOption { deviceId: string; name: string; isActive: boolean; }

const localDateTimeValue = (date: Date): string => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

export function TanMeasurementEntryForm({ onSaved }: { onSaved: (measurement: TanMeasurementRecord) => void }) {
  const [devices, setDevices] = useState<DeviceOption[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [value, setValue] = useState('');
  const [source, setSource] = useState<TanSource>('test_kit');
  const [sampleCollectedAt, setSampleCollectedAt] = useState(() => localDateTimeValue(new Date()));
  const [validationEvidence, setValidationEvidence] = useState('');
  const [attestMeasurement, setAttestMeasurement] = useState(false);
  const [loadingDevices, setLoadingDevices] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    apiClient.get<DeviceOption[]>('/devices')
      .then((response) => {
        if (!active) return;
        const ownedDevices = (response.data || []).filter((device) => device.isActive);
        setDevices(ownedDevices);
        setDeviceId(ownedDevices[0]?.deviceId || '');
      })
      .catch((requestError: unknown) => {
        if (active) setError(getApiErrorMessage(requestError, 'Could not load your registered devices.'));
      })
      .finally(() => { if (active) setLoadingDevices(false); });
    return () => { active = false; };
  }, []);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!attestMeasurement) {
      setError('Confirm that this is a real measured result and the evidence details are accurate.');
      return;
    }
    setSubmitting(true);
    try {
      const payload: TanMeasurementEntry = {
        deviceId,
        value: Number(value),
        source,
        sampleCollectedAt: new Date(sampleCollectedAt).toISOString(),
        validationEvidence: validationEvidence.trim(),
        attestMeasurement: true,
      };
      const response = await apiClient.post<TanMeasurementRecord>('/water/tan-measurements', payload);
      onSaved(response.data);
      setValue('');
      setValidationEvidence('');
      setAttestMeasurement(false);
      setMessage('TAN measurement saved. NH3-N is calculated only when aligned, qualified pH and temperature readings exist.');
    } catch (requestError: unknown) {
      setError(getApiErrorMessage(requestError, 'Could not save the TAN measurement.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm" aria-labelledby="tan-entry-heading">
      <div className="mb-3">
        <h2 id="tan-entry-heading" className="text-sm font-semibold text-gray-800">Record a TAN measurement</h2>
        <p className="mt-1 text-xs text-gray-500">Enter an actual test-kit, laboratory, or sensor result. Sample time is kept separate from entry time; delayed results are matched using sample collection time.</p>
      </div>
      {devices.length === 0 && loadingDevices ? (
        <p role="status" className="rounded-lg bg-gray-50 p-3 text-xs text-gray-600">Loading your registered devices…</p>
      ) : devices.length === 0 ? (
        error
          ? <p role="alert" className="rounded-lg bg-rose-50 p-3 text-xs text-rose-800">{error}</p>
          : <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">Register an active device to your account before adding measurements.</p>
      ) : (
        <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
            Tank / device
            <select required value={deviceId} disabled={loadingDevices || submitting || devices.length === 0} onChange={(event) => setDeviceId(event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2">
              {devices.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.name} ({device.deviceId})</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
            Measured TAN (mg/L as N)
            <input required type="number" min="0" step="any" value={value} onChange={(event) => setValue(event.target.value)} disabled={submitting} className="rounded-lg border border-gray-300 px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
            Measurement source
            <select value={source} onChange={(event) => setSource(event.target.value as TanSource)} disabled={submitting} className="rounded-lg border border-gray-300 px-3 py-2">
              <option value="test_kit">Test kit</option>
              <option value="laboratory">Laboratory</option>
              <option value="external_sensor">External sensor</option>
              <option value="manual">Manual transcription</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
            Sample collection time
            <input required type="datetime-local" value={sampleCollectedAt} onChange={(event) => setSampleCollectedAt(event.target.value)} disabled={submitting} className="rounded-lg border border-gray-300 px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-700 sm:col-span-2">
            Validation evidence / method reference
            <input required minLength={8} maxLength={2000} value={validationEvidence} onChange={(event) => setValidationEvidence(event.target.value)} disabled={submitting} placeholder="Kit brand, lot and expiry; lab report ID; or sensor calibration reference" className="rounded-lg border border-gray-300 px-3 py-2" />
          </label>
          <label className="flex items-start gap-2 text-xs text-gray-600 sm:col-span-2 lg:col-span-3">
            <input required type="checkbox" checked={attestMeasurement} onChange={(event) => setAttestMeasurement(event.target.checked)} disabled={submitting} className="mt-0.5" />
            <span>This is a real measured result and the source and evidence details above are accurate. AquaSense records this as user-attested; it does not independently certify the test method.</span>
          </label>
          {error && <p role="alert" className="text-xs text-rose-700 sm:col-span-2 lg:col-span-3">{error}</p>}
          {message && <p role="status" className="text-xs text-emerald-700 sm:col-span-2 lg:col-span-3">{message}</p>}
          <div className="sm:col-span-2 lg:col-span-3">
            <button type="submit" disabled={submitting || loadingDevices || !deviceId} className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
              {submitting ? 'Saving…' : 'Save TAN measurement'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
