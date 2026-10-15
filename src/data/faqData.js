export const FAQS = [
  {
    category: 'Catalog, Requests & Borrowing',
    questions: [
      {
        q: 'How do I find and request a library book?',
        a: 'Open Catalog or Book Categories, search for a title, and select a book to see its branch availability. Submit a request from the book details. You can follow its status in My Requests & Borrows.',
      },
      {
        q: 'How long can I borrow a library book?',
        a: 'Library books are normally due seven days after staff confirms pickup. Check the due date in My Requests & Borrows.',
      },
      {
        q: 'How do I pick up a library book?',
        a: 'Visit the branch shown for the book when your request is ready for pickup. Show your visitor QR pass to library staff, who confirms the pickup.',
      },
      {
        q: 'What happens if I return a library book late?',
        a: 'Overdue library books accrue a fine of PHP 10 per day. Check the due date and any current fine in My Requests & Borrows.',
      },
      {
        q: 'How do I cancel a library book request?',
        a: 'Open My Requests & Borrows and cancel a request while it is queued or ready for pickup. Requests that are already borrowed cannot be cancelled there.',
      },
    ],
  },
  {
    category: 'Community & Personal Books',
    questions: [
      {
        q: 'How do I borrow a community book?',
        a: 'Open Community Books and submit a request for an available listing. The request enters the book’s queue and its owner must approve it. Check My Requests & Borrows for your queue position and status.',
      },
      {
        q: 'How does community book pickup work?',
        a: 'After the owner approves your request, use the contact details and handover arrangements shown with the request to arrange the exchange. The owner confirms the handover in SHELF.',
      },
      {
        q: 'How do I return a community book?',
        a: 'Arrange the return with the owner using the contact information in your approved request. The owner confirms the return in SHELF; the book then becomes available for the next request.',
      },
      {
        q: 'How do I add a personal book?',
        a: 'Open My Personal Books and choose Add Personal Book. Enter its details and choose whether it is private or publicly listed. Enable lending if you want other visitors to request it.',
      },
      {
        q: 'How do I manage requests for my community books?',
        a: 'Open My Personal Books and review Community Book Requests. Confirm or reject pending requests, confirm handover after giving out a book, and confirm its return after it is given back.',
      },
      {
        q: 'Can I make my personal book private?',
        a: 'Yes. Use the visibility button on your book in My Personal Books to make a public listing private or publish a private book. Private books are not shown in Community Books.',
      },
    ],
  },
  {
    category: 'Visitor Account & Dashboard',
    questions: [
      {
        q: 'Where can I find my visitor QR pass?',
        a: 'Open Profile in the visitor dashboard to view your QR pass. You can save it as an image and present it for attendance or library circulation checks.',
      },
      {
        q: 'How do I save a book for later?',
        a: 'Use the save control on a catalog book. Your saved items appear in My Reading List, where you can remove them when you no longer need them.',
      },
      {
        q: 'Where can I see announcements or contact the library?',
        a: 'Open Announcements & Feedback in the visitor dashboard to read published announcements or send feedback to the library.',
      },
      {
        q: 'How do I find a library branch?',
        a: 'Open Library Map to search and filter partner branches, view their locations and available details, or browse a branch catalog.',
      },
      {
        q: 'How do I change my password?',
        a: 'Use Forgot Password on the sign-in page. Enter the email linked to your account, verify the code sent to you, and choose a new password.',
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
