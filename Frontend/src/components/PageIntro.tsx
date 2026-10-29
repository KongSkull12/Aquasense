import React from 'react';

// Opening block for public content pages: heading, lede, optional image.
const PageIntro: React.FC<{ title: string; lede: React.ReactNode; image?: { src: string; alt: string } }> = ({ title, lede, image }) => (
  <section className="border-b border-line">
    <div className={`mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 sm:py-16 lg:py-20 ${image ? 'lg:grid-cols-[1.1fr_1fr] lg:items-center lg:gap-14' : ''}`}>
      <div>
        <h1 className="text-[2.25rem] font-semibold leading-[1.08] tracking-[-0.02em] sm:text-5xl">{title}</h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ink-2">{lede}</p>
      </div>
      {image && <img src={image.src} alt={image.alt} className="aspect-[4/3] w-full rounded-lg object-cover" />}
    </div>
  </section>
);

export default PageIntro;
