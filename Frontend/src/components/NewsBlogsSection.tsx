import React from 'react';

interface BlogCard {
  category: string;
  date: string;
  title: string;
  excerpt: string;
}

const blogCards: BlogCard[] = [
  {
    category: 'Construction Trends',
    date: 'Mar 10, 2026',
    title: 'How Technology is Revolutionizing Modern Aquaculture',
    excerpt: 'Discover practical methods and tools that improve monitoring, reduce risk, and boost farm productivity.',
  },
  {
    category: 'Project Management',
    date: 'Mar 08, 2026',
    title: '5 Essential Steps for a Successful Farm Setup',
    excerpt: 'From planning and installation to monitoring workflows, follow these steps for smoother operations.',
  },
  {
    category: 'Project Management',
    date: 'Mar 05, 2026',
    title: 'Site Safety Tips: Ensuring Smooth Daily Operations',
    excerpt: 'Simple, actionable safety habits to keep your team productive and your farm environment secure.',
  },
];

const NewsBlogsSection: React.FC = () => {
  return (
    <section className="px-6 bg-white py-16 sm:py-24">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-4 mb-14 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium text-primary">News & Blogs <span className="text-cyan-300">&rarr;</span></p>    
            <h2 className="mt-2 text-3xl font-bold text-blue-900 sm:text-4xl md:text-5xl">Our Latest News & Blogs</h2>
          </div>
          <button
            type="button"
            className="w-full px-5 py-2 text-sm font-semibold text-white transition rounded-full bg-primary hover:brightness-95 sm:w-auto"
          >
            View All Blogs
          </button>
        </div>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
          {blogCards.map((blog) => (
            <article key={blog.title} className="overflow-hidden transition bg-white border border-b-4 rounded-2xl border-slate-200 border-b-transparent hover:border-b-primary">
              <div className="flex items-center justify-center h-56 border-b-2 border-dashed bg-slate-100 border-slate-300">
                <p className="text-sm font-medium tracking-wide uppercase text-slate-500">Image Placeholder</p>
              </div>

              <div className="p-8">
                <div className="flex items-center justify-between mb-4 text-sm text-slate-500">
                  <span className="font-semibold text-primary">{blog.category}</span>
                  <span>{blog.date}</span>
                </div>
                <h3 className="mb-4 text-2xl font-bold text-slate-900">{blog.title}</h3>
                <p className="mb-5 text-base leading-relaxed text-slate-600">{blog.excerpt}</p>
                <button type="button" className="text-base font-semibold text-primary hover:underline">
                  Read More &rarr;
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};

export default NewsBlogsSection;
