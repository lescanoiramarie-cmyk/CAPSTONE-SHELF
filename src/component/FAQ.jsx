import { useState } from 'react';
import { CircleHelp, SearchX } from 'lucide-react';
import { FAQS } from '../data/faqData.js';

export default function FAQ() {
  const [openIndex, setOpenIndex] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  const toggleAccordion = (id) => {
    setOpenIndex(openIndex === id ? null : id);
  };
  const hasResults = FAQS.some((group) => group.questions.some((item) =>
    item.q.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.a.toLowerCase().includes(searchTerm.toLowerCase())
  ));

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