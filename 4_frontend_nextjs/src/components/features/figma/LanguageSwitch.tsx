'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Globe } from 'lucide-react';
import { useTranslation } from '@/contexts/LanguageContext';
import type { Language } from '@/locales/dictionary';

interface LanguageSwitchProps {
  compact?: boolean;
}

export function LanguageSwitch({ compact = false }: LanguageSwitchProps) {
  const { language, setLanguage, supportedLanguages, currentLanguageInfo } = useTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  function handleSelect(code: Language) {
    setLanguage(code);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Chọn ngôn ngữ / Select language"
        className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium tracking-wider uppercase transition-all duration-300 border"
        style={{
          borderColor: open ? 'var(--gold)' : 'var(--border-gold)',
          background: open ? 'rgba(196, 153, 90, 0.12)' : 'rgba(196, 153, 90, 0.05)',
          color: open ? 'var(--gold)' : 'var(--fg2)',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.borderColor = 'var(--gold)';
        }}
        onMouseLeave={(e) => {
          if (!open) (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-gold)';
        }}
      >
        <span className="text-sm leading-none" aria-hidden="true">{currentLanguageInfo.flag}</span>
        <span>{currentLanguageInfo.short}</span>
        <ChevronDown
          size={12}
          className="transition-transform duration-200"
          style={{
            transform: open ? 'rotate(180deg)' : 'none',
            color: 'var(--gold)',
          }}
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Danh sách ngôn ngữ"
          className="absolute right-0 top-full mt-2 z-[70] w-44 py-1.5 shadow-2xl backdrop-blur-2xl border transition-all duration-200"
          style={{
            background: 'var(--bg2)',
            borderColor: 'var(--border-gold)',
          }}
        >
          <div className="px-3 py-1.5 border-b mb-1 text-[9px] uppercase tracking-[0.2em] font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--gold)' }}>
            Ngôn ngữ / Language
          </div>
          {supportedLanguages.map((lang) => {
            const isSelected = lang.code === language;
            return (
              <button
                key={lang.code}
                role="option"
                aria-selected={isSelected}
                onClick={() => handleSelect(lang.code)}
                type="button"
                className="w-full text-left px-3.5 py-2 flex items-center justify-between text-xs transition-colors duration-150"
                style={{
                  background: isSelected ? 'rgba(196, 153, 90, 0.14)' : 'transparent',
                  color: isSelected ? 'var(--gold)' : 'var(--fg)',
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) {
                    (e.currentTarget as HTMLElement).style.background = 'var(--card-hover)';
                    (e.currentTarget as HTMLElement).style.color = 'var(--gold)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    (e.currentTarget as HTMLElement).style.background = 'transparent';
                    (e.currentTarget as HTMLElement).style.color = 'var(--fg)';
                  }
                }}
              >
                <span className="flex items-center gap-2">
                  <span className="text-sm leading-none">{lang.flag}</span>
                  <span className="font-medium">{lang.label}</span>
                </span>
                {isSelected && <Check size={14} style={{ color: 'var(--gold)' }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
