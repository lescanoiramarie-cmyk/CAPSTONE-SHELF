import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLibraryData } from '../../context/useLibrary.js';
import { fetchPopularBorrowedBookCounts } from '../../data/store.js';
import BookCover from '../../component/BookCover.jsx';
import { 
  Megaphone, 
  Sparkles, 
  Calendar, 
  ArrowRight, 
  BookOpen, 
  Building2, 
  MessageSquare, 
  Search, 
  LogIn,
  User,
  Mail,
  Send,
  X,
  CircleCheck,
  MapPin
} from 'lucide-react';

// =========================================================
// ANIMATED INTERCONNECTED DOTS CANVAS COMPONENT
// =========================================================
function ParticleConstellation() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId;
    let width = (canvas.width = canvas.parentElement.offsetWidth);
    let height = (canvas.height = canvas.parentElement.offsetHeight);

    const handleResize = () => {
      if (!canvas.parentElement) return;
      width = canvas.width = canvas.parentElement.offsetWidth;
      height = canvas.height = canvas.parentElement.offsetHeight;
    };

    window.addEventListener('resize', handleResize);

    // PARTICLES CONFIGURATION
    const particleCount = Math.min(Math.floor((width * height) / 10000), 65);
    const particles = [];
    const maxDistance = 130;

    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.6,
        vy: (Math.random() - 0.5) * 0.6,
        radius: Math.random() * 2 + 1.5,
      });
    }

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      // UPDATE & DRAW PARTICLES
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0 || p.x > width) p.vx *= -1;
        if (p.y < 0 || p.y > height) p.vy *= -1;

        // DRAW DOT
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(96, 165, 250, 0.7)'; // Light blue dot
        ctx.fill();

        // CONNECT DOTS WITH LINES
        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j];
          const dx = p.x - p2.x;
          const dy = p.y - p2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < maxDistance) {
            const alpha = (1 - dist / maxDistance) * 0.35;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = `rgba(59, 130, 246, ${alpha})`; // Blue connecting lines
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <canvas 
      ref={canvasRef} 
      className="absolute inset-0 w-full h-full pointer-events-none z-0 opacity-80"
    />
  );
}

// =========================================================
// MAIN LANDING PAGE COMPONENT
// =========================================================
export default function LandingPage() {
  const navigate = useNavigate();
  const { books = [], libraries = [] } = useLibraryData();
  const [popularBookCounts, setPopularBookCounts] = useState([]);

  useEffect(() => {
    let active = true;
    fetchPopularBorrowedBookCounts()
      .then((counts) => {
        if (active) setPopularBookCounts(counts);
      })
      .catch((error) => {
        console.warn('Popular book counts are unavailable:', error.message);
      });

    return () => {
      active = false;
    };
  }, []);

  const popularityByBookId = new Map(
    popularBookCounts.map((item) => [item.bookId, item.borrowCount])
  );

const featuredLibraries = libraries
  .filter((library) => {
    if (library.isSampleLocation) return false;
    const libraryDetails = [
      library.name,
      library.campus,
      library.address,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return !libraryDetails.includes('laguna');
  });


const featuredBooks = books
  .filter((book) => book.bookType === 'library')
  .filter((book) => Number(book.availableCopies ?? 0) > 0)
  .sort((left, right) =>
    (popularityByBookId.get(String(right.id)) || 0) -
      (popularityByBookId.get(String(left.id)) || 0) ||
    Number(right.availableCopies ?? 0) - Number(left.availableCopies ?? 0) ||
    String(left.title || '').localeCompare(String(right.title || ''))
  )
  .slice(0, 4);
  const [feedback, setFeedback] = useState({ name: '', email: '', message: '' });
  const [submitted, setSubmitted] = useState(false);

  // STATE PARA SA SELECTED ANNOUNCEMENT MODAL
  const [selectedAnnouncement, setSelectedAnnouncement] = useState(null);

  // LIST OF ANNOUNCEMENTS DATA
  const announcementsList = [
    {
      id: 1,
      type: 'System Notice',
      title: 'Extended Library Hours During Midterms',
      shortContent: 'All participating campus libraries will remain open until 8:00 PM during exam week to support student revision.',
      fullContent: 'To help students prepare for their upcoming midterm examinations, all campus libraries under the SHELF network will extend their operating hours up to 8:00 PM starting October 20 until October 31, 2026. Discussion rooms, computer laboratories, and silent study zones will remain open. Security and library staff will be on duty during these extended hours.',
      date: 'October 15, 2026',
      icon: Megaphone,
    },
    {
      id: 2,
      type: 'New Arrival',
      title: '2026 Tech & Science Collection Added',
      shortContent: 'Over 200 new titles in computer science, engineering, and digital media have been added to the public catalog.',
      fullContent: 'We are excited to announce that over 200 physical and digital books have been added to our catalog! Highlights include the latest editions on Artificial Intelligence, Web Development, Data Structures, Robotics, and Renewable Energy Systems. Visit your campus library or check out the OPAC online catalog to place a reservation today.',
      date: 'October 10, 2026',
      icon: Sparkles,
    },
  ];

  const handleFeedbackSubmit = (e) => {
    e.preventDefault();
    if (feedback.message.trim()) {
      setSubmitted(true);
      setTimeout(() => {
        setSubmitted(false);
        setFeedback({ name: '', email: '', message: '' });
      }, 3000);
    }
  };

  return (
    <div className="landing-page min-h-screen bg-slate-50 text-slate-800 font-sans relative">
     
      {/* NAVBAR WITH ICONS & HOVER STYLES */}
      <header className="bg-slate-900/95 backdrop-blur-md text-white shadow-lg sticky top-0 z-40 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-6 py-3.5 flex items-center justify-between">
         
          {/* BRAND LOGO WITH ICON */}
          <div
            className="flex items-center gap-2.5 cursor-pointer group"
            onClick={() => navigate('/')}
          >
            <div className="w-9 h-9 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 group-hover:bg-blue-600 group-hover:text-white transition-all duration-300">
              <BookOpen size={20} />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-2xl font-black tracking-wider text-white group-hover:text-blue-400 transition-colors">
                SHELF
              </span>
              <span className="text-[10px] bg-blue-600 px-2 py-0.5 rounded-md font-extrabold text-white uppercase tracking-wider shadow-sm">
                ILMS
              </span>
            </div>
          </div>

          {/* NAVIGATION LINKS */}
          <nav className="hidden md:flex items-center gap-1 text-xs font-semibold text-slate-300 bg-slate-800/50 p-1.5 rounded-xl border border-slate-700/60">
            <a
              href="#libraries"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:text-white hover:bg-slate-700/80 transition-all duration-200"
            >
              <Building2 size={14} className="text-blue-400" />
              <span>Libraries</span>
            </a>
            <a
              href="#featured"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:text-white hover:bg-slate-700/80 transition-all duration-200"
            >
              <Sparkles size={14} className="text-blue-400" />
              <span>Featured Books</span>
            </a>
            <a
              href="#announcements"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:text-white hover:bg-slate-700/80 transition-all duration-200"
            >
              <Megaphone size={14} className="text-blue-400" />
              <span>Announcements</span>
            </a>
            <a
              href="#feedback"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:text-white hover:bg-slate-700/80 transition-all duration-200"
            >
              <MessageSquare size={14} className="text-blue-400" />
              <span>Feedback</span>
            </a>
          </nav>

          {/* ACTION BUTTONS */}
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => navigate('/catalog')}
              className="px-3.5 py-2 border border-slate-700 bg-slate-800/80 text-slate-200 hover:text-white hover:bg-slate-700 hover:border-slate-600 rounded-lg text-xs font-bold transition-all duration-200 flex items-center gap-1.5 shadow-sm"
            >
              <Search size={14} className="text-blue-400" />
              <span>Browse Catalog</span>
            </button>
            <button
              onClick={() => navigate('/visitor-login')}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold transition-all duration-200 shadow-md shadow-blue-600/20 flex items-center gap-1.5 transform hover:-translate-y-0.5"
            >
              <LogIn size={14} />
              <span>Sign In</span>
            </button>
          </div>
        </div>
      </header>

      {/* HERO SECTION WITH ANIMATED INTERCONNECTED DOTS */}
      <section className="shelf-landing-backdrop relative text-white py-24 px-6 overflow-hidden border-b border-slate-800">
        
        {/* ANIMATED CONSTELLATION CANVAS */}
        <ParticleConstellation />

        <div className="max-w-4xl mx-auto text-center space-y-8 relative z-10">
          {/* BADGE LABEL */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold tracking-wide backdrop-blur-sm">
            <Sparkles size={14} className="text-blue-400" />
            <span>Integrated Library Management System</span>
          </div>

          {/* MAIN HEADLINE */}
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-black tracking-tight leading-tight text-white">
            Discover & Borrow Books Across <br className="hidden sm:inline" />
            <span className="text-transparent bg-clip-text bg-linear-to-r from-blue-300 to-blue-500">
              Campus Libraries
            </span>
          </h1>

          {/* SUB-TEXT */}
          <p className="text-sm sm:text-base md:text-lg text-slate-300 max-w-2xl mx-auto leading-relaxed">
            Welcome to SHELF ILMS — your gateway to physical and digital library collections, announcements, and campus learning resources.
          </p>

          {/* ACTION BUTTONS */}
          <div className="flex flex-col sm:flex-row justify-center items-center gap-3.5 pt-2">
            <button 
              onClick={() => navigate('/catalog')} 
              className="w-full sm:w-auto px-6 py-3.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold rounded-xl shadow-lg shadow-blue-600/30 transition-all duration-200 flex items-center justify-center gap-2 transform hover:-translate-y-0.5"
            >
              <Search size={16} />
              <span>Explore Public Catalog</span>
            </button>

            <button 
              onClick={() => navigate('/visitor-login')}
              className="w-full sm:w-auto px-6 py-3.5 bg-slate-800/90 hover:bg-slate-700/90 text-slate-200 hover:text-white border border-slate-700/80 text-sm font-bold rounded-xl transition-all duration-200 flex items-center justify-center gap-2 shadow-sm backdrop-blur-sm"
            >
              <LogIn size={16} className="text-blue-400" />
              <span>Visitor Sign In / Register</span>
            </button>
          </div>

          {/* QUICK STATS COUNTER */}          
          <div className="pt-6 flex items-center justify-center gap-6 sm:gap-10 text-xs font-semibold text-slate-400 border-t border-slate-800/80 max-w-lg mx-auto">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-300"></span>
              <span>
                {books.filter((book) => book.bookType === 'library').length.toLocaleString()} Books
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-400"></span>
              <span>
                {featuredLibraries.length} Libraries
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-500"></span>
              <span>24/7 OPAC Access</span>
            </div>
          </div>
        </div>
      </section>

      {/* 1. PARTICIPATING LIBRARIES SECTION */}
      <section id="libraries" className="py-16 px-6 max-w-7xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-slate-900">Participating Campus Libraries</h2>
          <p className="text-slate-600 mt-2">Explore member libraries offering integrated borrowing and resources.</p>
        </div>
        <div
          className="landing-library-scroller"
          role="region"
          aria-label="Participating libraries"
          tabIndex={0}
          onWheel={(event) => {
            const scroller = event.currentTarget;
            const maxScrollLeft = scroller.scrollWidth - scroller.clientWidth;
            const canScroll =
              event.deltaY < 0
                ? scroller.scrollLeft > 0
                : event.deltaY !== 0 && scroller.scrollLeft < maxScrollLeft;

            if (maxScrollLeft > 0 && canScroll && Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
              event.preventDefault();
              scroller.scrollLeft += event.deltaY;
            }
          }}
        >
          {featuredLibraries.map((lib) => {
            const isOpen = String(lib.status || '').toLowerCase() === 'open';
            return (
            <button
              key={lib.id}
              type="button"
              onClick={() => navigate('/catalog')}
              className="landing-library-card group flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-6 text-left shadow-sm transition-all duration-300 hover:-translate-y-1.5 hover:border-blue-300 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            >
              <div>
                <div className="flex items-center justify-between mb-4">
                  <span className={`text-[10px] font-extrabold px-2.5 py-1 rounded-full uppercase tracking-wider border flex items-center gap-1.5 ${
                    isOpen
                      ? 'border-blue-200 bg-blue-50 text-blue-700'
                      : 'border-slate-200 bg-slate-100 text-slate-600'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${isOpen ? 'bg-blue-600' : 'bg-slate-400'}`}></span>
                    {lib.status || 'Status unavailable'}
                  </span>
                 
                  <div className="w-10 h-10 rounded-xl bg-slate-50 text-slate-500 group-hover:bg-blue-50 group-hover:text-blue-600 flex items-center justify-center transition-colors">
                    <Building2 size={20} aria-hidden="true" />
                  </div>
                </div>
                <h3 className="text-lg font-bold text-slate-800 group-hover:text-blue-600 transition-colors leading-snug">
                  {lib.name}
                </h3>
                {lib.campus && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
                    <Building2 size={14} className="shrink-0 text-slate-400" aria-hidden="true" />
                    {lib.campus}
                  </p>
                )}
                <p className="text-xs text-slate-500 mt-2 flex items-center gap-1.5">
                  <MapPin size={14} className="text-slate-400 shrink-0" aria-hidden="true" />
                  {lib.address || 'Library location available in SHELF'}
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs font-bold text-blue-600 bg-blue-50/80 px-2.5 py-1 rounded-md">
                  {books.filter(
                    (book) =>
                      String(book.libraryId || book.library_id || '') === String(lib.id)
                  ).length} cataloged books
                </span>
                <span className="text-xs font-bold text-slate-400 group-hover:text-blue-600 transition-colors flex items-center gap-1">
                  Explore <ArrowRight size={14} className="transition-transform group-hover:translate-x-1" aria-hidden="true" />
                </span>
              </div>
            </button>
            );
          })}
        </div>
      </section>

      {/* 2. FEATURED RESOURCES SECTION */}
      <section id="featured" className="py-16 px-6 bg-slate-100 border-y border-slate-200">
        <div className="max-w-7xl mx-auto">
          <div className="mb-8 flex flex-col gap-4 sm:mb-10 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">Featured Books</h2>
              <p className="mt-1 text-sm text-slate-600">Popular books and resources currently available in our catalog.</p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/catalog')}
              className="flex w-fit items-center gap-1 font-bold text-blue-600 transition hover:text-blue-800 group"
            >
              View All Books <ArrowRight size={14} className="transition-transform group-hover:translate-x-1" aria-hidden="true" />
            </button>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 xl:grid-cols-4 xl:gap-6">
            {featuredBooks.map((book, i) => (
              <div
                key={i}
                onClick={() => navigate('/catalog')}
                className="flex min-w-0 cursor-pointer flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-blue-300 hover:shadow-xl group"
              >
                <div>
                  <div className="mb-4 flex aspect-3/4 w-full items-center justify-center overflow-hidden rounded-lg border border-slate-100 bg-slate-50 p-2">
                    <BookCover
                      key={book.coverUrl || book.title}
                      src={book.coverUrl}
                      title={book.title}
                      imageFit="contain"
                      className="h-full w-full border-0 bg-transparent shadow-sm transition-transform duration-300 group-hover:scale-105"
                    />
                  </div>
                 
                  <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded uppercase tracking-wider">
                    {book.category || 'Library Collection'}
                  </span>
                  <h4 className="text-base font-bold text-slate-800 mt-2 line-clamp-1 group-hover:text-blue-600 transition-colors">
                    {book.title}
                  </h4>
                  <p className="mt-0.5 line-clamp-2 wrap-break-word text-xs text-slate-500">By {book.author}</p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate('/catalog');
                  }}
                  className="mt-5 w-full py-2 bg-slate-900 group-hover:bg-blue-600 text-white text-xs font-bold rounded-lg transition-colors shadow-sm"
                >
                  View in OPAC
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 3. ANNOUNCEMENTS SECTION (CLICKABLE WITH DETAILS MODAL) */}
      <section id="announcements" className="py-16 px-6 max-w-7xl mx-auto w-full space-y-8">
        <div className="text-center space-y-2">
          <h2 className="text-3xl font-bold text-slate-900">Library Announcements</h2>
          <p className="text-slate-600 mt-2">Stay updated with the latest library news and holiday schedules.</p>
        </div>
        {/* ANNOUNCEMENT CARDS GRID */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {announcementsList.map((item) => {
            const IconComponent = item.icon || Megaphone;
            return (
              <div
                key={item.id}
                onClick={() => setSelectedAnnouncement(item)}
                className="group relative bg-white rounded-2xl border border-slate-200/80 p-6 shadow-sm transition-all duration-300 hover:-translate-y-1.5 hover:shadow-xl hover:border-blue-300 flex flex-col justify-between overflow-hidden cursor-pointer"
              >
                <div className="absolute top-0 left-0 right-0 h-1.5 bg-blue-600 transition-colors duration-300" />
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200/60 bg-blue-50 px-3 py-1 text-xs font-bold uppercase tracking-wider text-blue-700">
                      <IconComponent size={14} className="text-blue-600" />
                      {item.type}
                    </span>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-800 group-hover:text-blue-600 transition-colors duration-200 line-clamp-2">
                      {item.title}
                    </h3>
                    <p className="mt-2 text-xs text-slate-600 leading-relaxed line-clamp-3">
                      {item.shortContent}
                    </p>
                  </div>
                </div>
                <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
                  <div className="flex items-center gap-1.5">
                    <Calendar size={13} className="text-slate-400" />
                    <span>Posted on {item.date}</span>
                  </div>
                  <div className="inline-flex items-center gap-1 font-bold text-blue-600 opacity-90 transform translate-x-0 transition-all duration-300 group-hover:translate-x-1">
                    <span>Read details</span>
                    <ArrowRight size={14} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 4. ENHANCED FEEDBACK & INQUIRIES SECTION */}
      <section id="feedback" className="py-20 px-6 bg-slate-900 text-white relative overflow-hidden border-t border-slate-800">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-125 h-125 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="max-w-2xl mx-auto relative z-10 space-y-8">
          <div className="text-center space-y-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-full text-xs font-semibold uppercase tracking-wider">
              <MessageSquare size={13} />
              We'd love to hear from you
            </span>
            <h2 className="text-3xl font-extrabold tracking-tight text-white">
              Feedback & Inquiries
            </h2>
            <p className="text-sm text-slate-400 max-w-md mx-auto">
              Have a question, report, or suggestion? Help us improve our campus library services.
            </p>
          </div>
          <div className="bg-slate-800/60 backdrop-blur-md p-6 sm:p-8 rounded-2xl border border-slate-700/80 shadow-2xl">
            {submitted ? (
              <div className="p-6 bg-blue-500/10 border border-blue-500/30 text-blue-200 rounded-xl text-center space-y-2">
                <div className="w-12 h-12 bg-blue-500/20 text-blue-300 rounded-full flex items-center justify-center mx-auto">
                  <CircleCheck size={24} aria-hidden="true" />
                </div>
                <h3 className="font-bold text-base text-blue-100">Feedback Submitted!</h3>
                <p className="text-xs text-blue-200/80">
                  Thank you for taking the time to share your feedback. We appreciate your input!
                </p>
              </div>
            ) : (
              <form onSubmit={handleFeedbackSubmit} className="space-y-5 text-left">
                <div>
                  <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                    Your Name
                  </label>
                  <div className="relative">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input
                      type="text"
                      value={feedback.name}
                      onChange={(e) => setFeedback({ ...feedback, name: e.target.value })}
                      placeholder="Juan Dela Cruz"
                      className="w-full pl-10 pr-4 py-3 bg-slate-900/90 border border-slate-700/80 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input
                      type="email"
                      value={feedback.email}
                      onChange={(e) => setFeedback({ ...feedback, email: e.target.value })}
                      placeholder="your.email@example.com"
                      className="w-full pl-10 pr-4 py-3 bg-slate-900/90 border border-slate-700/80 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                    Message / Suggestion
                  </label>
                  <textarea
                    rows="4"
                    value={feedback.message}
                    onChange={(e) => setFeedback({ ...feedback, message: e.target.value })}
                    placeholder="Share your thoughts, suggestions, or issues..."
                    className="w-full p-4 bg-slate-900/90 border border-slate-700/80 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all resize-none"
                    required
                  ></textarea>
                </div>
                <button
                  type="submit"
                  className="w-full py-3.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition shadow-lg shadow-blue-600/25 flex items-center justify-center gap-2 text-sm transform hover:-translate-y-0.5"
                >
                  <Send size={16} />
                  <span>Submit Feedback</span>
                </button>
              </form>
            )}
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-slate-950 text-slate-500 py-6 text-center text-xs border-t border-slate-800">
        &copy; 2026 SHELF Integrated Library Management System. All rights reserved.
      </footer>

      {/* ANNOUNCEMENT DETAILS MODAL POPUP */}
      {selectedAnnouncement && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white max-w-lg w-full rounded-2xl shadow-2xl border border-slate-200 overflow-hidden relative space-y-6 p-6 sm:p-8">
           
            {/* CLOSE BUTTON */}
            <button
              onClick={() => setSelectedAnnouncement(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center transition"
            >
              <X size={18} />
            </button>
            {/* CATEGORY BADGE */}
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
              'bg-blue-50 text-blue-700 border border-blue-200'
            }`}>
              {selectedAnnouncement.type}
            </span>
            {/* TITLE & DATE */}
            <div>
              <h3 className="text-xl font-black text-slate-900 leading-snug">
                {selectedAnnouncement.title}
              </h3>
              <p className="text-xs text-slate-400 mt-2 flex items-center gap-1.5">
                <Calendar size={13} />
                <span>Posted on {selectedAnnouncement.date}</span>
              </p>
            </div>
            {/* FULL CONTENT */}
            <p className="text-sm text-slate-600 leading-relaxed border-t border-slate-100 pt-4">
              {selectedAnnouncement.fullContent}
            </p>
            {/* MODAL FOOTER BUTTON */}
            <button
              onClick={() => setSelectedAnnouncement(null)}
              className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl transition"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}