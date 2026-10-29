export interface DashboardProfile {
  farmerName: string;
  farmName: string;
  tankName: string;
  projectDescription: string;
  location: string;
  contactNumber: string;
}

const PROFILE_KEY = 'farmerProfile';

const readStoredUserName = (): string => {
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}') as { fullName?: string; name?: string };
    return user.fullName || user.name || 'Farmer';
  } catch {
    return 'Farmer';
  }
};

export const getDashboardProfile = (): DashboardProfile => {
  const defaults: DashboardProfile = {
    farmerName: readStoredUserName(),
    farmName: 'AquaSense Farm',
    tankName: 'Main Tank',
    projectDescription: 'IoT-based water quality monitoring and feeding support for crayfish farming.',
    location: 'Farm site',
    contactNumber: '',
  };

  try {
    const saved = JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}') as Partial<DashboardProfile>;
    return { ...defaults, ...saved };
  } catch {
    return defaults;
  }
};

export const saveDashboardProfile = (profile: DashboardProfile) => {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  window.dispatchEvent(new Event('farmerProfileUpdated'));
};
