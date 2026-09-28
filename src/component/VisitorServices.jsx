import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient.js';
import { findFAQResponse } from '../data/faqData.js';

const emptyForm = {
  category: 'Question',
  subject: '',
  message: '',
  libraryId: '',
};

export default function VisitorServices({ user, libraries = [] }) {
  const [announcements, setAnnouncements] = useState([]);
  const [replies, setReplies] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;

    async function loadAnnouncements() {
      if (!supabase) {
        setError('Announcements are unavailable until Supabase is configured.');
        setLoading(false);
        return;
      }

      try {
        const announcementRequest = supabase
          .from('announcements')
          .select('id, title, message, created_at')
          .eq('published', true)
          .order('created_at', { ascending: false });
        const replyRequest = user?.id && user?.email
          ? supabase.rpc('get_visitor_feedback_replies', {
              p_visitor_id: user.id,
              p_email: user.email,
            })
          : Promise.resolve({ data: [], error: null });
        const [announcementResult, replyResult] = await Promise.all([announcementRequest, replyRequest]);

        if (!active) return;
        if (announcementResult.error) setError(announcementResult.error.message);
        else setAnnouncements(announcementResult.data || []);
        if (replyResult.error) setError(replyResult.error.message);
        else setReplies(replyResult.data || []);
      } catch (loadError) {
        if (active) setError(loadError.message || 'Unable to load visitor services.');
      } finally {
        if (active) setLoading(false);
      }
    }

    loadAnnouncements();
    return () => { active = false; };
  }, [user?.email, user?.id]);

  const faqMatch = findFAQResponse(`${form.subject} ${form.message}`);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!supabase) {
      setError('Feedback submission is unavailable until Supabase is configured.');
      return;
    }

    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      const { error: insertError } = await supabase.from('visitor_feedback').insert({
        visitor_id: user?.id || null,
        visitor_name: user?.name || 'Visitor',
        visitor_email: user?.email || null,
        library_id: form.libraryId || null,
        category: form.category,
        subject: form.subject.trim(),
        message: form.message.trim(),
      });
      if (insertError) throw insertError;
      setNotice('Your message was sent to the library team.');
      setForm(emptyForm);
    } catch (submitError) {
      setError(submitError.message || 'Unable to submit feedback.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <section className="space-y-3" aria-labelledby="announcement-heading">
        <div>
          <h2 id="announcement-heading" className="text-lg font-bold text-slate-900">Library announcements</h2>
          <p className="mt-1 text-sm text-slate-500">Updates from the library team</p>
        </div>
        {loading ? <p className="text-sm text-slate-500">Loading announcements...</p> : null}
        {!loading && announcements.length === 0 && (
          <p className="border border-dashed border-slate-300 p-5 text-sm text-slate-500">No announcements are currently published.</p>
        )}
        {announcements.map((item) => (
          <article key={item.id} className="border-l-4 border-emerald-600 bg-white px-4 py-3 shadow-sm">
            <h3 className="font-semibold text-slate-800">{item.title}</h3>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{item.message}</p>
            <time className="mt-2 block text-xs text-slate-400">{new Date(item.created_at).toLocaleString()}</time>
          </article>
        ))}
      </section>

      <section className="lg:col-span-2" aria-labelledby="replies-heading">
        <h2 id="replies-heading" className="text-lg font-bold text-slate-900">Replies to your feedback</h2>
        {replies.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Replies to your submitted feedback will appear here.</p>
        ) : (
          <div className="mt-3 divide-y divide-slate-200 border-y border-slate-200 bg-white">
            {replies.map((reply) => (
              <article key={reply.id} className="p-4">
                <h3 className="text-sm font-semibold text-slate-800">{reply.subject}</h3>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{reply.admin_reply}</p>
                <time className="mt-2 block text-xs text-slate-400">{reply.replied_at ? new Date(reply.replied_at).toLocaleString() : ''}</time>
              </article>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="feedback-heading">
        <h2 id="feedback-heading" className="text-lg font-bold text-slate-900">Questions and feedback</h2>
        <p className="mb-4 mt-1 text-sm text-slate-500">Send a question, share your experience, or raise a concern.</p>
        <form onSubmit={handleSubmit} className="space-y-3 border border-slate-200 bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium text-slate-700">
              Type
              <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} className="mt-1 w-full border border-slate-300 bg-white px-3 py-2 text-sm">
                <option>Question</option><option>Experience</option><option>Concern</option>
              </select>
            </label>
            <label className="text-sm font-medium text-slate-700">
              Library branch
              <select value={form.libraryId} onChange={(event) => setForm({ ...form, libraryId: event.target.value })} className="mt-1 w-full border border-slate-300 bg-white px-3 py-2 text-sm">
                <option value="">System-wide / not branch-specific</option>
                {libraries.map((library) => <option key={library.id} value={library.id}>{library.name}</option>)}
              </select>
            </label>
          </div>
          <label className="block text-sm font-medium text-slate-700">
            Subject
            <input required maxLength={160} value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} className="mt-1 w-full border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Message
            <textarea required rows={5} maxLength={4000} value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} className="mt-1 w-full resize-y border border-slate-300 px-3 py-2 text-sm" />
          </label>
          {faqMatch && (
            <div className="border border-sky-200 bg-sky-50 p-3 text-sm" role="status">
              <p className="font-semibold text-sky-900">Quick answer: {faqMatch.q}</p>
              <p className="mt-1 text-sky-800">{faqMatch.a}</p>
            </div>
          )}
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
          <button type="submit" disabled={submitting} className="bg-shelf-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {submitting ? 'Sending...' : 'Send to library team'}
          </button>
        </form>
      </section>
    </div>
  );
}