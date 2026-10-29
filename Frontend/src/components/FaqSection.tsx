import React, { useState } from 'react';

interface FAQItem {
  q: string;
  a: string;
}

const faqs: FAQItem[] = [
  {
    q: 'How do I get started?',
    a: 'Create an account, then open Settings and register the device ID configured in your ESP32 firmware. Readings appear on the dashboard as soon as that device reports.',
  },
  {
    q: 'Does AquaSense measure dissolved oxygen?',
    a: 'No. There is no dissolved-oxygen probe. ORP is a separate redox reading and is never converted to dissolved oxygen. Use an independently calibrated DO meter when you need DO.',
  },
  {
    q: 'Why do readings say “Calibration required”?',
    a: 'A reading is only classified against guidance ranges once its sensor is calibrated and stable. Until then you see the reported value, clearly marked, but no “within range” verdict.',
  },
  {
    q: 'What happens when a sensor stops reporting?',
    a: 'Readings older than about 15 seconds are marked stale and removed from the live view, so an old value is never shown as current.',
  },
  {
    q: 'Can I feed remotely?',
    a: 'Yes. You can send feed, on and off commands and manage daily or dated schedules for the ESP32 feeder. A device acknowledgement confirms the command was accepted, not that feed was dispensed.',
  },
  {
    q: 'Who receives SMS alerts?',
    a: 'The recipient configured on the server. The contact number in dashboard Settings is shown on the dashboard only and does not change where SMS alerts go.',
  },
];

const FaqSection: React.FC = () => {
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);

  return (
    <section id="faq" className="border-t border-line bg-white py-16 sm:py-24" aria-labelledby="faq-heading">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[1fr_2fr]">
        <div>
          <h2 id="faq-heading" className="text-3xl font-semibold leading-tight sm:text-4xl">Questions farmers ask</h2>
          <p className="mt-3 max-w-sm text-base leading-relaxed text-ink-2">Straight answers about what AquaSense measures, and what it does not.</p>
        </div>
        <ul className="divide-y divide-line border-y border-line">
          {faqs.map((faq, idx) => {
            const isOpen = openFaqIndex === idx;
            return (
              <li key={faq.q}>
                <h3>
                  <button
                    type="button"
                    onClick={() => setOpenFaqIndex(isOpen ? null : idx)}
                    aria-expanded={isOpen}
                    aria-controls={`faq-answer-${idx}`}
                    className="flex w-full items-center justify-between gap-6 py-5 text-left text-base font-semibold text-ink hover:text-sounding"
                  >
                    {faq.q}
                    <svg viewBox="0 0 20 20" className={`h-4 w-4 shrink-0 text-ink-3 transition-transform duration-200 ${isOpen ? 'rotate-45' : ''}`} aria-hidden="true">
                      <path d="M10 3v14M3 10h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                  </button>
                </h3>
                <div
                  id={`faq-answer-${idx}`}
                  className={`grid transition-[grid-template-rows] duration-200 ease-out ${isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
                >
                  <div className="overflow-hidden">
                    <p className="max-w-2xl pb-5 text-[15px] leading-relaxed text-ink-2">{faq.a}</p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
};

export default FaqSection;
