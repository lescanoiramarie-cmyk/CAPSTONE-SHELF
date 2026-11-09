import { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Inbox,
  MessageSquareText,
  Send,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient.js';
import { findFAQResponse } from '../data/faqData.js';
import { useProgressiveList } from '../hooks/useProgressiveList.js';
import ProgressiveListFooter from './ProgressiveListFooter.jsx';

const emptyForm = {
  category: 'Question',
  subject: '',
  message: '',
  libraryId: '',
};

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

export default function VisitorServices({ user, libraries = [] }) {
  const [announcements, setAnnouncements] = useState([]);
  const [feedbackItems, setFeedbackItems] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [announcementSearch, setAnnouncementSearch] = useState('');
  const [feedbackSearch, setFeedbackSearch] = useState('');
  const [feedbackPage, setFeedbackPage] = useState(1);
  const feedbackPageSize = 10;

  useEffect(() => {
    let active = true;

    async function loadAnnouncements() {
      if (!supabase) {
        setLoadError('Announcements are unavailable until Supabase is configured.');
        setLoading(false);
        return;
      }

      try {
        const announcementRequest = supabase
          .from('announcements')
          .select('id, title, message, created_at')
          .eq('published', true)
          .in('audience', ['visitor', 'both'])
          .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
          .order('created_at', { ascending: false });
        const feedbackRequest = user?.id
          ? supabase
              .from('visitor_feedback')
              .select('id, category, subject, message, library_id, status, admin_reply, replied_at, created_at')
              .eq('visitor_id', user.id)
              .order('created_at', { ascending: false })
          : Promise.resolve({ data: [], error: null });
        const [announcementResult, feedbackResult] = await Promise.all([announcementRequest, feedbackRequest]);

        if (!active) return;
        if (announcementResult.error) {
          setLoadError(announcementResult.error.message);
        } else {
          setAnnouncements(announcementResult.data || []);
        }
        if (feedbackResult.error) {
          setLoadError((current) => current
            ? `${current} ${feedbackResult.error.message}`
            : feedbackResult.error.message);
        } else {
          setFeedbackItems(feedbackResult.data || []);
        }
      } catch (loadError) {
        if (active) setLoadError(loadError.message || 'Unable to load visitor services.');
      } finally {
        if (active) setLoading(false);
      }
    }

    loadAnnouncements();
    return () => { active = false; };
  }, [user?.email, user?.id]);

  const faqMatch = findFAQResponse(`${form.subject} ${form.message}`);
  const filteredAnnouncements = useMemo(() => {
    const term = announcementSearch.trim().toLowerCase();
    return announcements.filter((item) =>
      !term || `${item.title || ''} ${item.message || ''}`.toLowerCase().includes(term)
    );
  }, [announcementSearch, announcements]);
  const announcementList = useProgressiveList(filteredAnnouncements, 8);
  const filteredFeedback = useMemo(() => {
    const term = feedbackSearch.trim().toLowerCase();
    return feedbackItems.filter((item) =>
      !term || `${item.category || ''} ${item.subject || ''} ${item.message || ''} ${item.admin_reply || ''}`.toLowerCase().includes(term)
    );
  }, [feedbackSearch, feedbackItems]);
  const feedbackPageCount = Math.max(1, Math.ceil(filteredFeedback.length / feedbackPageSize));
  const currentFeedbackPage = Math.min(feedbackPage, feedbackPageCount);
  const visibleFeedback = useMemo(() => {
    const start = (currentFeedbackPage - 1) * feedbackPageSize;
    return filteredFeedback.slice(start, start + feedbackPageSize);
  }, [currentFeedbackPage, feedbackPageSize, filteredFeedback]);

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
      const { data: submittedFeedback, error: insertError } = await supabase.from('visitor_feedback').insert({
        visitor_id: user?.id || null,
        visitor_name: user?.name || 'Visitor',
        visitor_email: user?.email || null,
        library_id: form.libraryId || null,
        category: form.category,
        subject: form.subject.trim(),
        message: form.message.trim(),
      }).select('id, category, subject, message, library_id, status, admin_reply, replied_at, created_at').single();
      if (insertError) throw insertError;
      if (submittedFeedback) {
        setFeedbackItems((current) => [submittedFeedback, ...current]);
        setFeedbackPage(1);
      }
      setNotice('Your message was sent to the library team.');
      setForm(emptyForm);
    } catch (submitError) {
      setError(submitError.message || 'Unable to submit feedback.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-2">
      {loadError && (
        <div role="alert" className="visitor-feedback visitor-feedback-error col-span-full flex items-start rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          <span className="visitor-feedback-icon" aria-hidden="true"><CircleAlert size={16} /></span>
          <p>{loadError}</p>
          <button type="button" onClick={() => setLoadError('')} aria-label="Dismiss services loading error" className="rounded-md p-1 text-red-700 hover:bg-red-100 dark:text-red-200 dark:hover:bg-red-900/50">
            <X size={17} aria-hidden="true" />
          </button>
        </div>
      )}

      <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-6" aria-labelledby="announcement-heading">
        <div className="mb-5 flex items-start gap-3">
          <span className="rounded-xl bg-emerald-50 p-2.5 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300" aria-hidden="true">
            <Bell size={19} />
          </span>
          <div>
            <h2 id="announcement-heading" className="text-lg font-bold text-slate-900 dark:text-white">Library announcements</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Updates and notices from the library team</p>
          </div>
        </div>
        {announcements.length > 0 && (
          <label className="mb-4 block">
            <span className="sr-only">Search announcements</span>
            <input
              type="search"
              value={announcementSearch}
              onChange={(event) => setAnnouncementSearch(event.target.value)}
              placeholder="Search announcements"
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>
        )}

        {loading && (
          <div className="rounded-xl bg-slate-50 p-5 text-sm text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">
            Loading announcements...
          </div>
        )}
        {!loading && !loadError && announcements.length === 0 && (
          <div className="flex min-h-36 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-5 py-7 text-center dark:border-slate-600 dark:bg-slate-900/40">
            <Inbox size={24} className="text-slate-400 dark:text-slate-500" aria-hidden="true" />
            <p className="mt-3 text-sm font-semibold text-slate-700 dark:text-slate-200">You are all caught up</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">No announcements are currently published.</p>
          </div>
        )}
        {!loading && announcements.length > 0 && filteredAnnouncements.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-600 dark:text-slate-400">
            No announcements match your search.
          </p>
        )}
        <div className="space-y-3">
          {announcementList.visibleItems.map((item) => (
            <article key={item.id} className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-900/40">
              <div className="flex items-start justify-between gap-3">
                <h3 className="min-w-0 break-words font-semibold text-slate-900 dark:text-slate-100">{item.title}</h3>
                <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">Update</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600 dark:text-slate-300">{item.message}</p>
              <time className="mt-4 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                <Clock3 size={13} aria-hidden="true" />
                {formatDateTime(item.created_at)}
              </time>
            </article>
          ))}
          <ProgressiveListFooter
            noun="announcements"
            totalCount={filteredAnnouncements.length}
            visibleCount={announcementList.visibleCount}
            hasMore={announcementList.hasMore}
            loadMore={announcementList.loadMore}
            sentinelRef={announcementList.sentinelRef}
          />
        </div>
      </section>

      <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-6" aria-labelledby="feedback-heading">
        <div className="mb-5 flex items-start gap-3">
          <span className="rounded-xl bg-blue-50 p-2.5 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300" aria-hidden="true">
            <MessageSquareText size={19} />
          </span>
          <div>
            <h2 id="feedback-heading" className="text-lg font-bold text-slate-900 dark:text-white">Questions and feedback</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Send a question, share your experience, or raise a concern.</p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Type
              <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100">
                <option>Question</option><option>Experience</option><option>Concern</option>
              </select>
            </label>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Library branch
              <select value={form.libraryId} onChange={(event) => setForm({ ...form, libraryId: event.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100">
                <option value="">System-wide / not branch-specific</option>
                {libraries.map((library) => <option key={library.id} value={library.id}>{library.name}</option>)}
              </select>
            </label>
          </div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
            Subject
            <input required maxLength={160} value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
          </label>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
            Message
            <textarea required rows={5} maxLength={4000} value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} className="mt-1.5 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
          </label>
          {faqMatch && (
            <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm dark:border-sky-800 dark:bg-sky-950/40" role="status">
              <p className="font-semibold text-sky-900 dark:text-sky-200">Quick answer: {faqMatch.q}</p>
              <p className="mt-1 leading-6 text-sky-800 dark:text-sky-300">{faqMatch.a}</p>
            </div>
          )}
          {error && (
            <div role="alert" className="visitor-feedback visitor-feedback-error flex items-start rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
              <span className="visitor-feedback-icon" aria-hidden="true"><CircleAlert size={16} /></span>
              <p>{error}</p>
              <button type="button" onClick={() => setError('')} aria-label="Dismiss feedback error" className="rounded-md p-1 text-red-700 hover:bg-red-100 dark:text-red-200 dark:hover:bg-red-900/50">
                <X size={17} aria-hidden="true" />
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="visitor-feedback visitor-feedback-success flex items-start rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
              <span className="visitor-feedback-icon" aria-hidden="true"><CheckCircle2 size={16} /></span>
              <p>{notice}</p>
              <button type="button" onClick={() => setNotice('')} aria-label="Dismiss feedback confirmation" className="rounded-md p-1 text-emerald-700 hover:bg-emerald-100 dark:text-emerald-200 dark:hover:bg-emerald-900/50">
                <X size={17} aria-hidden="true" />
              </button>
            </div>
          )}
          <button type="submit" disabled={submitting} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-shelf-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">
            <Send size={15} aria-hidden="true" />
            {submitting ? 'Sending...' : 'Send to library team'}
          </button>
        </form>
      </section>

      <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-6 lg:col-span-2" aria-labelledby="feedback-submissions-heading">
        <div className="mb-5 flex items-start gap-3">
          <span className="rounded-xl bg-violet-50 p-2.5 text-violet-800 dark:bg-violet-950/50 dark:text-violet-300" aria-hidden="true">
            <MessageSquareText size={19} />
          </span>
          <div>
            <h2 id="feedback-submissions-heading" className="text-lg font-bold text-slate-900 dark:text-white">Your submissions</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">View the questions, experiences, and concerns you sent, along with their status and library replies.</p>
          </div>
        </div>
        {feedbackItems.length > 0 && (
          <label className="mb-4 block">
            <span className="sr-only">Search your submissions</span>
            <input
              type="search"
              value={feedbackSearch}
              onChange={(event) => { setFeedbackPage(1); setFeedbackSearch(event.target.value); }}
              placeholder="Search your submissions and replies"
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>
        )}
        {loading ? (
          <div className="rounded-xl bg-slate-50 p-5 text-sm text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">Loading your submissions...</div>
        ) : feedbackItems.length === 0 && !loadError ? (
          <div className="flex min-h-28 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-5 py-6 text-center dark:border-slate-600 dark:bg-slate-900/40">
            <p className="text-sm text-slate-500 dark:text-slate-400">You have not submitted any questions or feedback yet.</p>
          </div>
        ) : feedbackItems.length > 0 && filteredFeedback.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-600 dark:text-slate-400">
            No submissions match your search.
          </p>
        ) : feedbackItems.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2">
            {visibleFeedback.map((item) => (
              <article key={item.id} className="min-w-0 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-900/40">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="break-words text-sm font-semibold text-slate-900 dark:text-slate-100">{item.subject}</h3>
                  <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-800 dark:bg-blue-900/50 dark:text-blue-200">{item.status === 'answered' ? 'Answered' : item.status === 'in_review' ? 'In review' : 'Sent'}</span>
                </div>
                <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">{item.category || 'Feedback'}{item.library_id ? ` · ${libraries.find((library) => String(library.id) === String(item.library_id))?.name || 'Library'}` : ' · System-wide'}</p>
                <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700 dark:text-slate-300">{item.message}</p>
                <time className="mt-3 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400"><Clock3 size={13} aria-hidden="true" />Submitted {formatDateTime(item.created_at)}</time>
                {item.admin_reply && <div className="mt-4 rounded-lg border border-violet-200 bg-violet-50 p-3 dark:border-violet-800 dark:bg-violet-950/40"><p className="text-xs font-bold text-violet-900 dark:text-violet-200">Library reply</p><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-violet-900 dark:text-violet-100">{item.admin_reply}</p>{item.replied_at && <time className="mt-2 flex items-center gap-1.5 text-xs text-violet-700 dark:text-violet-300"><Clock3 size={13} aria-hidden="true" />{formatDateTime(item.replied_at)}</time>}</div>}
              </article>
            ))}
          </div>
        ) : null}
        {!loading && filteredFeedback.length > 0 && (
          <nav aria-label="Your feedback submissions pagination" className="mt-4 flex flex-col gap-3 border-t border-slate-200 pt-4 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-600 dark:text-slate-300">Showing {(currentFeedbackPage - 1) * feedbackPageSize + 1}–{Math.min(currentFeedbackPage * feedbackPageSize, filteredFeedback.length)} of {filteredFeedback.length} submissions</p>
            <div className="flex items-center justify-between gap-3 sm:justify-end">
              <button type="button" disabled={currentFeedbackPage <= 1} onClick={() => setFeedbackPage((page) => Math.max(1, page - 1))} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:text-slate-200"><ChevronLeft size={16} aria-hidden="true" />Previous</button>
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Page {currentFeedbackPage} of {feedbackPageCount}</span>
              <button type="button" disabled={currentFeedbackPage >= feedbackPageCount} onClick={() => setFeedbackPage((page) => Math.min(feedbackPageCount, page + 1))} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:text-slate-200">Next<ChevronRight size={16} aria-hidden="true" /></button>
            </div>
          </nav>
        )}
      </section>
    </div>
  );
}
