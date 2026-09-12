import { AuthForm } from '@/components/features/auth/AuthForm';

export const metadata = { title: 'Đăng nhập | Aurum' };

export default function LoginPage() {
  return <AuthForm mode="login" />;
}
