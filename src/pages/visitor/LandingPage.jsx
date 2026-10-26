import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/useAuth.js';
import { useLibraryData } from '../../context/useLibrary.js';
import { fetchPopularBorrowedBookCounts } from '../../data/store.js';
import BookCover from '../../component/BookCover.jsx';
import { supabase } from '../../lib/supabaseClient.js';
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
  Menu,
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

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

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

      if (!reduceMotion) {
        animationFrameId = requestAnimationFrame(render);
      }
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
  const { user } = useAuth();
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
  .filter((book) => /^https?:\/\//i.test(String(book.coverUrl || '').trim()))
  .sort((left, right) =>
    (popularityByBookId.get(String(right.id)) || 0) -
      (popularityByBookId.get(String(left.id)) || 0) ||
    Number(right.availableCopies ?? 0) - Number(left.availableCopies ?? 0) ||
    String(left.title || '').localeCompare(String(right.title || ''))
  )
  .slice(0, 4);
  const [feedback, setFeedback] = useState({ name: '', email: '', message: '' });
  const [submitted, setSubmitted] = useState(false);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackError, setFeedbackError] = useState('');
  const [showFeedbackAuthModal, setShowFeedbackAuthModal] = useState(false);
  const [announcements, setAnnouncements] = useState([]);
  const [announcementsLoading, setAnnouncementsLoading] = useState(true);
  const [announcementsError, setAnnouncementsError] = useState('');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const landingHeaderRef = useRef(null);
  const libraryCarouselRef = useRef(null);
  const isAuthenticated = Boolean(user?.id);
  const authenticatedName = user?.name || user?.fullName || user?.fullname || '';
  const authenticatedEmail = user?.email || '';

  useEffect(() => {
    if (!mobileNavOpen) return undefined;

    const closeOnOutsidePointer = (event) => {
      if (!landingHeaderRef.current?.contains(event.target)) {
        setMobileNavOpen(false);
      }
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setMobileNavOpen(false);
    };

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [mobileNavOpen]);

  // STATE PARA SA SELECTED ANNOUNCEMENT MODAL
  const [selectedAnnouncement, setSelectedAnnouncement] = useState(null);

  useEffect(() => {
    let active = true;

    async function loadLandingAnnouncements() {
      if (!supabase) {
        setAnnouncementsError('Announcements are unavailable until Supabase is configured.');
        setAnnouncementsLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('announcements')
        .select('id, title, message, created_at, expires_at')
        .eq('published', true)
        .is('library_id', null)
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
        .order('created_at', { ascending: false });

      if (!active) return;
      if (error) {
        setAnnouncementsError(error.message || 'Unable to load announcements.');
      } else {
        setAnnouncements(data || []);
      }
      setAnnouncementsLoading(false);
    }

    loadLandingAnnouncements().catch((error) => {
      if (!active) return;
      setAnnouncementsError(error.message || 'Unable to load announcements.');
      setAnnouncementsLoading(false);
    });

    return () => { active = false; };
  }, []);

  const handleFeedbackSubmit = async (e) => {
    e.preventDefault();
    if (feedbackSubmitting) return;
    if (!isAuthenticated) {
      setShowFeedbackAuthModal(true);
      return;
    }
    if (!e.currentTarget.reportValidity()) return;
    if (!supabase) {
      setFeedbackError('Feedback submission is unavailable until Supabase is configured.');
      return;
    }

    setFeedbackSubmitting(true);
    setFeedbackError('');
    try {
      const { error } = await supabase.from('visitor_feedback').insert({
        visitor_id: null,
        library_id: null,
        visitor_name: authenticatedName.trim(),
        visitor_email: authenticatedEmail.trim(),
        category: 'General',
        subject: 'Landing page feedback',
        message: feedback.message.trim(),
      });
      if (error) throw error;

      setSubmitted(true);
      window.setTimeout(() => {
        setSubmitted(false);
        setFeedback((current) => ({ ...current, message: '' }));
      }, 3000);
    } catch (error) {
      setFeedbackError(error.message || 'Unable to submit feedback. Please try again.');
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  return (
    <div className="landing-page min-h-screen bg-slate-50 text-slate-800 font-sans relative">
     
      {/* NAVBAR WITH ICONS & HOVER STYLES */}
      <header ref={landingHeaderRef} className="bg-slate-900/95 backdrop-blur-md text-white shadow-lg sticky top-0 z-40 border-b border-slate-800">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-3.5 sm:px-6 lg:grid lg:grid-cols-[auto_1fr_auto] lg:gap-6">
         
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
          <nav className="hidden items-center justify-self-center gap-1 rounded-xl border border-slate-700/60 bg-slate-800/50 p-1.5 text-xs font-semibold text-slate-300 lg:flex">
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
          <div className="hidden items-center justify-self-end gap-2.5 lg:flex">
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

          <button
            type="button"
            className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-slate-700 bg-slate-800/80 text-slate-200 transition hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 lg:hidden"
            aria-label={mobileNavOpen ? 'Close public navigation' : 'Open public navigation'}
            aria-expanded={mobileNavOpen}
            aria-controls="landing-mobile-nav"
            onClick={() => setMobileNavOpen((open) => !open)}
          >
            {mobileNavOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>
        </div>

        {mobileNavOpen && (
          <div id="landing-mobile-nav" className="border-t border-slate-800 bg-slate-900/98 px-4 py-4 lg:hidden">
            <nav className="mx-auto grid max-w-7xl gap-2 text-sm font-semibold text-slate-200" aria-label="Public navigation">
              {[
                ['#libraries', 'Libraries', Building2],
                ['#featured', 'Featured Books', Sparkles],
                ['#announcements', 'Announcements', Megaphone],
                ['#feedback', 'Feedback', MessageSquare],
              ].map(([href, label, Icon]) => (
                <a
                  key={href}
                  href={href}
                  onClick={() => setMobileNavOpen(false)}
                  className="flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 transition hover:bg-slate-800 hover:text-white"
                >
                  <Icon size={16} className="text-blue-400" aria-hidden="true" />
                  <span>{label}</span>
                </a>
              ))}
              <div className="mt-2 grid gap-2 border-t border-slate-800 pt-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => { setMobileNavOpen(false); navigate('/catalog'); }}
                  className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200 transition hover:bg-slate-700"
                >
                  <Search size={15} className="text-blue-400" aria-hidden="true" />
                  Browse Catalog
                </button>
                <button
                  type="button"
                  onClick={() => { setMobileNavOpen(false); navigate('/visitor-login'); }}
                  className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-blue-500"
                >
                  <LogIn size={15} aria-hidden="true" />
                  Sign In
                </button>
              </div>
            </nav>
          </div>
        )}
      </header>

      {/* HERO SECTION WITH ANIMATED INTERCONNECTED DOTS */}
      <section className="shelf-landing-backdrop relative overflow-hidden border-b border-slate-800 px-4 py-20 text-white sm:px-6 sm:py-24">
        
        {/* ANIMATED CONSTELLATION CANVAS */}
        <ParticleConstellation />

        <div className="relative z-10 mx-auto max-w-5xl space-y-8 text-center">
          {/* BADGE LABEL */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold tracking-wide backdrop-blur-sm">
            <Sparkles size={14} className="text-blue-400" />
            <span>Integrated Library Management System</span>
          </div>

          {/* MAIN HEADLINE */}
          <h1 className="text-[clamp(2.25rem,6vw,4.5rem)] font-black leading-[1.05] tracking-tight text-white">
            Discover & Borrow Books Across <br className="hidden sm:inline" />
            <span className="text-transparent bg-clip-text bg-linear-to-r from-blue-300 to-blue-500">
              Campus Libraries
            </span>
          </h1>

          {/* SUB-TEXT */}
          <p className="mx-auto max-w-2xl text-sm leading-relaxed text-slate-300 sm:text-base md:text-lg">
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
          <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-center gap-x-6 gap-y-3 border-t border-slate-800/80 pt-6 text-xs font-semibold text-slate-400 sm:gap-x-10">
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
      <section id="libraries" className="landing-section bg-slate-50 px-4 py-16 sm:px-6 lg:py-20">
        <div className="mx-auto max-w-7xl">
          <div className="mb-8 flex flex-col gap-4 sm:mb-10 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-blue-700">SHELF network</p>
              <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">Participating Libraries</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Explore libraries connected to SHELF ILMS and their available collections.</p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/catalog')}
              className="inline-flex min-h-10 w-fit items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-shelf-primary shadow-sm transition hover:border-shelf-primary hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shelf-primary focus-visible:ring-offset-2"
            >
              Browse library catalog
              <ArrowRight size={14} aria-hidden="true" />
            </button>
          </div>
        <div
          ref={libraryCarouselRef}
          className="landing-library-scroller"
          role="region"
          aria-label="Participating libraries"
          tabIndex={0}
          onWheel={(event) => {
            const scroller = event.currentTarget;
            const maxScrollLeft = scroller.scrollWidth - scroller.clientWidth;
            const canScroll = event.deltaY < 0
              ? scroller.scrollLeft > 0
              : scroller.scrollLeft < maxScrollLeft;
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
              className="landing-library-card group flex h-full min-w-0 flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-blue-300 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 sm:p-6"
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
                <h3 className="break-words text-lg font-bold leading-snug text-slate-800 transition-colors group-hover:text-blue-600">
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
          {featuredBooks.length > 0 ? (
            <div className="landing-featured-grid">
            {featuredBooks.map((book, i) => (
              <button
                key={book.id || i}
                type="button"
                onClick={() => navigate('/catalog')}
                aria-label={`View ${book.title || 'featured book'} in the public catalog`}
                className="landing-featured-card group flex min-w-0 flex-col justify-between rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-blue-300 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shelf-primary focus-visible:ring-offset-2"
              >
                <div>
                  <div className="landing-book-cover mb-4 flex h-40 w-full items-center justify-center overflow-hidden rounded-xl border border-slate-100 bg-slate-50 p-2 sm:h-48 lg:h-52">
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
                  <h4 title={book.title || 'Untitled Book'} className="mt-2 line-clamp-2 min-h-10 text-base font-bold text-slate-800 transition-colors group-hover:text-blue-600">
                    {book.title}
                  </h4>
                  <p title={book.author || 'Unknown Author'} className="mt-1 line-clamp-2 min-h-8 wrap-break-word text-xs text-slate-500">By {book.author || 'Unknown Author'}</p>
                  <span className="landing-availability-badge mt-4 inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-[11px] font-bold text-green-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-600" aria-hidden="true" />
                    {book.availableCopies} {Number(book.availableCopies) === 1 ? 'copy' : 'copies'} available
                  </span>
                </div>
                <span className="mt-5 inline-flex min-h-10 w-full items-center justify-center rounded-lg bg-shelf-primary py-2 text-xs font-bold text-white shadow-sm transition-colors group-hover:bg-blue-700">
                  View in OPAC
                </span>
              </button>
            ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center shadow-sm">
              <BookOpen className="mx-auto text-slate-400" size={32} aria-hidden="true" />
              <p className="mt-3 text-sm font-semibold text-slate-700">No featured books with cover images are available right now.</p>
              <button
                type="button"
                onClick={() => navigate('/catalog')}
                className="mt-4 rounded-lg bg-shelf-primary px-4 py-2 text-xs font-bold text-white transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shelf-primary focus-visible:ring-offset-2"
              >
                Browse Catalog
              </button>
            </div>
          )}
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
          {announcementsLoading && (
            <p className="md:col-span-2 rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">Loading announcements...</p>
          )}
          {!announcementsLoading && announcementsError && (
            <p role="status" className="md:col-span-2 rounded-xl border border-amber-200 bg-amber-50 p-6 text-center text-sm text-amber-800">{announcementsError}</p>
          )}
          {!announcementsLoading && !announcementsError && announcements.length === 0 && (
            <p className="md:col-span-2 rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">No announcements are currently published.</p>
          )}
          {!announcementsLoading && !announcementsError && announcements.map((item) => {
            const IconComponent = Megaphone;
            const announcement = {
              ...item,
              type: 'General Announcement',
              shortContent: item.message,
              fullContent: item.message,
              date: item.created_at
                ? new Date(item.created_at).toLocaleDateString('en-PH', { dateStyle: 'medium' })
                : 'Date unavailable',
            };
            return (
              <div
                key={announcement.id}
                onClick={() => setSelectedAnnouncement(announcement)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelectedAnnouncement(announcement);
                  }
                }}
                role="button"
                tabIndex={0}
                aria-label={`Read announcement: ${announcement.title}`}
                className="group relative bg-white rounded-2xl border border-slate-200/80 p-6 shadow-sm transition-all duration-300 hover:-translate-y-1.5 hover:shadow-xl hover:border-blue-300 flex flex-col justify-between overflow-hidden cursor-pointer"
              >
                <div className="absolute top-0 left-0 right-0 h-1.5 bg-blue-600 transition-colors duration-300" />
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200/60 bg-blue-50 px-3 py-1 text-xs font-bold uppercase tracking-wider text-blue-700">
                      <IconComponent size={14} className="text-blue-600" />
                      {announcement.type}
                    </span>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-800 group-hover:text-blue-600 transition-colors duration-200 line-clamp-2">
                      {announcement.title}
                    </h3>
                    <p className="mt-2 text-xs text-slate-600 leading-relaxed line-clamp-3">
                      {announcement.shortContent}
                    </p>
                  </div>
                </div>
                <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
                  <div className="flex items-center gap-1.5">
                    <Calendar size={13} className="text-slate-400" />
                    <span>Posted on {announcement.date}</span>
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
                  Thank you for taking the time to share your feedback. It has been sent to the SHELF Super Admin.
                </p>
              </div>
            ) : (
              <form onSubmit={handleFeedbackSubmit} noValidate className="space-y-5 text-left">
                <div>
                  <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                    Your Name
                  </label>
                  <div className="relative">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input
                      type="text"
                      value={isAuthenticated ? authenticatedName : feedback.name}
                      onChange={(e) => setFeedback((current) => ({ ...current, name: e.target.value }))}
                      readOnly={isAuthenticated}
                      placeholder="Juan Dela Cruz"
                      maxLength={120}
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
                      value={isAuthenticated ? authenticatedEmail : feedback.email}
                      onChange={(e) => setFeedback((current) => ({ ...current, email: e.target.value }))}
                      readOnly={isAuthenticated}
                      placeholder="your.email@example.com"
                      maxLength={254}
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
                    onChange={(e) => setFeedback((current) => ({ ...current, message: e.target.value }))}
                    placeholder="Share your thoughts, suggestions, or issues..."
                    maxLength={5000}
                    className="w-full p-4 bg-slate-900/90 border border-slate-700/80 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all resize-none"
                    required
                  ></textarea>
                </div>
                {feedbackError && (
                  <p role="alert" className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{feedbackError}</p>
                )}
                <button
                  type="submit"
                  disabled={feedbackSubmitting}
                  className="w-full py-3.5 bg-blue-600 hover:bg-blue-500 disabled:cursor-wait disabled:opacity-70 text-white font-bold rounded-xl transition shadow-lg shadow-blue-600/25 flex items-center justify-center gap-2 text-sm transform hover:-translate-y-0.5"
                >
                  <Send size={16} />
                  <span>{feedbackSubmitting ? 'Sending...' : 'Submit Feedback'}</span>
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

      {showFeedbackAuthModal && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-auth-title"
            className="relative w-full max-w-md space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
          >
            <button
              type="button"
              onClick={() => setShowFeedbackAuthModal(false)}
              aria-label="Close sign-in prompt"
              className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-800"
            >
              <X size={18} aria-hidden="true" />
            </button>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
              <MessageSquare size={20} aria-hidden="true" />
            </div>
            <h2 id="feedback-auth-title" className="pr-8 text-lg font-bold text-slate-900">
              Sign in required
            </h2>
            <p className="text-sm leading-relaxed text-slate-600">
              Please sign in to send feedback or suggestions.
            </p>
            <button
              type="button"
              onClick={() => navigate('/visitor-login')}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-shelf-primary px-4 py-3 text-sm font-bold text-white transition hover:opacity-90"
            >
              <LogIn size={16} aria-hidden="true" />
              Sign In
            </button>
          </section>
        </div>
      )}

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
            <p className="whitespace-pre-wrap break-words text-sm text-slate-600 leading-relaxed border-t border-slate-100 pt-4">
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
