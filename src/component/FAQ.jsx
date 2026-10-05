import { useState } from 'react';
import { CircleHelp, SearchX } from 'lucide-react';
import { FAQS } from '../data/faqData.js';

export default function FAQ() {
  const [openIndex, setOpenIndex] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [answerError, setAnswerError] = useState('');
  const [asking, setAsking] = useState(false);

  const toggleAccordion = (id) => {
    setOpenIndex(openIndex === id ? null : id);
  };
  const hasResults = FAQS.some((group) => group.questions.some((item) =>
    item.q.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.a.toLowerCase().includes(searchTerm.toLowerCase())
  ));

  const askQuestion = async (event) => {
    event.preventDefault();
    const submittedQuestion = question.trim();
    if (!submittedQuestion) return;

    const apiUrl = import.meta.env.VITE_ANALYTICS_API_URL;
    if (!apiUrl) {
      setAnswerError(
        'Conversational answers are unavailable: VITE_ANALYTICS_API_URL is not configured.'
      );
      setAnswer('');
      return;
    }

    setAsking(true);
    setAnswerError('');
    setAnswer('');
    try {
      const response = await fetch(`${apiUrl.replace(/\/+$/, '')}/faq/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: submittedQuestion,
          faq_corpus: FAQS.flatMap((group) =>
            group.questions.map((item) => ({
              question: item.q,
              answer: item.a,
            }))
          ),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          payload.detail || `The FAQ service returned an error (${response.status}).`
        );
      }
      if (typeof payload.answer !== 'string' || !payload.answer.trim()) {
        throw new Error('The FAQ service returned an invalid answer.');
      }
      setAnswer(payload.answer.trim());
    } catch (error) {
      setAnswerError(
        error.message || 'Unable to get a conversational answer right now.'
      );
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* HEADER SECTION */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <h2 className="flex items-center gap-2 text-xl font-extrabold text-slate-800">
          <span className="rounded-lg bg-amber-50 p-2 text-amber-700"><CircleHelp size={18} aria-hidden="true" /></span>
          Frequently Asked Questions (FAQ)
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Have questions about book borrowing, your QR code, or library branch hours? Find answers below.
        </p>

        {/* SEARCH BAR */}
        <div className="mt-4">
          <input
            type="text"
            placeholder="Search questions (e.g., borrow, QR code, due date, branch)..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-4 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600 transition"
          />
        </div>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-bold text-slate-800">Ask a question</h3>
        <p className="mt-1 text-xs text-slate-500">
          Answers are generated using only the SHELF FAQ information below.
        </p>
        <form onSubmit={askQuestion} className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            maxLength={500}
            required
            aria-label="Ask a question about SHELF"
            placeholder="Ask in your own words..."
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:border-blue-600"
          />
          <button
            type="submit"
            disabled={asking || !question.trim()}
            className="rounded-lg bg-[#002046] px-5 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {asking ? 'Finding an answer…' : 'Ask'}
          </button>
        </form>
        {answerError && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
            {answerError}
          </p>
        )}
        {answer && (
          <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm leading-relaxed text-blue-950" role="status">
            {answer}
          </div>
        )}
      </section>

      {/* ACCORDION FAQ CONTENT */}
      <div className="space-y-6">
        {FAQS.map((group, groupIdx) => {
          const filteredQuestions = group.questions.filter(
            (item) =>
              item.q.toLowerCase().includes(searchTerm.toLowerCase()) ||
              item.a.toLowerCase().includes(searchTerm.toLowerCase())
          );

          if (filteredQuestions.length === 0) return null;

          return (
            <div key={groupIdx} className="space-y-3">
              <h3 className="text-xs font-bold text-slate-500 tracking-wider uppercase px-1">
                {group.category}
              </h3>

              <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100 overflow-hidden">
                {filteredQuestions.map((item, qIdx) => {
                  const accordionId = `${groupIdx}-${qIdx}`;
                  const isOpen = openIndex === accordionId;

                  return (
                    <div key={qIdx} className="p-4">
                      <button
                        type="button"
                        onClick={() => toggleAccordion(accordionId)}
                        className="w-full flex items-center justify-between text-left focus:outline-none"
                      >
                        <span className="text-sm font-bold text-slate-800">
                          {item.q}
                        </span>
                        <span className="text-slate-400 font-extrabold text-lg ml-2">
                          {isOpen ? '−' : '+'}
                        </span>
                      </button>

                      {isOpen && (
                        <div className="mt-3 text-xs text-slate-600 leading-relaxed bg-slate-50 p-3.5 rounded-lg border border-slate-100">
                          {item.a}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {!hasResults && searchTerm.trim() && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center">
            <SearchX size={30} className="mx-auto text-slate-400" aria-hidden="true" />
            <h3 className="mt-3 text-base font-bold text-slate-800">No answers surfaced for that search.</h3>
            <p className="mt-1 text-sm text-slate-500">Try another phrase and we’ll take another look.</p>
            <button type="button" onClick={() => setSearchTerm('')} className="mt-4 rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-amber-400">Clear search</button>
          </div>
        )}
      </div>
    </div>
  );
}
