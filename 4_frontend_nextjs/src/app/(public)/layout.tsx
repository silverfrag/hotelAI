import PublicShell from '@/components/features/figma/PublicShell';
import '../styles.css';
import '@/styles/figma.css';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <PublicShell>{children}</PublicShell>;
}
