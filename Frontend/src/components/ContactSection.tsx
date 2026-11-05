import React, { useState } from 'react';

interface ContactFormData {
  name: string;
  email: string;
  subject: string;
  message: string;
}

// The form is not connected to a mail service yet, so it says so instead of
// pretending to send.
const ContactSection: React.FC = () => {
  const [formData, setFormData] = useState<ContactFormData>({
    name: '',
    email: '',
    subject: '',
    message: ''
  });
  const [submitted, setSubmitted] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    setSubmitted(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  return (
    <section id="contact" className="scroll-mt-20 border-t border-line bg-water py-16 sm:py-24" aria-labelledby="contact-heading">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[1fr_2fr]">
        <div>
          <h2 id="contact-heading" className="text-3xl font-semibold leading-tight sm:text-4xl">Get in touch</h2>
          <p className="mt-3 max-w-sm text-base leading-relaxed text-ink-2">
            Questions about setting up sensors, the feeder, or the dashboard.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="panel space-y-4 p-5 sm:p-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="contact-name" className="field-label">Full name</label>
              <input type="text" id="contact-name" name="name" value={formData.name} onChange={handleChange} required autoComplete="name" className="field" />
            </div>
            <div>
              <label htmlFor="contact-email" className="field-label">Email</label>
              <input type="email" id="contact-email" name="email" value={formData.email} onChange={handleChange} required autoComplete="email" className="field" />
            </div>
          </div>
          <div>
            <label htmlFor="contact-subject" className="field-label">Topic</label>
            <select id="contact-subject" name="subject" value={formData.subject} onChange={handleChange} required className="field">
              <option value="">Choose a topic</option>
              <option value="general">General question</option>
              <option value="support">Technical support</option>
              <option value="partnership">Partnership</option>
              <option value="feedback">Feedback</option>
            </select>
          </div>
          <div>
            <label htmlFor="contact-message" className="field-label">Message</label>
            <textarea id="contact-message" name="message" value={formData.message} onChange={handleChange} required rows={5} className="field resize-y" />
          </div>
          {submitted && (
            <div role="status" className="rounded-md border border-warn/25 bg-warn-bg px-3.5 py-2.5 text-[13px] leading-relaxed text-[#6b3504]">
              This form is not connected to a mail service yet, so your message was not sent.
            </div>
          )}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
            <button type="submit" className="btn-primary btn-lg w-full sm:w-auto">Send message</button>
            <p className="text-[13px] leading-relaxed text-ink-3">Preview only: this form is not connected to a mail service yet.</p>
          </div>
        </form>
      </div>
    </section>
  );
};

export default ContactSection;
