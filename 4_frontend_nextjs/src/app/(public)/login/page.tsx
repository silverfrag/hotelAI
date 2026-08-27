import { AuthForm } from '@/components/features/auth/AuthForm';

export const metadata = { title: 'Đăng nhập | Hotel AI' };

export default function LoginPage() {
  return <AuthForm mode="login" />;
}
