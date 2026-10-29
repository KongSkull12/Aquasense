import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import aquaSenseLogo from '../assets/images/AquaSense_Logo.png';

const links = [
  { to: '/', label: 'Home' },
  { to: '/features', label: 'Features' },
  { to: '/how-it-works', label: 'How it works' },
  { to: '/about', label: 'About' },
];

const Navigation: React.FC = () => {
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => { setIsMobileMenuOpen(false); }, [location.pathname]);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white/95 backdrop-blur-sm supports-[backdrop-filter]:bg-white/85">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-4 sm:px-6">
        <Link to="/" className="flex shrink-0 items-center gap-2.5" aria-label="AquaSense home">
          <img src={aquaSenseLogo} alt="" className="h-9 w-9 rounded-full object-cover" />
          <span className="text-base font-semibold tracking-tight">AquaSense</span>
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-7 md:flex">
          {links.map((link) => (
            <Link key={link.to} to={link.to} className={`site-link ${location.pathname === link.to ? 'active' : ''}`} aria-current={location.pathname === link.to ? 'page' : undefined}>
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <Link to="/login" className="btn-quiet">Sign in</Link>
          <Link to="/signup" className="btn-primary">Create account</Link>
        </div>

        <button
          type="button"
          aria-label={isMobileMenuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={isMobileMenuOpen}
          aria-controls="site-menu"
          onClick={() => setIsMobileMenuOpen((prev) => !prev)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-md text-ink hover:bg-water md:hidden"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            {isMobileMenuOpen ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </div>

      {isMobileMenuOpen && (
        <nav id="site-menu" aria-label="Main" className="border-t border-line bg-white px-4 pb-5 pt-2 md:hidden">
          <ul>
            {links.map((link) => (
              <li key={link.to}>
                <Link to={link.to} className={`flex h-11 items-center border-b border-line-soft text-[15px] ${location.pathname === link.to ? 'font-semibold text-ink' : 'text-ink-2'}`}>
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Link to="/login" className="btn-secondary h-11">Sign in</Link>
            <Link to="/signup" className="btn-primary h-11">Create account</Link>
          </div>
        </nav>
      )}
    </header>
  );
};

export default Navigation;
