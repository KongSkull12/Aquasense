import React from 'react';
import { Link } from 'react-router-dom';
import Navigation from '../components/Navigation';
import Footer from '../components/Footer';
import PageIntro from '../components/PageIntro';
import watersystemImage from '../assets/images/feature/watersystem.jpg';

const flow = [
  { title: 'Sensors read the tank', text: 'An ESP32 reads temperature, pH, turbidity, ORP and tank level, and sends them over MQTT or HTTP.' },
  { title: 'The server checks each reading', text: 'Readings are stored, and only values that pass data-quality and calibration checks are classified. Old samples are marked stale.' },
  { title: 'The dashboard updates live', text: 'Socket.IO pushes new readings to your browser every few seconds, with the health of each sensor beside its value.' },
  { title: 'Alerts and commands go out', text: 'Threshold alerts send SMS. Feeding schedules and manual commands reach the feeder, which reports back an acknowledgement.' },
];

const day = [
  { time: 'Morning', detail: 'Open the overview. The Next line tells you whether anything needs attention, and the charts show the overnight trend.' },
  { time: 'Midday', detail: 'Scheduled feeds run. Check the feeding page to confirm the device acknowledged them.' },
  { time: 'Afternoon', detail: 'If an alert fires, you get an SMS. Confirm the reading with a calibrated instrument while calibration is incomplete.' },
  { time: 'Night', detail: 'Monitoring continues as long as the device has power and Wi-Fi. AquaSense does not protect against low dissolved oxygen.' },
];

const HowItWorksPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-white">
      <Navigation />
      <main>
        <PageIntro
          title="How it works"
          lede="From the probe in the water to the number on your phone, and what happens at each step."
          image={{ src: watersystemImage, alt: 'Water system plumbing for the crayfish tanks' }}
        />

        <section className="py-16 sm:py-24" aria-labelledby="flow-heading">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <h2 id="flow-heading" className="text-3xl font-semibold leading-tight sm:text-4xl">The path of a reading</h2>
            <ol className="mt-10 grid gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-2 xl:grid-cols-4">
              {flow.map((step, index) => (
                <li key={step.title} className="flex flex-col bg-white p-6">
                  <span className="num text-sm font-semibold text-sounding">Step {index + 1}</span>
                  <h3 className="mt-2 text-lg font-semibold leading-snug">{step.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{step.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="border-y border-line bg-water py-16 sm:py-24" aria-labelledby="day-heading">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[1fr_1.6fr] lg:gap-16">
            <div>
              <h2 id="day-heading" className="text-3xl font-semibold leading-tight sm:text-4xl">A day with AquaSense</h2>
              <p className="mt-3 max-w-sm text-lg leading-relaxed text-ink-2">How the dashboard fits into routine farm work.</p>
            </div>
            <dl className="divide-y divide-line border-y border-line">
              {day.map((item) => (
                <div key={item.time} className="grid gap-1 py-5 sm:grid-cols-[120px_1fr] sm:gap-6">
                  <dt className="font-semibold">{item.time}</dt>
                  <dd className="text-[15px] leading-relaxed text-ink-2">{item.detail}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="py-16 sm:py-24">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-4 sm:px-6 md:flex-row md:items-center">
            <div>
              <h2 className="text-3xl font-semibold leading-tight sm:text-4xl">See it with your own tank</h2>
              <p className="mt-2 max-w-lg text-lg leading-relaxed text-ink-2">Sign in to open the live dashboard.</p>
            </div>
            <Link to="/dashboard" className="btn-primary btn-lg">Open the dashboard</Link>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default HowItWorksPage;
