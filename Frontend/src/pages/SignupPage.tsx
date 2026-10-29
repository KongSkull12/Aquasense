import React, { useState } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { apiClient, getApiErrorMessage } from '../services/apiClient';
import AuthShell, { PasswordToggle } from '../components/AuthShell';
import { Notice } from '../components/WaterQuality/Console';

interface PasswordStrength {
  score: number;
  label: string;
  color: string;
}

const SignupPage: React.FC = () => {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const transition = (location.state as { transition?: string } | null)?.transition;
  const isFromLogin = transition === 'to-signup';

  // Calculate password strength
  const calculatePasswordStrength = (pwd: string): PasswordStrength => {
    const minLength = pwd.length >= 12;
    const hasUpperCase = /[A-Z]/.test(pwd);
    const hasLowerCase = /[a-z]/.test(pwd);
    const hasNumbers = /\d/.test(pwd);
    const hasSpecialChars = [...pwd].some((character) => "!@#$%^&*()_+-=[]{};':\"\\|,.<>/?".includes(character));

    let score = 0;
    if (pwd.length > 0) score += 1;
    if (minLength) score += 1;
    if (hasUpperCase) score += 1;
    if (hasLowerCase) score += 1;
    if (hasNumbers) score += 1;
    if (hasSpecialChars) score += 1;

    if (score <= 1) return { score: 0, label: 'Very weak', color: '#b42318' };
    if (score <= 2) return { score: 1, label: 'Weak', color: '#b42318' };
    if (score <= 3) return { score: 2, label: 'Fair', color: '#a14e06' };
    if (score <= 4) return { score: 3, label: 'Good', color: '#1d6b47' };
    return { score: 4, label: 'Strong', color: '#1d6b47' };
  };

  const passwordStrength = calculatePasswordStrength(password);
  const mismatch = confirmPassword !== '' && password !== confirmPassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!fullName || !email || !password || !confirmPassword) {
      setError('All fields are required');
      return;
    }

    if (
      password.length < 12 ||
      !/[A-Z]/.test(password) ||
      !/[a-z]/.test(password) ||
      !/\d/.test(password) ||
      !/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)
    ) {
      setError('Password must be at least 12 characters and include uppercase, lowercase, number, and special character');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    try {
      const response = await apiClient.post<{ user: unknown }>('/auth/signup', {
        fullName,
        email,
        password,
      });

      if (response.success) {
        localStorage.setItem('user', JSON.stringify(response.data.user));

        setTimeout(() => {
          navigate('/dashboard', { replace: true });
        }, 100);
      } else {
        setError(response.message || 'Signup failed');
      }
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to create account. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      enterFrom={isFromLogin ? 'right' : 'left'}
      aside={
        <>
          <p className="text-3xl font-semibold leading-tight text-white">Set up in three steps.</p>
          <ol className="mt-6 space-y-4 text-base leading-relaxed text-rail-text">
            <li><span className="font-semibold text-white">1. Create your account.</span> You land on the dashboard right away.</li>
            <li><span className="font-semibold text-white">2. Register your device.</span> Enter the ID from your ESP32 firmware in Settings.</li>
            <li><span className="font-semibold text-white">3. Watch the readings arrive.</span> Each one marked by sensor health.</li>
          </ol>
        </>
      }
    >
      <h1 className="text-[28px] font-semibold leading-tight">Create your account</h1>
      <p className="mt-2 text-[15px] text-ink-2">It takes a minute. You can register devices afterwards.</p>

      {error && <div className="mt-6"><Notice tone="alarm" title="Could not create account">{error}</Notice></div>}

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        <div>
          <label className="field-label" htmlFor="signup-name">Full name</label>
          <input id="signup-name" type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} required autoComplete="name" className="field h-11" />
        </div>

        <div>
          <label className="field-label" htmlFor="signup-email">Email</label>
          <input id="signup-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" className="field h-11" />
        </div>

        <div>
          <label className="field-label" htmlFor="signup-password">Password</label>
          <div className="relative">
            <input id="signup-password" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" aria-describedby="password-help" className="field h-11 pr-11" />
            <PasswordToggle shown={showPassword} onToggle={() => setShowPassword(!showPassword)} />
          </div>
          {password ? (
            <div id="password-help" className="mt-2">
              <div className="flex gap-1" aria-hidden="true">
                {[0, 1, 2, 3, 4].map((step) => (
                  <span key={step} className="h-1 flex-1 rounded-full transition-colors duration-200" style={{ backgroundColor: step <= passwordStrength.score ? passwordStrength.color : '#e8eff4' }} />
                ))}
              </div>
              <p className="mt-1.5 text-xs" style={{ color: passwordStrength.color }}>
                {passwordStrength.label}{passwordStrength.score < 3 ? ' · use 12+ characters with upper and lower case, a number and a symbol' : ''}
              </p>
            </div>
          ) : (
            <p id="password-help" className="field-hint">At least 12 characters, with upper and lower case, a number and a symbol.</p>
          )}
        </div>

        <div>
          <label className="field-label" htmlFor="signup-confirm">Confirm password</label>
          <div className="relative">
            <input
              id="signup-confirm"
              type={showConfirmPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
              aria-invalid={mismatch}
              aria-describedby={mismatch ? 'confirm-error' : undefined}
              className={`field h-11 pr-11 ${mismatch ? '!border-alarm focus:!ring-alarm/20' : ''}`}
            />
            <PasswordToggle shown={showConfirmPassword} onToggle={() => setShowConfirmPassword(!showConfirmPassword)} />
          </div>
          {mismatch && <p id="confirm-error" className="mt-1.5 text-xs text-alarm">Passwords do not match</p>}
        </div>

        <label htmlFor="terms" className="flex items-start gap-2.5 text-sm text-ink-2">
          <input type="checkbox" id="terms" required className="mt-0.5 h-4 w-4 rounded border-line accent-ink" />
          I agree to the Terms and Privacy Policy
        </label>

        <button type="submit" disabled={loading} className="btn-primary btn-lg w-full">
          {loading ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p className="mt-8 text-[15px] text-ink-2">
        Already have an account?{' '}
        <Link to="/login" state={{ transition: 'to-login' }} className="link">Sign in</Link>
      </p>
    </AuthShell>
  );
};

export default SignupPage;
