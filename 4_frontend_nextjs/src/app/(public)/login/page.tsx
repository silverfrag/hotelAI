import { AuthForm } from '@/components/features/auth/AuthForm';

export const metadata = { title: 'Đăng nhập | White Sand Boutique Hotel' };

export default function LoginPage() {
  return <AuthForm mode="login" />;
}
