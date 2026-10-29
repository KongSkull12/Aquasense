import React from 'react';
import { Link } from 'react-router-dom';
import Navigation from '../components/Navigation';
import Footer from '../components/Footer';
import PageIntro from '../components/PageIntro';
import aboutPeopleImage from '../assets/images/about/about_people.jpg';
import aboutIotImage from '../assets/images/about/about_iot.jpg';
import aboutSmartAlert from '../assets/images/about/about_smart_alert_automation.jpg';
import aboutCrayImage from '../assets/images/about/about_cray.jpg';

const parts = [
  {
    image: aboutIotImage,
    alt: 'AquaSense sensor hardware',
    title: 'Sensing',
    items: ['Water temperature', 'pH', 'Turbidity (NTU estimate)', 'ORP / redox, not dissolved oxygen', 'Ultrasonic tank level, where installed'],
  },
  {
    image: aboutSmartAlert,
    alt: 'Alerts and device control',
    title: 'Alerts and control',
    items: ['Threshold alerts with SMS notification', 'SMS delivery log', 'Feeding schedules and manual feed commands', 'Timed pump and aerator commands, once commissioned'],
  },
  {
    image: aboutCrayImage,
    alt: 'A redclaw crayfish in a hand net',
    title: 'For redclaw culture',
    items: ['Guidance ranges for Cherax quadricarinatus', 'Unionized NH₃ fraction from qualified pH and temperature', 'Manual TAN entry from test kits or lab results'],
  },
];

const AboutPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-white">
      <Navigation />
      <main>
        <PageIntro
          title="About AquaSense"
          lede="An IoT monitoring and feeding system for crayfish farmers. ESP32 sensors report the water; the dashboard shows what they read and how far each reading can be trusted."
          image={{ src: aboutPeopleImage, alt: 'The AquaSense team' }}
        />

        <section className="py-16 sm:py-24" aria-labelledby="system-heading">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr] lg:gap-16">
              <h2 id="system-heading" className="text-3xl font-semibold leading-tight sm:text-4xl">The system</h2>
              <div className="space-y-4 text-[17px] leading-relaxed text-ink-2">
                <p>AquaSense brings together sensor reporting, feeding, timed water exchange and alert notifications in one place.</p>
                <p>It has no physical dissolved-oxygen probe, and ORP is a separate redox reading that is never converted to dissolved oxygen. Aerator automation is not yet commissioned.</p>
                <p>Risk analytics are meant to support decisions once qualified inputs are available. They do not replace calibrated measurements or a physical DO test.</p>
              </div>
            </div>

            <div className="mt-14 grid gap-8 md:grid-cols-3">
              {parts.map((part) => (
                <article key={part.title}>
                  <img src={part.image} alt={part.alt} className="aspect-[4/3] w-full rounded-lg object-cover" loading="lazy" />
                  <h3 className="mt-5 text-xl font-semibold">{part.title}</h3>
                  <ul className="mt-3 divide-y divide-line-soft border-t border-line-soft">
                    {part.items.map((item) => <li key={item} className="py-2.5 text-[15px] text-ink-2">{item}</li>)}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-line bg-water py-16 sm:py-24" aria-labelledby="aims-heading">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[1fr_1.4fr] lg:gap-16">
            <h2 id="aims-heading" className="text-3xl font-semibold leading-tight sm:text-4xl">What we are working toward</h2>
            <div className="space-y-8">
              <div>
                <h3 className="text-lg font-semibold">Vision</h3>
                <p className="mt-2 text-[17px] leading-relaxed text-ink-2">A smart aquaculture platform farmers trust: real-time water monitoring, automation and early warning that help reduce losses and keep farms running sustainably.</p>
              </div>
              <div>
                <h3 className="text-lg font-semibold">Mission</h3>
                <p className="mt-2 text-[17px] leading-relaxed text-ink-2">Make water-quality monitoring accessible to small aquaculture operators, and be honest about what each measurement can and cannot tell them.</p>
              </div>
              <Link to="/how-it-works" className="link inline-block">See how it works</Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default AboutPage;
