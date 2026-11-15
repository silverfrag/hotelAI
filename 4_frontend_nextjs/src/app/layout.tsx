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
  metadataBase: new URL(process.env.FRONTEND_ORIGIN || 'https://whitesandhotel.vn'),
  openGraph: {
    title: 'White Sand Boutique Hotel | Đặt phòng & Định giá thông minh',
    description: 'Trải nghiệm đặt phòng trực tuyến và định giá linh hoạt tại White Sand Boutique Hotel Đà Nẵng (89-91 Võ Văn Kiệt, Sơn Trà).',
    url: '/',
    siteName: 'White Sand Boutique Hotel Đà Nẵng',
    images: [
      {
        url: '/images/whitesand/hero/hotel-exterior.jpg',
        width: 1200,
        height: 630,
        alt: 'Khách sạn White Sand Boutique Hotel Đà Nẵng',
      },
    ],
    locale: 'vi_VN',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'White Sand Boutique Hotel | Đặt phòng & Định giá thông minh',
    description: 'Trải nghiệm đặt phòng trực tuyến và định giá linh hoạt tại White Sand Boutique Hotel Đà Nẵng.',
    images: ['/images/whitesand/hero/hotel-exterior.jpg'],
  },
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
