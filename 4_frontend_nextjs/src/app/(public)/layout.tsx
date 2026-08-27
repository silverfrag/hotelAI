import { Navbar } from '@/components/layouts/Navbar';
import '../styles.css';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Navbar />
      {children}
    </>
  );
}
