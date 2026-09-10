'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertCircle, Hotel, LoaderCircle, LogOut, ShieldX } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { Button } from '@/components/ui/Button';
import { cn } from '@/components/ui/utils';
import { useAuth } from '@/hooks/useAuth';
import { ADMIN_ACCESS_DENIED_EVENT, AdminApiError, getCurrentUser } from '@/services/admin.service';
import type { User } from '@/types/user.type';

export function AdminShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname() ?? '/admin';
  const router = useRouter();
  const { ready, session, logout, loggingOut, logoutError, invalidateSession } = useAuth();
  const [verifiedSession, setVerifiedSession] = useState<{ token: string; user: User } | null>(null);
  const [verificationError, setVerificationError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [verificationAttempt, setVerificationAttempt] = useState(0);

  useEffect(() => {
    if (!ready || session) return;
    router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [pathname, ready, router, session]);

  useEffect(() => {
    const recheckAccess = () => setVerificationAttempt((value) => value + 1);
    window.addEventListener(ADMIN_ACCESS_DENIED_EVENT, recheckAccess);
    return () => window.removeEventListener(ADMIN_ACCESS_DENIED_EVENT, recheckAccess);
  }, []);

  useEffect(() => {
    if (!ready || !session) return;
    let active = true;
    setVerifiedSession(null);
    setVerificationError('');
    setForbidden(false);
    void getCurrentUser(session.accessToken)
      .then((user) => {
        if (active) setVerifiedSession({ token: session.accessToken, user });
      })
      .catch((caught) => {
        if (!active) return;
        if (caught instanceof AdminApiError && caught.status === 401) {
          invalidateSession();
          router.replace(`/login?next=${encodeURIComponent(pathname)}`);
          return;
        }
        if (caught instanceof AdminApiError && caught.status === 403) {
          setForbidden(true);
          return;
        }
        setVerificationError(caught instanceof Error ? caught.message : 'Không thể xác minh quyền truy cập.');
      });
    return () => { active = false; };
  }, [invalidateSession, pathname, ready, router, session, verificationAttempt]);

  async function switchAccount() {
    try {
      await logout();
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    } catch {
      // The sign-out error leaves this action available to retry.
    }
  }

  const verifiedUser = verifiedSession && verifiedSession.token === session?.accessToken
    ? verifiedSession.user
    : null;

  if (!ready || !session || (!verifiedUser && !verificationError && !forbidden)) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="flex items-center gap-3 text-sm text-muted-foreground" role="status">
          <LoaderCircle className="size-5 animate-spin text-primary" />
          Đang kiểm tra quyền truy cập…
        </div>
      </main>
    );
  }

  if (verificationError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4">
        <section className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center shadow-sm">
          <AlertCircle className="mx-auto size-8 text-danger" />
          <h1 className="mt-4 text-lg font-semibold">Không thể xác minh quyền truy cập</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{verificationError}</p>
          <Button className="mt-5" onClick={() => setVerificationAttempt((value) => value + 1)}>
            Thử lại
          </Button>
        </section>
      </main>
    );
  }

  if (forbidden || verifiedUser?.role !== 'admin') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
        <section className="w-full max-w-lg rounded-xl border border-border bg-card p-6 text-center shadow-sm sm:p-8">
          <div className="mx-auto mb-5 flex size-12 items-center justify-center rounded-xl bg-danger-muted text-danger">
            <ShieldX className="size-6" />
          </div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">Hotel AI</p>
          <h1 className="text-xl font-semibold tracking-tight">Không có quyền truy cập</h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            Tài khoản <strong className="font-medium text-foreground">{verifiedUser?.email}</strong> không
            có vai trò quản trị viên. Hãy đăng nhập bằng tài khoản admin để mở Operations Console.
          </p>
          <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
            <Link
              href="/"
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              <Hotel className="size-4" />
              Về trang khách sạn
            </Link>
            <Button
              variant="primary"
              disabled={loggingOut}
              onClick={() => void switchAccount()}
            >
              <LogOut />
              {loggingOut ? 'Đang đăng xuất…' : 'Đăng nhập tài khoản khác'}
            </Button>
          </div>
          {logoutError && <p role="alert" className="mt-4 text-sm text-danger">{logoutError}</p>}
        </section>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((v) => !v)}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />

      <div
        className={cn(
          'flex min-h-screen flex-col transition-[padding] duration-200 ease-out',
          collapsed ? 'md:pl-[72px]' : 'md:pl-64',
        )}
      >
        <Header user={verifiedUser} onMobileOpen={() => setMobileOpen(true)} />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
