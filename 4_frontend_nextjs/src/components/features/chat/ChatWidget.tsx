'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bot, X, Send, Sparkles, MessageSquare, Compass, Utensils, Award, RotateCcw, BookOpen, ArrowUpRight, Ticket } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { useTheme } from '@/contexts/ThemeContext';

type ChatCitation = {
  doc_id: string;
  category: string;
  title: string;
  snippet: string;
  score: number;
  suggested_route?: string | null;
};

type Message = {
  id: string;
  sender: 'user' | 'bot';
  text: string;
  timestamp: string;
  citations?: ChatCitation[];
  suggestedAction?: { label: string; href: string } | null;
  retriever?: string;
  liveToolsUsed?: string[];
};

const PROMPT_PILLS = [
  { icon: Ticket, labelVi: 'Suite & ưu đãi', labelEn: 'Suite & Coupon', promptVi: 'Suite ngày mai 2 đêm cho 2 khách mã SUITE20', promptEn: 'Suite tomorrow 2 nights for 2 guests code SUITE20' },
  { icon: Compass, labelVi: 'Giá các hạng phòng', labelEn: 'Rooms & Rates', promptVi: 'Cho tôi biết thông tin và giá các hạng phòng', promptEn: 'Show me room types and their rates' },
  { icon: Utensils, labelVi: 'Spa & tiện ích', labelEn: 'Spa & Facilities', promptVi: 'Spa và hồ bơi ở tầng mấy?', promptEn: 'Where are the spa and swimming pool?' },
  { icon: Award, labelVi: 'Hồ sơ hội viên', labelEn: 'Guest profile', promptVi: 'Tôi xem hồ sơ hội viên và điểm tích lũy ở đâu?', promptEn: 'Where can I view my guest profile and loyalty points?' },
  { icon: MessageSquare, labelVi: 'Đặt phòng của tôi', labelEn: 'My bookings', promptVi: 'Tôi xem và hủy đặt phòng ở đâu?', promptEn: 'Where can I view or cancel my bookings?' },
];

export function ChatWidget() {
  const pathname = usePathname();
  if (pathname?.startsWith('/admin')) return null;
  return <PublicChatWidget />;
}

function PublicChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const { lang } = useTranslation();
  const { user } = useAuth();
  const { theme } = useTheme();
  const isDark = theme !== 'light';

  const welcomeText = lang === 'vi'
    ? `Xin chào${user?.full_name ? ' ' + user.full_name : ''}! Tôi là Trợ lý White Sand. Tôi có thể tra cứu danh mục 6 hạng phòng tại 89-91 Võ Văn Kiệt, Đà Nẵng và hướng dẫn xem booking hoặc hồ sơ. Dịch vụ và chính sách cần được lễ tân xác nhận; hộp trò chuyện không đặt phòng hay gửi yêu cầu dịch vụ.`
    : `Hello${user?.full_name ? ' ' + user.full_name : ''}! I am the White Sand assistant. I can look up our 6 room categories at 89-91 Vo Van Kiet, Da Nang and help you find bookings or your profile. Please confirm services and policies with the front desk; this chat does not make reservations or submit service requests.`;

  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      sender: 'bot',
      text: welcomeText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages((current) => current.map((message) => message.id.startsWith('welcome') ? { ...message, text: welcomeText } : message));
  }, [welcomeText]);

  useEffect(() => {
    const openChat = (event: Event) => {
      const prompt = (event as CustomEvent<{ prompt?: string }>).detail?.prompt;
      setIsOpen(true);
      if (typeof prompt === 'string') setInput(prompt);
    };
    window.addEventListener('hotelai:open-chat', openChat);
    return () => window.removeEventListener('hotelai:open-chat', openChat);
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isOpen]);

  const handleResetChat = () => {
    setMessages([
      {
        id: 'welcome-' + Date.now(),
        sender: 'bot',
        text: welcomeText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }
    ]);
    setInput('');
  };

  const handleSendPrompt = (promptText: string) => {
    void executeSend(promptText);
  };

  const executeSend = async (messageText: string) => {
    const trimmed = messageText.trim();
    if (!trimmed || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      sender: 'user',
      text: trimmed,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/v1/core/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ message: userMessage.text, language: lang === 'vi' ? 'vi' : 'en' }),
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) throw new Error('API Error');
      const data = await res.json();
      if (data?.status !== 'success' || typeof data.response !== 'string' || !data.response.trim()) throw new Error('Invalid assistant response');
      if (typeof data.response !== 'string' || !data.response.trim()) throw new Error('Invalid chat response');

      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          sender: 'bot',
          text: data.response,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          citations: Array.isArray(data.citations) ? data.citations : undefined,
          suggestedAction: data.suggested_action && typeof data.suggested_action?.href === 'string'
            ? data.suggested_action
            : null,
          retriever: typeof data.retriever === 'string' ? data.retriever : undefined,
          liveToolsUsed: Array.isArray(data.live_tools_used) ? data.live_tools_used : undefined,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          sender: 'bot',
          text: lang === 'vi'
            ? 'Rất tiếc, đã có sự cố kết nối tới tổng đài trợ lý ảo. Quý khách vui lòng thử lại sau giây lát.'
            : 'We apologize, our concierge service is momentarily indisposed. Please retry shortly.',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void executeSend(input);
  };

  // Draggable position state for floating bubble
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ pointerX: number; pointerY: number; posX: number; posY: number } | null>(null);
  const didDragRef = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const clampPos = (x: number, y: number, btnW = 50, btnH = 50) => {
    if (typeof window === 'undefined') return { x, y };
    const maxX = Math.max(10, window.innerWidth - btnW - 12);
    const maxY = Math.max(10, window.innerHeight - btnH - 12);
    return {
      x: Math.min(Math.max(10, x), maxX),
      y: Math.min(Math.max(10, y), maxY),
    };
  };

  useEffect(() => {
    try {
      const saved = localStorage.getItem('whitesand_chat_bubble_pos');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
          setPosition(clampPos(parsed.x, parsed.y));
          return;
        }
      }
    } catch {
      // Ignore storage read errors
    }
    // Default position: bottom-right
    if (typeof window !== 'undefined') {
      setPosition(clampPos(window.innerWidth - 66, window.innerHeight - 74));
    }
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setPosition((prev) => (prev ? clampPos(prev.x, prev.y) : null));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    // Only respond to primary button / touch
    if (e.button !== 0) return;
    const rect = buttonRef.current?.getBoundingClientRect();
    const currentX = position?.x ?? (rect ? rect.left : window.innerWidth - 66);
    const currentY = position?.y ?? (rect ? rect.top : window.innerHeight - 74);

    dragStartRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      posX: currentX,
      posY: currentY,
    };
    didDragRef.current = false;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (!dragStartRef.current) return;
      const dx = moveEvent.clientX - dragStartRef.current.pointerX;
      const dy = moveEvent.clientY - dragStartRef.current.pointerY;

      if (!didDragRef.current && Math.hypot(dx, dy) > 4) {
        didDragRef.current = true;
        setIsDragging(true);
      }

      if (didDragRef.current) {
        const nextX = dragStartRef.current.posX + dx;
        const nextY = dragStartRef.current.posY + dy;
        setPosition(clampPos(nextX, nextY));
      }
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);

      if (didDragRef.current) {
        setPosition((curr) => {
          if (curr) {
            try {
              localStorage.setItem('whitesand_chat_bubble_pos', JSON.stringify(curr));
            } catch {
              // Ignore storage write errors
            }
          }
          return curr;
        });
        setTimeout(() => {
          didDragRef.current = false;
          setIsDragging(false);
        }, 50);
      } else {
        setIsDragging(false);
      }
      dragStartRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  };

  const handleButtonClick = (e: React.MouseEvent) => {
    if (didDragRef.current) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    setIsOpen(true);
  };

  if (!isOpen) {
    const isPositioned = position !== null;
    return (
      <div
        className="fixed z-50 select-none group"
        style={{
          left: isPositioned ? `${position.x}px` : undefined,
          top: isPositioned ? `${position.y}px` : undefined,
          right: isPositioned ? undefined : '20px',
          bottom: isPositioned ? undefined : '24px',
          touchAction: 'none',
        }}
      >
        <button
          ref={buttonRef}
          type="button"
          onPointerDown={handlePointerDown}
          onClick={handleButtonClick}
          className={`relative flex items-center justify-center w-12 h-12 rounded-full shadow-2xl transition-transform duration-200 border cursor-grab active:cursor-grabbing hover:scale-105 ${
            isDragging ? 'scale-110 shadow-3xl opacity-95' : ''
          }`}
          style={{
            background: 'linear-gradient(135deg, #c4995a 0%, #9e7838 100%)',
            borderColor: 'rgba(255, 255, 255, 0.35)',
            color: '#080808',
            boxShadow: isDragging
              ? '0 16px 36px rgba(196,153,90,0.6), 0 0 0 2px rgba(255,255,255,0.4)'
              : '0 8px 24px rgba(196,153,90,0.45), 0 0 0 1px rgba(196,153,90,0.3)',
          }}
          aria-label={lang === 'vi' ? 'Trợ lý White Sand (kéo để di chuyển)' : 'White Sand assistant (drag to move)'}
          title={lang === 'vi' ? 'Trợ lý White Sand • Kéo để đổi vị trí' : 'White Sand assistant • Drag to reposition'}
        >
          {/* Pulsing online status indicator */}
          <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5 pointer-events-none">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-80" />
            <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500 border-2 border-[var(--bg2,#0f0b07)] shadow-sm" />
          </span>

          <Sparkles className="w-5 h-5 text-[#080808]" />

          {/* Compact drag hint / tooltip on hover */}
          <span
            className="pointer-events-none absolute right-full mr-2.5 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded-full text-[10px] tracking-wider uppercase font-semibold whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-200 shadow-lg border hidden md:inline-block"
            style={{
              background: isDark ? 'rgba(18, 14, 8, 0.94)' : 'rgba(252, 248, 240, 0.96)',
              color: isDark ? '#c4995a' : '#8a5e1e',
              borderColor: isDark ? 'rgba(196, 153, 90, 0.3)' : 'rgba(140, 100, 50, 0.25)',
              backdropFilter: 'blur(8px)',
            }}
          >
            {lang === 'vi' ? 'Trợ lý White Sand • Kéo để di chuyển' : 'White Sand assistant • Drag to move'}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div
      className="fixed bottom-6 right-6 w-[92vw] sm:w-[420px] rounded-3xl shadow-2xl flex flex-col overflow-hidden z-50 transition-all duration-300 animate-in fade-in slide-in-from-bottom-5 border"
      style={{
        height: '580px',
        maxHeight: '84vh',
        borderColor: isDark ? 'rgba(196, 153, 90, 0.35)' : 'rgba(140, 100, 50, 0.35)',
        background: isDark
          ? 'linear-gradient(180deg, rgba(18, 14, 8, 0.94) 0%, rgba(12, 9, 5, 0.96) 100%)'
          : 'linear-gradient(180deg, rgba(252, 248, 240, 0.95) 0%, rgba(245, 237, 224, 0.97) 100%)',
        backdropFilter: 'blur(28px) saturate(190%)',
        WebkitBackdropFilter: 'blur(28px) saturate(190%)',
        boxShadow: isDark
          ? '0 25px 60px -12px rgba(0,0,0,0.85), 0 0 0 1px rgba(196,153,90,0.25), inset 0 1px 1px rgba(255,255,255,0.1)'
          : '0 25px 60px -12px rgba(0,0,0,0.18), 0 0 0 1px rgba(140,100,50,0.22), inset 0 1px 1px rgba(255,255,255,0.8)',
      }}
    >
      {/* ── HEADER ── */}
      <div
        className="flex items-center justify-between p-4 border-b shrink-0"
        style={{
          borderColor: isDark ? 'rgba(196, 153, 90, 0.22)' : 'rgba(140, 100, 50, 0.2)',
          background: isDark
            ? 'linear-gradient(180deg, rgba(196, 153, 90, 0.16) 0%, rgba(196, 153, 90, 0.03) 100%), rgba(18, 14, 8, 0.85)'
            : 'linear-gradient(180deg, rgba(140, 100, 50, 0.12) 0%, rgba(140, 100, 50, 0.02) 100%), rgba(250, 245, 237, 0.9)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center relative shadow-md shrink-0"
            style={{
              background: 'linear-gradient(135deg, #c4995a 0%, #9e7838 100%)',
              color: '#0a0805',
              boxShadow: '0 4px 14px rgba(196, 153, 90, 0.4)',
            }}
          >
            <Bot size={20} />
            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-[var(--bg)] shadow-sm" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3
                className="font-display font-medium text-sm tracking-wide"
                style={{ color: isDark ? '#f0e8db' : '#1a1008' }}
              >
                {lang === 'vi' ? 'Trợ lý White Sand' : 'White Sand assistant'}
              </h3>
              <span
                className="text-[9px] px-2 py-0.5 rounded-full font-mono uppercase tracking-wider font-semibold"
                style={{
                  background: isDark ? 'rgba(196, 153, 90, 0.2)' : 'rgba(140, 100, 50, 0.15)',
                  color: isDark ? '#c4995a' : '#8a5e1e',
                  border: `1px solid ${isDark ? 'rgba(196, 153, 90, 0.3)' : 'rgba(140, 100, 50, 0.25)'}`,
                }}
              >
                {lang === 'vi' ? 'Thông tin' : 'Information'}
              </span>
            </div>
            <p
              className="text-[10px] tracking-wider uppercase mt-0.5 font-medium"
              style={{ color: isDark ? '#9a8060' : '#7a6245' }}
            >
              {lang === 'vi' ? 'Danh mục phòng & hướng dẫn' : 'Room catalog & guidance'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={isLoading}
            onClick={handleResetChat}
            title={lang === 'vi' ? 'Bắt đầu cuộc trò chuyện mới' : 'Reset conversation'}
            className="w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200"
            style={{
              color: isDark ? '#9a8060' : '#7a6245',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#c4995a';
              e.currentTarget.style.background = 'rgba(196,153,90,0.12)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = isDark ? '#9a8060' : '#7a6245';
              e.currentTarget.style.background = 'transparent';
            }}
            aria-label="Reset Chat"
          >
            <RotateCcw size={15} />
          </button>
          <button
            onClick={() => setIsOpen(false)}
            title={lang === 'vi' ? 'Thu nhỏ' : 'Minimize'}
            className="w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200"
            style={{
              color: isDark ? '#9a8060' : '#7a6245',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#c4995a';
              e.currentTarget.style.background = 'rgba(196,153,90,0.12)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = isDark ? '#9a8060' : '#7a6245';
              e.currentTarget.style.background = 'transparent';
            }}
            aria-label="Close Chat"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* ── MESSAGES CONTAINER ── */}
      <div
        className="flex-1 overflow-y-auto p-4 space-y-4 text-xs leading-relaxed"
        style={{
          background: isDark
            ? 'radial-gradient(ellipse at top right, rgba(196, 153, 90, 0.05), transparent 70%), rgba(14, 10, 6, 0.88)'
            : 'radial-gradient(ellipse at top right, rgba(140, 100, 50, 0.04), transparent 70%), rgba(246, 239, 228, 0.9)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
        }}
      >
        {messages.map((msg) => (
          <div key={msg.id} className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 shadow-sm whitespace-pre-line ${
                msg.sender === 'user'
                  ? 'rounded-tr-none font-medium'
                  : 'rounded-tl-none border'
              }`}
              style={
                msg.sender === 'user'
                  ? {
                      background: 'linear-gradient(135deg, #c4995a 0%, #a87938 100%)',
                      color: '#080808',
                      boxShadow: '0 4px 14px rgba(196, 153, 90, 0.35)',
                    }
                  : {
                      background: isDark ? 'rgba(28, 22, 15, 0.95)' : 'rgba(255, 255, 255, 0.96)',
                      color: isDark ? '#f0e8db' : '#1a1008',
                      borderColor: isDark ? 'rgba(196, 153, 90, 0.24)' : 'rgba(140, 100, 50, 0.2)',
                      boxShadow: isDark ? '0 3px 12px rgba(0, 0, 0, 0.3)' : '0 3px 12px rgba(0, 0, 0, 0.06)',
                    }
              }
            >
              <div>{msg.text}</div>

              {msg.sender === 'bot' && msg.citations && msg.citations.length > 0 && (
                <div
                  className="mt-2.5 pt-2 border-t flex flex-wrap gap-1.5"
                  style={{ borderColor: isDark ? 'rgba(196, 153, 90, 0.16)' : 'rgba(140, 100, 50, 0.14)' }}
                >
                  {msg.citations.slice(0, 2).map((cit) => (
                    <span
                      key={cit.doc_id}
                      data-testid="chat-citation-chip"
                      title={cit.snippet}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-mono border"
                      style={{
                        background: isDark ? 'rgba(196, 153, 90, 0.08)' : 'rgba(140, 100, 50, 0.08)',
                        borderColor: isDark ? 'rgba(196, 153, 90, 0.25)' : 'rgba(140, 100, 50, 0.22)',
                        color: isDark ? '#d9b882' : '#7b531b',
                      }}
                    >
                      <BookOpen size={9} />
                      <span>{cit.doc_id}</span>
                      <span className="opacity-70">· {Math.round(cit.score * 100)}%</span>
                    </span>
                  ))}
                  {msg.liveToolsUsed && msg.liveToolsUsed.length > 0 && (
                    <span
                      className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-mono border"
                      style={{
                        background: isDark ? 'rgba(16, 185, 129, 0.12)' : 'rgba(16, 185, 129, 0.1)',
                        borderColor: 'rgba(16, 185, 129, 0.35)',
                        color: isDark ? '#6ee7b7' : '#047857',
                      }}
                    >
                      LIVE DB
                    </span>
                  )}
                </div>
              )}

              {msg.sender === 'bot' && msg.suggestedAction && (
                <div className="mt-2.5">
                  <Link
                    href={msg.suggestedAction.href}
                    data-testid="chat-suggested-action"
                    onClick={() => setIsOpen(false)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-semibold transition-transform hover:scale-[1.02] active:scale-[0.98]"
                    style={{
                      background: 'linear-gradient(135deg, #c4995a 0%, #9e7838 100%)',
                      color: '#080808',
                    }}
                  >
                    <span>{msg.suggestedAction.label}</span>
                    <ArrowUpRight size={13} />
                  </Link>
                </div>
              )}
            </div>
            <span
              className="text-[9px] mt-1 px-1 font-mono"
              style={{ color: isDark ? '#9a8060' : '#7a6245' }}
            >
              {msg.timestamp}
            </span>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div
              className="max-w-[80%] rounded-2xl rounded-tl-none p-3.5 flex items-center gap-2 border shadow-sm"
              style={{
                background: isDark ? 'rgba(28, 22, 15, 0.95)' : 'rgba(255, 255, 255, 0.96)',
                borderColor: isDark ? 'rgba(196, 153, 90, 0.24)' : 'rgba(140, 100, 50, 0.2)',
              }}
            >
              <Sparkles className="w-3.5 h-3.5 animate-spin" style={{ color: '#c4995a' }} />
              <span className="text-xs italic" style={{ color: isDark ? '#b9a68d' : '#6a5238' }}>
                {lang === 'vi' ? 'Đang lấy thông tin...' : 'Loading information...'}
              </span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* ── QUICK PROMPT PILLS ── */}
      {messages.length <= 3 && !isLoading && (
        <div
          className="p-2.5 border-t border-b flex gap-2 overflow-x-auto no-scrollbar shrink-0"
          style={{
            borderColor: isDark ? 'rgba(196, 153, 90, 0.18)' : 'rgba(140, 100, 50, 0.16)',
            background: isDark ? 'rgba(18, 14, 8, 0.94)' : 'rgba(242, 234, 222, 0.95)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
          }}
        >
          {PROMPT_PILLS.map((pill, idx) => {
            const Icon = pill.icon;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => handleSendPrompt(lang === 'vi' ? pill.promptVi : pill.promptEn)}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] border transition-all duration-200 hover:scale-105 active:scale-95"
                style={{
                  borderColor: isDark ? 'rgba(196, 153, 90, 0.32)' : 'rgba(140, 100, 50, 0.3)',
                  background: isDark ? 'rgba(196, 153, 90, 0.1)' : 'rgba(140, 100, 50, 0.12)',
                  color: isDark ? '#c4995a' : '#8a5e1e',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
                }}
              >
                <Icon size={12} />
                <span className="font-medium">{lang === 'vi' ? pill.labelVi : pill.labelEn}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── INPUT FORM ── */}
      <form
        onSubmit={handleSubmit}
        className="p-3 border-t flex items-center gap-2 shrink-0"
        style={{
          borderColor: isDark ? 'rgba(196, 153, 90, 0.22)' : 'rgba(140, 100, 50, 0.18)',
          background: isDark ? 'rgba(14, 10, 6, 0.96)' : 'rgba(250, 245, 237, 0.97)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
        }}
      >
        <input
          type="text"
          aria-label={lang === 'vi' ? 'Tin nhắn' : 'Message'}
          maxLength={2000}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={lang === 'vi' ? 'Hỏi về phòng, nhà hàng, spa, giờ nhận phòng...' : 'Ask about suites, dining, spa, check-in...'}
          className="flex-1 text-xs outline-none px-3.5 py-2.5 rounded-xl transition-all"
          style={{
            background: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)',
            border: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.1)'}`,
            color: isDark ? '#f0e8db' : '#1a1008',
          }}
        />
        <button
          type="submit"
          disabled={!input.trim() || isLoading}
          className="w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200 disabled:opacity-40 hover:scale-105 active:scale-95 shrink-0"
          style={{
            background: 'linear-gradient(135deg, #c4995a 0%, #9e7838 100%)',
            color: '#080808',
            boxShadow: '0 4px 14px rgba(196, 153, 90, 0.35)',
          }}
          aria-label="Send message"
        >
          <Send size={15} />
        </button>
      </form>
    </div>
  );
}
