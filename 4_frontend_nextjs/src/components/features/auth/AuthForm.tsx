'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Eye, EyeOff, LoaderCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { safeAuthDestination } from '@/utils/authDestination';
import styles from './AuthForm.module.css';

interface AuthFormProps {
  mode: 'login' | 'register';
}

function destinationAfterAuth(): string {
  if (typeof window === 'undefined') return '/';
  const next = new URLSearchParams(window.location.search).get('next');
  return safeAuthDestination(next, window.location.origin);
}

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const { isAuthenticated, ready, login, register } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [returnTo, setReturnTo] = useState('/');
  const isRegister = mode === 'register';
  const switchHref = `${isRegister ? '/login' : '/register'}${returnTo === '/' ? '' : `?next=${encodeURIComponent(returnTo)}`}`;

  useEffect(() => {
    if (ready && isAuthenticated) router.replace(destinationAfterAuth());
  }, [isAuthenticated, ready, router]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setReturnTo(destinationAfterAuth());
    if (params.get('changed') === 'password') {
      setInfo('Mật khẩu đã được đổi. Vui lòng đăng nhập lại bằng mật khẩu mới.');
    } else if (params.get('account') === 'deactivated') {
      setInfo('Tài khoản đã được vô hiệu hóa và thông tin cá nhân đã được ẩn.');
    }
  }, []);

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
      router.replace(destinationAfterAuth());
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Đã có lỗi xảy ra.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page} lang="vi">
      <Link href="/" className={styles.backLink}><ArrowLeft size={14} aria-hidden="true" /> Về trang chủ</Link>
      <div className={styles.layout}>
        <aside className={styles.story} aria-label="Cảm hứng cho kỳ nghỉ">
          <img
            src="https://images.unsplash.com/photo-1590523277543-a94d2e4eb00b?w=1200&h=1500&fit=crop&auto=format"
            alt=""
            className={styles.storyImage}
          />
          <div className={styles.storyShade} />
          <div className={styles.storyTop}><span>AURUM</span><span>YOUR NEXT CHAPTER</span></div>
          <div className={styles.storyCopy}>
            <span className={styles.storyRule} />
            <p className={styles.storyTitle}>Những kỳ nghỉ<br /><em>đáng nhớ.</em></p>
            <p>Một nơi để lên kế hoạch cho hành trình mới và tìm lại những đặt phòng của bạn.</p>
          </div>
          <div className={styles.storyBottom}><span>THOUGHTFULLY CURATED</span><span>01 — YOUR JOURNEY</span></div>
        </aside>

        <section className={styles.panel} aria-labelledby="auth-title">
          <div className={styles.formWrap}>
            <header className={styles.heading}>
              <p className={styles.eyebrow}>Tài khoản Aurum</p>
              <h1 id="auth-title">{isRegister ? <>Hành trình mới<br /><em>bắt đầu từ đây.</em></> : <>Chào mừng<br /><em>bạn trở lại.</em></>}</h1>
              <p className={styles.intro}>{isRegister
                ? 'Tạo tài khoản để đặt phòng và lưu giữ thông tin những kỳ nghỉ sắp tới.'
                : 'Đăng nhập để tiếp tục đặt phòng và quản lý kỳ nghỉ của bạn.'}</p>
            </header>

            <form onSubmit={submit} className={styles.form} aria-label={isRegister ? 'Đăng ký tài khoản' : 'Đăng nhập'} aria-busy={loading}>
              <fieldset disabled={loading || !ready} className={styles.fields}>
                {isRegister && <div className={styles.field}>
                  <label htmlFor="auth-full-name">Họ và tên</label>
                  <input id="auth-full-name" name="full_name" type="text" autoComplete="name" minLength={2} maxLength={150} placeholder="Nguyễn Minh Anh" required />
                </div>}

                <div className={styles.field}>
                  <label htmlFor="auth-email">Địa chỉ email</label>
                  <input id="auth-email" name="email" type="email" autoComplete={isRegister ? 'email' : 'username'} placeholder="ban@example.com" required />
                </div>

                <div className={styles.field}>
                  <label htmlFor="auth-password">Mật khẩu</label>
                  <div className={styles.passwordField}>
                    <input id="auth-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete={isRegister ? 'new-password' : 'current-password'} minLength={8} placeholder={isRegister ? 'Ít nhất 8 ký tự' : 'Nhập mật khẩu của bạn'} required />
                    <button type="button" className={styles.reveal} onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'} aria-pressed={showPassword} aria-controls="auth-password">
                      {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                    </button>
                  </div>
                </div>

                {isRegister && <div className={styles.field}>
                  <label htmlFor="auth-password-confirmation">Nhập lại mật khẩu</label>
                  <input id="auth-password-confirmation" name="password_confirmation" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={8} placeholder="Xác nhận mật khẩu của bạn" required />
                </div>}

                {info && <p className={styles.notice} role="status">{info}</p>}
                {error && <p className={styles.error} role="alert">{error}</p>}
                <button className={styles.submit} disabled={loading || !ready} type="submit">
                  <span>{loading ? 'Đang xử lý…' : !ready ? 'Đang kiểm tra phiên…' : isRegister ? 'Tạo tài khoản' : 'Đăng nhập'}</span>
                  {loading ? <LoaderCircle size={17} className={styles.spinner} aria-hidden="true" /> : <ArrowRight size={17} aria-hidden="true" />}
                </button>
              </fieldset>
            </form>

            <p className={styles.switchMode}>{isRegister ? 'Bạn đã có tài khoản?' : 'Lần đầu đến với Aurum?'}{' '}
              <Link href={switchHref}>{isRegister ? 'Đăng nhập' : 'Tạo tài khoản'}</Link>
            </p>
            <div className={styles.formFooter}><span />Không gian riêng cho kỳ nghỉ của bạn<span /></div>
          </div>
        </section>
      </div>
    </main>
  );
}
