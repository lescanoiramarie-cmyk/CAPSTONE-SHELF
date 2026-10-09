
import { useEffect, useRef, useState } from 'react';
import {
  Bot,
  CircleHelp,
  Send,
  UserRound,
  LoaderCircle,
} from 'lucide-react';
import { FAQS } from '../data/faqData.js';

const INITIAL_MESSAGE = {
  role: 'bot',
  text: 'Hi! Welcome to SHELF ILMS. 👋 I can help you with book borrowing, returns, reservations, your Visitor QR Code, library branches, and other library services. What would you like to know?',
};

const SUGGESTED_QUESTIONS = [
  'How do I request to borrow a book using SHELF ILMS?',
  'How long is the borrowing period?',
  'Where can I find my Visitor QR Code?',
  'How do I check partner library locations?',
];

export default function FAQ() {
  const [messages, setMessages] = useState([INITIAL_MESSAGE]);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, asking]);

  const sendQuestion = async (text = question) => {
    const submittedQuestion = text.trim();

    if (!submittedQuestion || asking) return;

    setMessages((previous) => [
      ...previous,
      { role: 'user', text: submittedQuestion },
    ]);
    setQuestion('');
    setAsking(true);

    try {
      const apiUrl = import.meta.env.VITE_ANALYTICS_API_URL;

      if (!apiUrl) {
        throw new Error(
          'The chatbot service is not configured. Please contact the library administrator.'
        );
      }

      const faqCorpus = FAQS.flatMap((group) =>
        group.questions.map((item) => ({
          question: item.q,
          answer: item.a,
        }))
      );

      const response = await fetch(
        `${apiUrl.replace(/\/+$/, '')}/faq/answer`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            question: submittedQuestion,
            faq_corpus: faqCorpus,
          }),
        }
      );

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          payload.detail || 'Unable to get an answer right now.'
        );
      }

      if (
        typeof payload.answer !== 'string' ||
        !payload.answer.trim()
      ) {
        throw new Error('The chatbot returned an empty answer.');
      }

      setMessages((previous) => [
        ...previous,
        { role: 'bot', text: payload.answer.trim() },
      ]);
    } catch (error) {
      setMessages((previous) => [
        ...previous,
        {
          role: 'bot',
          text:
            error.message ||
            'Sorry, I could not connect to the chatbot. Please try again.',
        },
      ]);
    } finally {
      setAsking(false);
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    sendQuestion();
  };

  const resetChat = () => {
    if (asking) return;

    setMessages([INITIAL_MESSAGE]);
    setQuestion('');
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      {/* HEADER */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#002046] text-white">
            <Bot size={26} aria-hidden="true" />
          </div>

          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-extrabold text-slate-800">
              SHELF Virtual Assistant
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              FAQ and Library Support
            </p>
          </div>

          <div className="flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-700">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            Assistant
          </div>
        </div>

        <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-slate-500">
          <CircleHelp
            size={15}
            className="mt-0.5 shrink-0"
            aria-hidden="true"
          />
          Ask questions about SHELF ILMS and library services. The assistant
          will decline unrelated questions and may not know information that
          is not available in the FAQ.
        </p>
      </section>

      {/* CHAT WINDOW */}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div
          className="h-[420px] space-y-5 overflow-y-auto bg-slate-50 p-4 sm:h-[480px] sm:p-6"
          role="log"
          aria-label="Chat conversation"
          aria-live="polite"
        >
          {messages.map((message, index) => {
            const isUser = message.role === 'user';

            return (
              <div
                key={`${index}-${message.role}`}
                className={`flex items-start gap-2.5 ${
                  isUser ? 'justify-end' : 'justify-start'
                }`}
              >
                {!isUser && (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#002046] text-white">
                    <Bot size={17} aria-hidden="true" />
                  </div>
                )}

                <div
                  className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm leading-relaxed sm:max-w-[75%] ${
                    isUser
                      ? 'rounded-tr-sm bg-[#002046] text-white'
                      : 'rounded-tl-sm border border-slate-200 bg-white text-slate-700 shadow-sm'
                  }`}
                >
                  {message.text}
                </div>

                {isUser && (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-800">
                    <UserRound size={17} aria-hidden="true" />
                  </div>
                )}
              </div>
            );
          })}

          {asking && (
            <div className="flex items-start gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#002046] text-white">
                <Bot size={17} aria-hidden="true" />
              </div>

              <div
                className="flex items-center gap-2 rounded-2xl rounded-tl-sm border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500"
                role="status"
              >
                <LoaderCircle size={16} className="animate-spin" />
                Finding an answer...
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* MESSAGE INPUT */}
        <form
          onSubmit={handleSubmit}
          className="flex items-end gap-2 border-t border-slate-200 bg-white p-3 sm:p-4"
        >
          <label htmlFor="shelf-chat-input" className="sr-only">
            Ask a question about SHELF
          </label>

          <textarea
            id="shelf-chat-input"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                handleSubmit(event);
              }
            }}
            maxLength={500}
            rows={1}
            placeholder="Type your question..."
            disabled={asking}
            className="max-h-28 min-h-11 flex-1 resize-y rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-[#002046] focus:ring-2 focus:ring-[#002046]/10 disabled:bg-slate-100"
          />

          <button
            type="submit"
            disabled={asking || !question.trim()}
            className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#002046] px-4 text-sm font-bold text-white transition hover:bg-[#003366] disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Send message"
          >
            <Send size={17} aria-hidden="true" />
            <span className="hidden sm:inline">Send</span>
          </button>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3">
          <p className="text-xs text-slate-400">
            Press Enter to send · Shift + Enter for a new line
          </p>

          <button
            type="button"
            onClick={resetChat}
            disabled={asking}
            className="text-xs font-semibold text-slate-500 transition hover:text-[#002046] disabled:opacity-50"
          >
            Clear conversation
          </button>
        </div>
      </section>

      {/* SUGGESTED QUESTIONS */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-bold text-slate-800">
          Suggested questions
        </h3>

        <p className="mt-1 text-xs text-slate-500">
          Select a question to start a conversation.
        </p>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {SUGGESTED_QUESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              disabled={asking}
              onClick={() => sendQuestion(suggestion)}
              className="rounded-xl border border-slate-200 px-4 py-3 text-left text-sm leading-relaxed text-slate-700 transition hover:border-[#002046] hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
