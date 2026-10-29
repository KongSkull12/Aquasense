import React, { useState } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { apiClient, getApiErrorMessage } from '../services/apiClient';
import AuthShell, { PasswordToggle } from '../components/AuthShell';
import { Notice } from '../components/WaterQuality/Console';

const LoginPage: React.FC<{ setIsAuthenticated?: (value: boolean) => void }> = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const transition = (location.state as { transition?: string } | null)?.transition;
  const isFromSignup = transition === 'to-login';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.post<{ user: unknown }>('/auth/login', { email, password });
      if (response.success) {
        const user = response.data.user;
        localStorage.setItem('user', JSON.stringify(user));

        setTimeout(() => {
          navigate('/dashboard', { replace: true });
        }, 100);
      } else {
        setError(response.message || 'Login failed');
      }
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to sign in. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      enterFrom={isFromSignup ? 'left' : 'right'}
      aside={
        <>
          <p className="text-3xl font-semibold leading-tight text-white">Your tank, with every reading marked by how far you can trust it.</p>
          <p className="mt-4 text-base leading-relaxed text-rail-text">Live temperature, pH, turbidity and ORP, SMS alerts, and feeder control in one console.</p>
        </>
      }
    >
      <h1 className="text-[28px] font-semibold leading-tight">Sign in</h1>
      <p className="mt-2 text-[15px] text-ink-2">Welcome back. Sign in to open your farm dashboard.</p>

      {error && <div className="mt-6"><Notice tone="alarm" title="Could not sign in">{error}</Notice></div>}

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        <div>
          <label className="field-label" htmlFor="login-email">Email</label>
          <input id="login-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" className="field h-11" />
        </div>

        <div>
          <label className="field-label" htmlFor="login-password">Password</label>
          <div className="relative">
            <input id="login-password" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" className="field h-11 pr-11" />
            <PasswordToggle shown={showPassword} onToggle={() => setShowPassword(!showPassword)} />
          </div>
        </div>

        <button type="submit" disabled={loading} className="btn-primary btn-lg w-full">
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="mt-8 text-[15px] text-ink-2">
        New to AquaSense?{' '}
        <Link to="/signup" state={{ transition: 'to-signup' }} className="link">Create an account</Link>
      </p>
    </AuthShell>
  );
};

export default LoginPage;
