import React from 'react';
import { Link } from 'react-router-dom';
import aquaSenseLogo from '../assets/images/AquaSense_Logo.png';

const Footer: React.FC = () => {
  return (
    <footer className="bg-rail text-rail-text">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <img src={aquaSenseLogo} alt="" className="h-8 w-8 rounded-full object-cover" />
              <span className="text-base font-semibold text-white">AquaSense</span>
            </div>
            <p className="mt-3 max-w-xs text-sm leading-relaxed">
              Water-quality monitoring and feeding control for redclaw crayfish tanks.
            </p>
          </div>

          <nav aria-label="Product">
            <h2 className="text-sm font-semibold text-white">Product</h2>
            <ul className="mt-3 space-y-2">
              <li><Link to="/features" className="footer-link">Features</Link></li>
              <li><Link to="/how-it-works" className="footer-link">How it works</Link></li>
              <li><Link to="/dashboard" className="footer-link">Dashboard</Link></li>
            </ul>
          </nav>

          <nav aria-label="Project">
            <h2 className="text-sm font-semibold text-white">Project</h2>
            <ul className="mt-3 space-y-2">
              <li><Link to="/about" className="footer-link">About</Link></li>
              <li><Link to="/contact" className="footer-link">Contact</Link></li>
              <li><Link to="/login" className="footer-link">Sign in</Link></li>
            </ul>
          </nav>
        </div>

        <div className="mt-12 border-t border-white/10 pt-6 text-xs">
          <p>© {new Date().getFullYear()} AquaSense.</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
