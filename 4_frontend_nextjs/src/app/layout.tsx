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
  title: 'White Sand Boutique Hotel | Đặt phòng & Định giá thông minh',
  description: 'Hệ thống mô phỏng đặt phòng và định giá thông minh tại White Sand Boutique Hotel Đà Nẵng (89-91 Võ Văn Kiệt, Sơn Trà) với 6 hạng phòng và 54 phòng.',
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
