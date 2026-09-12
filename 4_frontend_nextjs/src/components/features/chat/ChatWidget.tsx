'use client';

import { useState, useRef, useEffect } from 'react';
import { Bot, X, Send, User, Sparkles } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

type Message = {
  id: string;
  sender: 'user' | 'bot';
  text: string;
};

export function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', sender: 'bot', text: 'Xin chào! Tôi là trợ lý ảo của Hotel AI. Tôi có thể giúp gì cho bạn hôm nay?' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { user } = useAuth();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isOpen]);

  const sendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = { id: Date.now().toString(), sender: 'user', text: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      // If user is authenticated, we send the auth token.
      // But for a generic widget, we can use a standard fetch API wrapper.
      // Assuming we have an API setup
      const res = await fetch('http://127.0.0.1:8080/api/v1/core/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Note: In a real app we'd attach the bearer token here if available.
        },
        body: JSON.stringify({ message: userMessage.text })
      });

      if (!res.ok) throw new Error('API Error');
      const data = await res.json();
      
      setMessages(prev => [...prev, { id: Date.now().toString(), sender: 'bot', text: data.response }]);
    } catch (err) {
      setMessages(prev => [...prev, { id: Date.now().toString(), sender: 'bot', text: 'Xin lỗi, đã có lỗi xảy ra hoặc tôi không thể kết nối tới máy chủ lúc này.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-transform hover:scale-105 z-50"
        style={{ background: 'var(--gold)', color: 'var(--bg)' }}
        aria-label="Open Chat"
      >
        <Sparkles className="w-6 h-6" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 w-80 md:w-96 rounded-lg shadow-2xl flex flex-col overflow-hidden z-50 transition-all duration-300" style={{ height: '500px', maxHeight: '80vh', border: '1px solid var(--border-gold)', background: 'var(--bg)' }}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--border-gold)', background: 'rgba(196,153,90,0.05)' }}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'var(--gold)', color: 'var(--bg)' }}>
            <Bot size={18} />
          </div>
          <div>
            <h3 className="font-display font-medium text-sm" style={{ color: 'var(--fg)' }}>Hotel AI Concierge</h3>
            <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--gold)' }}>Online</p>
          </div>
        </div>
        <button onClick={() => setIsOpen(false)} className="text-[var(--muted)] hover:text-[var(--gold)] transition-colors">
          <X size={20} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4" style={{ background: 'var(--bg2)' }}>
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-lg p-3 text-sm ${msg.sender === 'user' ? 'rounded-tr-none' : 'rounded-tl-none'}`}
                 style={msg.sender === 'user' ? { background: 'var(--gold)', color: 'var(--bg)' } : { background: 'var(--bg)', color: 'var(--fg)', border: '1px solid var(--border)' }}>
              {msg.text}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-lg rounded-tl-none p-3 text-sm flex gap-1" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
              <span className="w-2 h-2 rounded-full bg-[var(--gold)] animate-bounce" />
              <span className="w-2 h-2 rounded-full bg-[var(--gold)] animate-bounce" style={{ animationDelay: '0.2s' }} />
              <span className="w-2 h-2 rounded-full bg-[var(--gold)] animate-bounce" style={{ animationDelay: '0.4s' }} />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={sendMessage} className="p-3 border-t flex items-center gap-2" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Nhập tin nhắn..."
          className="flex-1 bg-transparent text-sm outline-none px-2"
          style={{ color: 'var(--fg)' }}
        />
        <button 
          type="submit" 
          disabled={!input.trim() || isLoading}
          className="p-2 rounded hover:bg-[rgba(196,153,90,0.1)] transition-colors disabled:opacity-50"
          style={{ color: 'var(--gold)' }}
        >
          <Send size={18} />
        </button>
      </form>
    </div>
  );
}
