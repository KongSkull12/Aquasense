import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import AboutPage from './pages/AboutPage';
import FeaturesPage from './pages/FeaturesPage';
import HowItWorksPage from './pages/HowItWorksPage';
import ScrollManager from './components/ScrollManager';
import { DashboardLayout } from './components/WaterQuality/DashboardLayout';
import DashboardOverviewPage from './pages/dashboard/DashboardOverviewPage';
import DashboardParametersPage from './pages/dashboard/DashboardParametersPage';
import DashboardFeedingPage from './pages/dashboard/DashboardFeedingPage';
import DashboardWaterChangePage from './pages/dashboard/DashboardWaterChangePage';
import DashboardAeratorPage from './pages/dashboard/DashboardAeratorPage';
import DashboardAlertsPage from './pages/dashboard/DashboardAlertsPage';
import DashboardSettingsPage from './pages/dashboard/DashboardSettingsPage';
import { apiClient } from './services/apiClient';
import './App.css';

// Protected Route Component
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const [status, setStatus] = useState<'checking' | 'authenticated' | 'anonymous'>('checking');

  useEffect(() => {
    let mounted = true;
    apiClient.verifyAuth().then((isAuthenticated) => {
      if (mounted) {
        setStatus(isAuthenticated ? 'authenticated' : 'anonymous');
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  if (status === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white" role="status">
        <p className="text-sm text-ink-2">Checking your session…</p>
      </div>
    );
  }

  if (status === 'anonymous') {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

function App(): JSX.Element {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Initial check
    setLoading(false);

    // Listen for storage changes (for when other tabs/windows auth changes)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'user') {
        // Auth state will be checked by ProtectedRoute component
        console.log('[App] Storage change detected:', e.key);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white" role="status">
        <p className="text-sm text-ink-2">Loading AquaSense…</p>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <ScrollManager />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/features" element={<FeaturesPage />} />
        <Route path="/how-it-works" element={<HowItWorksPage />} />
        <Route path="/contact" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/dashboard/overview" replace />} />
          <Route path="overview" element={<DashboardOverviewPage />} />
          <Route path="parameters" element={<DashboardParametersPage />} />
          <Route path="feeding" element={<DashboardFeedingPage />} />
          <Route path="water-change" element={<DashboardWaterChangePage />} />
          <Route path="aerator" element={<DashboardAeratorPage />} />
          <Route path="alerts" element={<DashboardAlertsPage />} />
          <Route path="settings" element={<DashboardSettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
