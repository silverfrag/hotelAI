import { AuthForm } from '@/components/features/auth/AuthForm';

export const metadata = { title: 'Đăng ký | Hotel AI' };

export default function RegisterPage() {
  return <AuthForm mode="register" />;
}
