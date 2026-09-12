import type { Metadata } from 'next';
import { DM_Sans, Fraunces } from 'next/font/google';
import { AuthProvider } from '@/components/providers/AuthProvider';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { ChatWidget } from '@/components/features/chat/ChatWidget';
import './globals.css';

const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-dm-sans', display: 'swap' });
const fraunces = Fraunces({ subsets: ['latin'], variable: '--font-fraunces', display: 'swap' });

export const metadata: Metadata = {
  title: 'Hotel AI — Đặt phòng Nghỉ dưỡng Thượng lưu & Giá Thông minh',
  description: 'Hệ thống đặt phòng resort và khách sạn 5 sao với thuật toán định giá AI thời gian thực, minh bạch và an toàn.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi" data-scroll-behavior="smooth" suppressHydrationWarning className={`${dmSans.variable} ${fraunces.variable}`}>
      <body>
        <AuthProvider>
          <ThemeProvider>
            <LanguageProvider>
              {children}
              <ChatWidget />
            </LanguageProvider>
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
