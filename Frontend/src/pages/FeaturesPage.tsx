import React from 'react';
import { Link } from 'react-router-dom';
import Navigation from '../components/Navigation';
import Footer from '../components/Footer';
import PageIntro from '../components/PageIntro';
import SampleBandChart from '../components/SampleBandChart';
import { StateMark } from '../components/WaterQuality/Console';
import bigImage01 from '../assets/images/feature/big_image01.jpg';
import temperatureImage from '../assets/images/feature/temeprature.1.png';
import phImage from '../assets/images/feature/ph.png';
import turbidityImage from '../assets/images/feature/turbidity.1.png';
import iotDevicesImage from '../assets/images/feature/iotdevices.jpg';

const sensors = [
  { name: 'Temperature', image: temperatureImage, status: 'Calibration unverified', points: ['Physical sensor reading', 'History with min, max and average', 'Classified against 26–29 °C once calibrated'] },
  { name: 'pH', image: phImage, status: 'Calibration required', points: ['Raw input reported', 'Reference calibration needed before classification', 'Classified against 7.0–8.5 once calibrated'] },
  { name: 'ORP / redox', image: iotDevicesImage, status: 'Commissioning required', points: ['Physical redox input in mV', 'Needs reference calibration', 'Not dissolved oxygen; DO is never inferred'] },
  { name: 'Turbidity', image: turbidityImage, status: 'Calibration required', points: ['NTU shown when the signal converts', 'Accurate NTU needs a validated curve', 'No species limit, so not classified'] },
];

const controls = [
  { title: 'Feeding', text: 'Daily or dated schedules and manual feed, on and off commands for the ESP32 feeder. An acknowledgement means the device accepted the command, not that feed was dispensed.' },
  { title: 'Timed water exchange', text: 'Drain, settle and refill as timed pump commands, capped at 60 seconds per run. Runtimes must be calibrated on the installed pumps; there is no volume measurement.' },
  { title: 'Aerator', text: 'Manual on and off, or hand control back to the firmware temperature policy. There is no dissolved-oxygen trigger.' },
  { title: 'Alerts and SMS', text: 'Alerts depend on valid, fresh inputs. Each SMS attempt is logged with its delivery status.' },
];

const platform = [
  { title: 'Accounts and roles', text: 'JWT sign-in with admin, farmer and read-only guest roles.' },
  { title: 'Device keys', text: 'Each ESP32 is registered to an account and authenticates its own requests.' },
  { title: 'Any screen', text: 'The dashboard works on phones at the tank and on desktop at the office.' },
  { title: 'History', text: 'Readings are stored in PostgreSQL for trends and statistics.' },
];

const FeaturesPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-white">
      <Navigation />
      <main>
        <PageIntro
          title="Features"
          lede="What AquaSense measures, what it controls, and the state each part is in today."
          image={{ src: bigImage01, alt: 'Water monitoring setup at a crayfish tank' }}
        />

        <section className="py-16 sm:py-24" aria-labelledby="sensors-heading">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <h2 id="sensors-heading" className="text-3xl font-semibold leading-tight sm:text-4xl">Sensors</h2>
            <p className="mt-3 max-w-2xl text-lg leading-relaxed text-ink-2">Every input is reported with its health. Engineering calibration is not yet commissioned, so most values are shown but not classified.</p>
            <div className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {sensors.map((sensor) => (
                <article key={sensor.name}>
                  <img src={sensor.image} alt="" className="aspect-[4/3] w-full rounded-lg bg-water object-cover" loading="lazy" />
                  <h3 className="mt-4 text-lg font-semibold">{sensor.name}</h3>
                  <StateMark state="trust" className="mt-1">{sensor.status}</StateMark>
                  <ul className="mt-3 space-y-1.5 text-[15px] leading-relaxed text-ink-2">
                    {sensor.points.map((point) => <li key={point}>{point}</li>)}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="border-y border-line bg-water py-16 sm:py-24" aria-labelledby="charts-heading">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:gap-16">
            <div>
              <h2 id="charts-heading" className="text-3xl font-semibold leading-tight sm:text-4xl">Charts that show the safe zone</h2>
              <p className="mt-4 max-w-lg text-lg leading-relaxed text-ink-2">Each trend is drawn over its guidance range, like depth bands on a chart. You see at a glance when a value drifted out and for how long.</p>
            </div>
            <div className="panel p-5">
              <div className="flex items-baseline justify-between">
                <p className="text-sm font-semibold">Temperature (°C)</p>
                <p className="text-xs text-ink-3">Sample data</p>
              </div>
              <SampleBandChart className="mt-4 h-40 w-full" />
            </div>
          </div>
        </section>

        <section className="py-16 sm:py-24" aria-labelledby="controls-heading">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <h2 id="controls-heading" className="text-3xl font-semibold leading-tight sm:text-4xl">Control and alerts</h2>
            <div className="mt-10 grid gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-2">
              {controls.map((item) => (
                <div key={item.title} className="bg-white p-6 sm:p-7">
                  <h3 className="text-lg font-semibold">{item.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{item.text}</p>
                </div>
              ))}
            </div>

            <h2 className="mt-20 text-3xl font-semibold leading-tight sm:text-4xl">Platform</h2>
            <dl className="mt-8 grid gap-x-12 gap-y-6 sm:grid-cols-2">
              {platform.map((item) => (
                <div key={item.title} className="border-t border-line pt-4">
                  <dt className="font-semibold">{item.title}</dt>
                  <dd className="mt-1 text-[15px] leading-relaxed text-ink-2">{item.text}</dd>
                </div>
              ))}
            </dl>

            <Link to="/signup" className="btn-primary btn-lg mt-14">Create an account</Link>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default FeaturesPage;
