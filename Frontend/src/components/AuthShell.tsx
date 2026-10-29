import React from 'react';
import { Link } from 'react-router-dom';
import aquaSenseLogo from '../assets/images/AquaSense_Logo.png';
import heroImage from '../assets/images/Hero_image.jpg';

// Two-column auth layout: the tank photo under an ink panel beside the form.
// `enterFrom` keeps the slide direction consistent when switching between pages.
const AuthShell: React.FC<{ enterFrom: 'left' | 'right'; aside: React.ReactNode; children: React.ReactNode }> = ({ enterFrom, aside, children }) => (
  <div className="min-h-screen bg-white lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
    <aside className="relative hidden overflow-hidden bg-rail lg:block">
      <img src={heroImage} alt="" className="absolute inset-0 h-full w-full object-cover opacity-30 mix-blend-luminosity" />
      <div className="absolute inset-0 bg-gradient-to-t from-rail via-rail/80 to-rail/40" />
      <div className="relative flex h-full flex-col justify-between p-10 xl:p-14">
        <Link to="/" className="flex items-center gap-2.5 text-white">
          <img src={aquaSenseLogo} alt="" className="h-9 w-9 rounded-full object-cover" />
          <span className="text-base font-semibold">AquaSense</span>
        </Link>
        <div className="max-w-md">{aside}</div>
      </div>
    </aside>

    <main className="flex min-h-screen flex-col px-4 py-6 sm:px-8 lg:px-12">
      <div className="flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 lg:invisible" aria-label="AquaSense home">
          <img src={aquaSenseLogo} alt="" className="h-8 w-8 rounded-full object-cover" />
          <span className="text-[15px] font-semibold">AquaSense</span>
        </Link>
        <Link to="/" className="btn-quiet btn-sm">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
          Back to site
        </Link>
      </div>
      <div className={`mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-10 ${enterFrom === 'left' ? 'auth-in-left' : 'auth-in-right'}`}>
        {children}
      </div>
    </main>
  </div>
);

export const PasswordToggle = ({ shown, onToggle }: { shown: boolean; onToggle: () => void }) => (
  <button
    type="button"
    onClick={onToggle}
    className="absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded text-ink-3 hover:bg-water hover:text-ink"
    aria-label={shown ? 'Hide password' : 'Show password'}
    aria-pressed={shown}
  >
    {shown ? (
      <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A9.7 9.7 0 0 1 12 5c4.5 0 8.3 2.9 9.5 7a10 10 0 0 1-2.7 4.2M6.2 6.2A10 10 0 0 0 2.5 12c1.3 4.1 5 7 9.5 7 1.6 0 3.1-.4 4.4-1" />
      </svg>
    ) : (
      <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 12C3.7 7.9 7.5 5 12 5s8.3 2.9 9.5 7c-1.2 4.1-5 7-9.5 7s-8.3-2.9-9.5-7Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    )}
  </button>
);

export default AuthShell;
