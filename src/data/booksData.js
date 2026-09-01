export const initialBooks = [
  {
    id: 'BK-101',
    title: 'Data Structures and Algorithms in Java',
    author: 'Robert Lafore',
    category: 'Computer Science',
    isbn: '978-0672324536',
    shelfLocation: 'Shelf A-3 (Technology)',
    availableCopies: 3,
    totalCopies: 5,
    status: 'Available',
    summary: 'A comprehensive guide to understanding foundational algorithms, binary trees, sorting mechanisms, and memory allocation in Java.',
    coverUrl: 'https://images.unsplash.com/photo-1532012197267-da84d127e765?auto=format&fit=crop&q=80&w=400'
  },
  {
    id: 'BK-102',
    title: 'Clean Code: A Handbook of Agile Software Craftsmanship',
    author: 'Robert C. Martin',
    category: 'Software Engineering',
    isbn: '978-0132350884',
    shelfLocation: 'Shelf B-1 (Software)',
    availableCopies: 0,
    totalCopies: 4,
    status: 'Reserved Queue',
    summary: 'Even bad code can function. But if code isn\'t clean, it can bring a development organization to its knees. Learn how to write code that is clean and readable.',
    coverUrl: 'https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&q=80&w=400'
  },
  {
    id: 'BK-103',
    title: 'Principles of Physics',
    author: 'David Halliday',
    category: 'Science',
    isbn: '978-1118230749',
    shelfLocation: 'Shelf C-2 (Science)',
    availableCopies: 2,
    totalCopies: 2,
    status: 'Available',
    summary: 'An essential textbook offering a solid foundation in mechanics, thermodynamics, electromagnetism, and modern physics principles.',
    coverUrl: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&q=80&w=400'
  }
];

export const initialBorrowRecords = [
  {
    id: 'TXN-901',
    bookId: 'BK-101',
    bookTitle: 'Data Structures and Algorithms in Java',
    borrowerName: 'Juan Dela Cruz',
    borrowDate: '2026-08-01',
    dueDate: '2026-08-10', // Overdue
    returnDate: null,
    status: 'Overdue',
    fineAmount: 80 // Calculated fine in PHP
  },
  {
    id: 'TXN-902',
    bookId: 'BK-103',
    bookTitle: 'Principles of Physics',
    borrowerName: 'Juan Dela Cruz',
    borrowDate: '2026-08-15',
    dueDate: '2026-08-22',
    returnDate: null,
    status: 'Borrowed',
    fineAmount: 0
  }
];