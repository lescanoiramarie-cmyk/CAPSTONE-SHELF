import { useState } from 'react';

const FAQS = [
  {
    category: '📖 Book Borrowing & Circulation',
    questions: [
      {
        q: 'How do I request to borrow a book using SHELF ILMS?',
        a: 'Navigate to the OPAC Catalog tab on your Visitor Dashboard. Search for your desired book and click "Request Borrow". You will be notified when your requested book is ready for pickup.',
      },
      {
        q: 'How long is the borrowing period?',
        a: 'The standard borrowing period is seven (7) days starting from the date your pickup is confirmed by the library staff.',
      },
      {
        q: 'Where do I collect my requested book?',
        a: 'You must visit the specific library branch where the book is held. Present your Visitor QR Code to the Circulation Staff for verification to complete the pickup process.',
      },
      {
        q: 'What happens if I return a book past its due date?',
        a: 'Overdue items are subject to fines and penalties according to the specific policy of the holding library branch. You can monitor your active borrows and due dates anytime on your dashboard.',
      },
    ],
  },
  {
    category: '🪪 Visitor QR Code & Profile',
    questions: [
      {
        q: 'What is the purpose of my Visitor QR Code?',
        a: 'Your personal Visitor QR Code serves two main purposes: (1) Scanning for Attendance Time-In/Time-Out at library entrances, and (2) Identity verification when picking up or returning borrowed books.',
      },
      {
        q: 'Where can I find my Visitor QR Code?',
        a: 'Your QR Code is displayed directly on the Overview tab of your Visitor Dashboard. You can present it directly from your mobile screen or take a screenshot for quick access.',
      },
      {
        q: 'How can I update my profile details?',
        a: 'You can update your personal details and contact information by accessing the Settings tab from your dashboard menu.',
      },
    ],
  },
  {
    category: '🗺️ Library Branches & Operating Hours',
    questions: [
      {
        q: 'How do I check partner library locations?',
        a: 'Navigate to the "Libraries & Map" tab in the navigation menu. There you will find an interactive map along with the complete addresses and locations of all partner public libraries.',
      },
      {
        q: 'What are the operating hours of the libraries?',
        a: 'Most partner branches operate from 8:00 AM to 5:00 PM, Monday through Friday. However, you can verify exact operating hours for specific branches under the "Libraries & Map" section.',
      },
    ],
  },
];

export default function FAQ() {
  const [openIndex, setOpenIndex] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  const toggleAccordion = (id) => {
    setOpenIndex(openIndex === id ? null : id);
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* HEADER SECTION */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <h2 className="text-xl font-extrabold text-slate-800">
          ❓ Frequently Asked Questions (FAQ)
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
      </div>
    </div>
  );
}