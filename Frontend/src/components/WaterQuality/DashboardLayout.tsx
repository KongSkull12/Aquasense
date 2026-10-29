import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { DashboardIcon } from './DashboardUi';
import { getDashboardProfile } from './dashboardProfile';
import { apiClient } from '../../services/apiClient';
import logo from '../../assets/images/AquaSense_Logo.png';

type NavIcon = Parameters<typeof DashboardIcon>[0]['name'];

const navItems: Array<{ to: string; label: string; icon: NavIcon }> = [
  { to: '/dashboard/overview', label: 'Overview', icon: 'home' },
  { to: '/dashboard/parameters', label: 'Parameters', icon: 'chart' },
  { to: '/dashboard/feeding', label: 'Feeding', icon: 'feed' },
  { to: '/dashboard/water-change', label: 'Water change', icon: 'drain' },
  { to: '/dashboard/aerator', label: 'Aerator', icon: 'aerator' },
  { to: '/dashboard/alerts', label: 'Alerts & logs', icon: 'bell' },
  { to: '/dashboard/settings', label: 'Settings', icon: 'settings' },
];

const readUserLabel = (): string => {
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}') as { fullName?: string; name?: string; email?: string };
    return user.fullName || user.name || user.email || 'Signed in';
  } catch {
    return 'Signed in';
  }
};

export const DashboardLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [profile, setProfile] = useState(getDashboardProfile());
  const userLabel = readUserLabel();

  useEffect(() => {
    const refreshProfile = () => setProfile(getDashboardProfile());
    window.addEventListener('farmerProfileUpdated', refreshProfile);
    return () => window.removeEventListener('farmerProfileUpdated', refreshProfile);
  }, []);

  // Close the phone menu after navigating and on Escape.
  useEffect(() => { setIsMenuOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!isMenuOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setIsMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isMenuOpen]);

  const handleLogout = async () => {
    setIsMenuOpen(false);
    try {
      await apiClient.logout();
    } finally {
      localStorage.removeItem('user');
    }
    navigate('/login');
  };

  const currentLabel = navItems.find((item) => location.pathname.startsWith(item.to))?.label ?? 'Dashboard';

  const rail = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-5 pb-6 pt-5">
        <img src={logo} alt="" className="h-9 w-9 rounded-full object-cover ring-1 ring-white/15" />
        <div className="min-w-0">
          <p className="text-[15px] font-semibold leading-tight text-white">AquaSense</p>
          <p className="truncate text-xs text-rail-text">{profile.farmName}</p>
        </div>
      </div>

      <nav aria-label="Dashboard" className="flex-1 px-3">
        <ul className="space-y-0.5">
          {navItems.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) => `group flex h-10 items-center gap-3 rounded-md px-3 text-sm transition-colors duration-150 ${
                  isActive ? 'bg-white/[0.09] font-semibold text-white' : 'text-rail-text hover:bg-white/[0.05] hover:text-white'
                }`}
              >
                {({ isActive }) => (
                  <>
                    <span className={`[&>svg]:h-[18px] [&>svg]:w-[18px] ${isActive ? 'text-[#9cc6dd]' : 'text-rail-text/80 group-hover:text-white'}`}>
                      <DashboardIcon name={item.icon} />
                    </span>
                    <span>{item.label}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="border-t border-white/10 px-5 py-4">
        <p className="text-xs text-rail-text">Tank</p>
        <p className="truncate text-sm font-semibold text-white">{profile.tankName}</p>
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-xs text-rail-text" title={userLabel}>{userLabel}</p>
          <button
            type="button"
            onClick={() => void handleLogout()}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-white/15 px-2.5 text-xs font-semibold text-white transition-colors hover:bg-white/10"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 17l5-5-5-5M20 12H9M12 19H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h7" />
            </svg>
            Log out
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-white lg:grid lg:h-screen lg:grid-cols-[240px_minmax(0,1fr)] lg:overflow-hidden">
      {/* Phone and tablet top bar */}
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 bg-rail px-4 lg:hidden">
        <div className="flex min-w-0 items-center gap-2.5">
          <img src={logo} alt="" className="h-8 w-8 rounded-full object-cover" />
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-semibold text-white">{currentLabel}</p>
            <p className="truncate text-xs text-rail-text">{profile.tankName}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setIsMenuOpen(true)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-md text-white hover:bg-white/10"
          aria-label="Open menu"
          aria-expanded={isMenuOpen}
          aria-controls="dashboard-rail"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
      </div>

      {/* Scrim for the phone menu */}
      <div
        className={`fixed inset-0 z-40 bg-ink/40 transition-opacity duration-200 lg:hidden ${isMenuOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={() => setIsMenuOpen(false)}
        aria-hidden="true"
      />

      <aside
        id="dashboard-rail"
        className={`fixed inset-y-0 left-0 z-50 w-[272px] overflow-y-auto bg-rail transition-transform duration-200 ease-out lg:static lg:z-auto lg:w-auto lg:translate-x-0 ${
          isMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <button
          type="button"
          onClick={() => setIsMenuOpen(false)}
          className="absolute right-3 top-4 inline-flex h-9 w-9 items-center justify-center rounded-md text-rail-text hover:bg-white/10 hover:text-white lg:hidden"
          aria-label="Close menu"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path strokeLinecap="round" d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
        {rail}
      </aside>

      <main className="min-w-0 px-4 pb-10 pt-5 sm:px-6 lg:h-screen lg:overflow-y-auto lg:px-8 lg:pt-7">
        <div className="mx-auto max-w-[1440px]">
          <Outlet />
        </div>
      </main>
    </div>
  );
};
