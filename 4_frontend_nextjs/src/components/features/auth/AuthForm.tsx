'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';

interface AuthFormProps {
  mode: 'login' | 'register';
}

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const { isAuthenticated, ready, login, register } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const isRegister = mode === 'register';

  useEffect(() => {
    if (ready && isAuthenticated) router.replace('/');
  }, [isAuthenticated, ready, router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    const values = new FormData(event.currentTarget);
    const email = String(values.get('email') ?? '').trim();
    const password = String(values.get('password') ?? '');

    try {
      if (isRegister) {
        const fullName = String(values.get('full_name') ?? '').trim();
        const passwordConfirmation = String(values.get('password_confirmation') ?? '');
        if (password !== passwordConfirmation) {
          throw new Error('Mật khẩu xác nhận không khớp.');
        }
        await register({ full_name: fullName, email, password });
      } else {
        await login({ email, password });
      }
      router.replace('/');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Đã có lỗi xảy ra.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <div>
          <p className="eyebrow">Hotel AI</p>
          <h1>{isRegister ? 'Tạo tài khoản' : 'Đăng nhập'}</h1>
          <p className="subtitle">
            {isRegister
              ? 'Đăng ký để đặt phòng với mức giá được tính theo thời điểm.'
              : 'Đăng nhập để tiếp tục đặt phòng.'}
          </p>
        </div>

        {isRegister && (
          <label>
            Họ và tên
            <input
              name="full_name"
              type="text"
              autoComplete="name"
              minLength={2}
              required
            />
          </label>
        )}

        <label>
          Email
          <input name="email" type="email" autoComplete="email" required />
        </label>

        <label>
          Mật khẩu
          <input
            name="password"
            type="password"
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            minLength={8}
            required
          />
        </label>

        {isRegister && (
          <label>
            Nhập lại mật khẩu
            <input
              name="password_confirmation"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
        )}

        {error && <p className="error" role="alert">{error}</p>}
        <button disabled={loading || !ready} type="submit">
          {loading ? 'Đang xử lý...' : isRegister ? 'Đăng ký' : 'Đăng nhập'}
        </button>

        <p className="auth-switch">
          {isRegister ? 'Đã có tài khoản?' : 'Chưa có tài khoản?'}{' '}
          <Link href={isRegister ? '/login' : '/register'}>
            {isRegister ? 'Đăng nhập' : 'Đăng ký ngay'}
          </Link>
        </p>
      </form>
    </main>
  );
}
