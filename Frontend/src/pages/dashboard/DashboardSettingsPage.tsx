import React, { useState } from 'react';
import { DeviceManagement } from '../../components/WaterQuality/DeviceManagement';
import { DashboardProfile, getDashboardProfile, saveDashboardProfile } from '../../components/WaterQuality/dashboardProfile';
import { KeyValues, PageHead, Panel, StateMark } from '../../components/WaterQuality/Console';

const fields: Array<{ key: keyof DashboardProfile; label: string; wide?: boolean; hint?: string; type?: string }> = [
  { key: 'farmerName', label: 'Farmer name' },
  { key: 'contactNumber', label: 'Contact number', type: 'tel', hint: 'Shown on the dashboard only. It does not change who receives SMS alerts; that is set on the server.' },
  { key: 'farmName', label: 'Farm name' },
  { key: 'tankName', label: 'Tank name' },
  { key: 'location', label: 'Location', wide: true },
];

const DashboardSettingsPage: React.FC = () => {
  const [profile, setProfile] = useState<DashboardProfile>(getDashboardProfile);
  const [saved, setSaved] = useState(false);

  const updateField = (field: keyof DashboardProfile, value: string) => {
    setProfile((current) => ({ ...current, [field]: value }));
    setSaved(false);
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    saveDashboardProfile(profile);
    setSaved(true);
  };

  return (
    <div className="space-y-5">
      <PageHead title="Settings" description="Devices registered to your account, and the farm details shown across the dashboard." />

      <DeviceManagement />

      <form onSubmit={handleSubmit} className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel
          title="Farm profile"
          description="Saved in this browser only."
          actions={saved ? <StateMark state="ok">Saved</StateMark> : undefined}
        >
          <div className="grid gap-4 md:grid-cols-2">
            {fields.map((field) => (
              <div key={field.key} className={field.wide ? 'md:col-span-2' : undefined}>
                <label className="field-label" htmlFor={`profile-${field.key}`}>{field.label}</label>
                <input id={`profile-${field.key}`} type={field.type || 'text'} value={profile[field.key]} onChange={(e) => updateField(field.key, e.target.value)} className="field" />
                {field.hint && <p className="field-hint">{field.hint}</p>}
              </div>
            ))}
            <div className="md:col-span-2">
              <label className="field-label" htmlFor="profile-description">Project description</label>
              <textarea id="profile-description" value={profile.projectDescription} onChange={(e) => updateField('projectDescription', e.target.value)} rows={3} className="field resize-y" />
            </div>
          </div>
          <div className="mt-5 flex items-center gap-3">
            <button type="submit" className="btn-primary">Save changes</button>
          </div>
        </Panel>

        <Panel title="How it appears">
          <p className="text-base font-semibold">Welcome back, {profile.farmerName}</p>
          <KeyValues className="mt-4" rows={[
            { label: 'Farm', value: profile.farmName },
            { label: 'Tank', value: profile.tankName },
            { label: 'Location', value: profile.location },
          ]} />
          <p className="mt-4 text-[13px] leading-relaxed text-ink-2">{profile.projectDescription}</p>
        </Panel>
      </form>
    </div>
  );
};

export default DashboardSettingsPage;
