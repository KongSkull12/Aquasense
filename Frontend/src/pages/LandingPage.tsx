import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Navigation from '../components/Navigation';
import Footer from '../components/Footer';
import ContactSection from '../components/ContactSection';
import FaqSection from '../components/FaqSection';
import SampleBandChart from '../components/SampleBandChart';
import { StateMark, type MarkState } from '../components/WaterQuality/Console';
import { API_BASE_URL } from '../config/runtime';
import heroImage from '../assets/images/Hero_image.jpg';
import crayfishImage from '../assets/images/about/about_cray.jpg';

interface HealthResponse {
  success: boolean;
  statusCode: number;
  message: string;
  data?: {
    uptime: number;
  };
}

const capabilities = [
  {
    title: 'Monitor',
    text: 'Temperature, pH, turbidity, ORP and tank level stream to the dashboard every few seconds, each with its sensor health shown beside the value.',
  },
  {
    title: 'Alert',
    text: 'Readings that cross a configured threshold raise an alert and an SMS, and every attempt is logged with its delivery status.',
  },
  {
    title: 'Feed',
    text: 'Run the ESP32 feeder on a daily or dated schedule, or send a feed command from your phone at the tank.',
  },
];

const trustStates: Array<{ state: MarkState; label: string; text: string }> = [
  { state: 'ok', label: 'Within guidance', text: 'Calibrated, stable sensor, and the value sits inside the guidance range.' },
  { state: 'trust', label: 'Calibration required', text: 'The value is reported, but the sensor is not calibrated, so it is not classified.' },
  { state: 'warn', label: 'Stale or outside range', text: 'No fresh sample arrived, or a qualified value has left the range.' },
  { state: 'off', label: 'Unavailable', text: 'The sensor is not reporting. AquaSense shows a dash, never a guess.' },
];

const LandingPage: React.FC = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const location = useLocation();

  useEffect(() => {
    const healthUrl = `${API_BASE_URL}/health`;

    const checkBackend = async () => {
      try {
        const response = await fetch(healthUrl, {
          signal: AbortSignal.timeout(3000),
          cache: 'no-store',
          headers: {
            Accept: 'application/json',
          },
        });

        if (!response.ok) {
          setIsConnected(false);
          return;
        }

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          setIsConnected(false);
          return;
        }

        const data: HealthResponse = await response.json();
        const hasUptime = typeof data.data?.uptime === 'number';
        setIsConnected(data.success === true && data.statusCode === 200 && hasUptime);
      } catch {
        setIsConnected(false);
      } finally {
        setLoading(false);
      }
    };

    checkBackend();
    const healthCheckInterval = setInterval(checkBackend, 5000);
    return () => clearInterval(healthCheckInterval);
  }, []);

  // /contact shares this page; bring the form into view.
  useEffect(() => {
    if (location.pathname !== '/contact') return;
    const timer = window.setTimeout(() => document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' }), 50);
    return () => window.clearTimeout(timer);
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-white">
      <Navigation />

      <main>
        {/* Hero */}
        <section className="border-b border-line">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-[1.05fr_1fr] lg:gap-14 lg:py-20">
            <div>
              <h1 className="text-[2.5rem] font-semibold leading-[1.05] tracking-[-0.025em] sm:text-5xl lg:text-[3.5rem]">
                Know when your tank water can be trusted.
              </h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-2">
                AquaSense reads the water in your redclaw crayfish tanks, shows each value with the health of the sensor behind it, sends SMS alerts, and runs your feeder on schedule.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link to="/dashboard" className="btn-primary btn-lg">Open the dashboard</Link>
                <Link to="/how-it-works" className="btn-secondary btn-lg">How it works</Link>
              </div>
              <div className="mt-6" aria-live="polite">
                {loading ? (
                  <StateMark state="off">Checking the AquaSense server…</StateMark>
                ) : isConnected ? (
                  <StateMark state="ok">Server online</StateMark>
                ) : (
                  <StateMark state="alarm">Server offline</StateMark>
                )}
              </div>
            </div>

            <figure className="relative">
              <img src={heroImage} alt="Concrete grow-out tank divided into glass compartments for individual crayfish, with a red inflow pipe" className="aspect-[4/3] w-full rounded-lg object-cover" />
              <div className="absolute -bottom-6 left-4 right-4 rounded-lg border border-line bg-white p-4 shadow-overlay sm:left-auto sm:right-6 sm:w-[300px]">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-[13px] font-semibold">Temperature</p>
                  <p className="text-xs text-ink-3">Sample data</p>
                </div>
                <p className="num mt-1 text-2xl font-semibold leading-none">27.4 <span className="text-sm font-medium text-ink-3">°C</span></p>
                <SampleBandChart className="mt-3 h-[72px] w-full" />
                <p className="mt-2 text-xs text-ink-3">Shaded band: 26–29 °C growth guidance</p>
              </div>
            </figure>
          </div>
        </section>

        {/* What it does */}
        <section className="py-16 sm:py-24" aria-labelledby="capabilities-heading">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <h2 id="capabilities-heading" className="max-w-2xl text-3xl font-semibold leading-tight sm:text-4xl">One console for the tank, the sensors and the feeder</h2>
            <div className="mt-10 grid gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-3">
              {capabilities.map((item) => (
                <div key={item.title} className="bg-white p-6 sm:p-7">
                  <h3 className="text-lg font-semibold">{item.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{item.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Trust states: the product's distinctive behaviour */}
        <section className="border-y border-line bg-water py-16 sm:py-24" aria-labelledby="trust-heading">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:items-center">
            <div>
              <h2 id="trust-heading" className="text-3xl font-semibold leading-tight sm:text-4xl">A number is only useful if you can trust it</h2>
              <p className="mt-4 max-w-lg text-lg leading-relaxed text-ink-2">
                Cheap probes drift and connections drop. Every reading on the dashboard carries one of four marks, so you never mistake an uncalibrated or stale value for a safe one.
              </p>
            </div>
            <ul className="panel divide-y divide-line-soft">
              {trustStates.map((item) => (
                <li key={item.label} className="grid gap-1 px-5 py-4 sm:grid-cols-[190px_1fr] sm:gap-4">
                  <StateMark state={item.state} className="!text-sm !font-semibold">{item.label}</StateMark>
                  <p className="text-sm leading-relaxed text-ink-2">{item.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Species */}
        <section className="py-16 sm:py-24" aria-labelledby="species-heading">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 sm:px-6 md:grid-cols-[0.8fr_1fr] lg:gap-16">
            <img src={crayfishImage} alt="A redclaw crayfish held in a yellow hand net above the tank" className="aspect-[4/5] w-full rounded-lg object-cover" loading="lazy" />
            <div>
              <h2 id="species-heading" className="text-3xl font-semibold leading-tight sm:text-4xl">Set up for redclaw crayfish</h2>
              <p className="mt-4 max-w-lg text-lg leading-relaxed text-ink-2">
                Guidance ranges are tuned for <i>Cherax quadricarinatus</i> culture. They are advisory, and shown as shaded bands on every chart.
              </p>
              <dl className="mt-8 divide-y divide-line border-y border-line">
                <div className="flex items-baseline justify-between gap-4 py-4">
                  <dt className="text-ink-2">Temperature, growth guidance</dt>
                  <dd className="num text-lg font-semibold">26–29 °C</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 py-4">
                  <dt className="text-ink-2">pH, culture guidance</dt>
                  <dd className="num text-lg font-semibold">7.0–8.5</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 py-4">
                  <dt className="text-ink-2">Turbidity and ORP</dt>
                  <dd className="text-right text-[15px] font-medium text-ink-2">Reported, no validated limit</dd>
                </div>
              </dl>
              <p className="mt-5 text-sm leading-relaxed text-ink-3">
                AquaSense has no dissolved-oxygen probe. ORP is a separate redox reading and is never converted to dissolved oxygen.
              </p>
            </div>
          </div>
        </section>

        <FaqSection />
        <ContactSection />

        {/* Closing */}
        <section className="bg-ink py-16 sm:py-20">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-4 sm:px-6 md:flex-row md:items-center">
            <div>
              <h2 className="text-3xl font-semibold leading-tight text-white sm:text-4xl">Connect your first tank</h2>
              <p className="mt-2 max-w-lg text-base leading-relaxed text-rail-text">Create an account, register your device ID, and readings start arriving on the dashboard.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link to="/signup" className="btn btn-lg bg-white text-ink hover:bg-band">Create account</Link>
              <Link to="/login" className="btn btn-lg border border-white/25 text-white hover:bg-white/10">Sign in</Link>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
};

export default LandingPage;
