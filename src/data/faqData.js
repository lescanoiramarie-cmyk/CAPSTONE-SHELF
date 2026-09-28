export const FAQS = [
  {
    category: 'Book Borrowing & Circulation',
    questions: [
      {
        q: 'How do I request to borrow a book using SHELF ILMS?',
        a: 'Navigate to the OPAC Catalog tab on your Visitor Dashboard. Search for your desired book and click a book card to review its branch locations and borrowing options. You will be notified when your requested book is ready for pickup.',
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
    category: 'Visitor QR Code & Profile',
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
    category: 'Library Branches & Operating Hours',
    questions: [
      {
        q: 'How do I check partner library locations?',
        a: 'Navigate to the Libraries & Map tab in the navigation menu. There you will find an interactive map along with the complete addresses and locations of all partner public libraries.',
      },
      {
        q: 'What are the operating hours of the libraries?',
        a: 'Most partner branches operate from 8:00 AM to 5:00 PM, Monday through Friday. Verify exact operating hours for a specific branch under the Libraries & Map section.',
      },
    ],
  },
];

export function findFAQResponse(question) {
  const queryTerms = String(question || '').toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 3);
  if (queryTerms.length === 0) return null;

  return FAQS.flatMap((group) => group.questions).find((item) => {
    const terms = item.q.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 3);
    const matches = terms.filter((term) => queryTerms.some((queryTerm) => (
      queryTerm.startsWith(term.slice(0, 4)) || term.startsWith(queryTerm.slice(0, 4))
    ))).length;
    return matches >= Math.min(2, terms.length);
  }) || null;
}