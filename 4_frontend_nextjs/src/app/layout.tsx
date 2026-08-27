import './styles.css';

export const metadata = { title: 'Hotel AI', description: 'Hotel booking with dynamic pricing' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="vi"><body>{children}</body></html>;
}
