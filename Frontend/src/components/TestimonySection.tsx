import React, { useEffect, useRef } from 'react';

interface TestimonyItem {
  title: string;
  feedback: string;
  name: string;
  rating: number;
  role: string;
  avatar: string;
}

const testimonies: TestimonyItem[] = [
  {
    title: 'Beyond Expectations',
    feedback: 'Setup was easy and alerts arrived on time. We now catch water quality changes before they affect our stock.',
    name: 'Leslie Alexander',
    rating: 5,
    role: 'Happy Client',
    avatar: 'LA'
  },
  {
    title: 'Top-Notch Service',
    feedback: 'The dashboard gives clear trends and our team can act faster. It improved our daily pond management.',
    name: 'Jenny Wilson',
    rating: 5,
    role: 'Happy Client',
    avatar: 'JW'
  },
  {
    title: 'Farm-Friendly Platform',
    feedback: 'From oxygen alerts to pH tracking, everything is practical for real farm work and easy to understand.',
    name: 'Ramon Dela Cruz',
    rating: 4,
    role: 'Farmer',
    avatar: 'RD'
  },
  {
    title: 'Reliable Monitoring',
    feedback: 'We reduced manual checks and now spend more time on operations. Data is stable and accurate.',
    name: 'Maria Santos',
    rating: 5,
    role: 'Farmer',
    avatar: 'MS'
  }
];

const loopedTestimonies = [...testimonies, ...testimonies];

const TestimonySection: React.FC = () => {
  const testimonySliderRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const slider = testimonySliderRef.current;

    if (!slider) {
      return;
    }

    const autoScroll = window.setInterval(() => {
      const firstCard = slider.children[0] as HTMLElement | undefined;

      if (!firstCard) {
        return;
      }

      const gapValue = window.getComputedStyle(slider).gap || '0';
      const gap = Number.parseInt(gapValue, 10) || 0;
      const scrollAmount = firstCard.offsetWidth + gap;

      // Infinite right loop: reset to start at midpoint, then keep moving right.
      if (slider.scrollLeft >= slider.scrollWidth / 2) {
        slider.scrollTo({ left: 0, behavior: 'auto' });
      }

      slider.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }, 2800);

    return () => {
      window.clearInterval(autoScroll);
    };
  }, []);

  return (
    <section className="px-6 py-16 bg-primary sm:py-24">
      <div className="mx-auto max-w-7xl">
        <h2 className="text-3xl font-bold text-center text-cyan-300 sm:text-4xl md:text-5xl">
          Experience Shared by
          <span className="block text-white">Our Clients</span>
        </h2>
        <div
          ref={testimonySliderRef}
          className="flex gap-7 pb-3 mt-12 overflow-x-auto snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {loopedTestimonies.map((item, idx) => (
            <article
              key={`${item.name}-${idx}`}
              className="min-w-[260px] sm:min-w-[320px] md:min-w-[440px] p-8 rounded-2xl border border-white/10 bg-[#143A67] snap-start"
            >
              <div className="flex items-center gap-2 mb-4">
                <div className="flex gap-1 text-2xl text-yellow-400">
                  {Array.from({ length: item.rating }).map((_, starIdx) => (
                    <span key={starIdx}>★</span>
                  ))}
                </div>
                <span className="text-base text-yellow-300">{item.rating}.0</span>
              </div>

              <h3 className="mb-3 text-2xl font-bold text-white">{item.title}</h3>
              <p className="mb-6 text-base leading-relaxed text-blue-100">{item.feedback}</p>

              <div className="flex items-center gap-4">
                <div className="flex items-center justify-center w-12 h-12 text-sm font-bold bg-white rounded-full text-primary">
                  {item.avatar}
                </div>
                <div>
                  <p className="text-lg font-semibold text-white">{item.name}</p>
                  <p className="text-sm text-blue-200">{item.role}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};

export default TestimonySection;
