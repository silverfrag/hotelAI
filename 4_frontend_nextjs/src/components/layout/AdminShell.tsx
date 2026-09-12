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
      <main className="flex min-h-screen items-center justify-center bg-[#090b11] px-4">
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/[0.08] bg-[#131823] p-8 text-center shadow-2xl" role="status">
          <div className="flex size-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 shadow-sm">
            <LoaderCircle className="size-6 animate-spin text-amber-400" />
          </div>
          <div>
            <p className="font-sans text-sm font-semibold tracking-wide text-slate-200 uppercase">HOTEL AI CONSOLE</p>
            <p className="mt-1 text-xs text-slate-400">Đang xác thực phiên quản trị bảo mật…</p>
          </div>
        </div>
      </main>
    );
  }

  if (verificationError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#090b11] px-4">
        <section className="w-full max-w-md rounded-2xl border border-rose-500/30 bg-[#131823] p-8 text-center shadow-2xl">
          <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <AlertCircle className="size-6" />
          </div>
          <h1 className="mt-4 text-lg font-semibold text-slate-100">Không thể xác minh quyền truy cập</h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">{verificationError}</p>
          <Button className="mt-6 w-full" onClick={() => setVerificationAttempt((value) => value + 1)}>
            Thử lại
          </Button>
        </section>
      </main>
    );
  }

  if (forbidden || verifiedUser?.role !== 'admin') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#090b11] px-4 py-12">
        <section className="w-full max-w-lg rounded-2xl border border-white/[0.08] bg-[#131823] p-8 text-center shadow-2xl sm:p-10">
          <div className="mx-auto mb-6 flex size-14 items-center justify-center rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400">
            <ShieldX className="size-7" />
          </div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-amber-400">CONSOLE ACCESS</p>
          <h1 className="text-2xl font-bold tracking-tight text-white">Không có quyền truy cập</h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-400">
            Tài khoản <strong className="font-semibold text-slate-200 underline decoration-amber-400/50">{verifiedUser?.email}</strong> không
            có vai trò quản trị viên. Hãy đăng nhập bằng tài khoản admin để mở Operations Console.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link
              href="/"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/10 bg-slate-800/80 px-5 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-700 hover:text-white"
            >
              <Hotel className="size-4 text-amber-400" />
              Về trang khách sạn
            </Link>
            <Button
              variant="primary"
              disabled={loggingOut}
              onClick={() => void switchAccount()}
              className="h-10 px-5"
            >
              <LogOut className="size-4" />
              {loggingOut ? 'Đang đăng xuất…' : 'Đăng nhập tài khoản khác'}
            </Button>
          </div>
          {logoutError && <p role="alert" className="mt-4 text-sm text-rose-400">{logoutError}</p>}
        </section>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-[#090b11] text-slate-100">
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((v) => !v)}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />

      <div
        className={cn(
          'flex min-h-screen flex-col transition-[padding] duration-200 ease-out',
          collapsed ? 'md:pl-[76px]' : 'md:pl-64',
        )}
      >
        <Header user={verifiedUser} onMobileOpen={() => setMobileOpen(true)} />
        <main className="flex-1 pb-12">{children}</main>
      </div>
    </div>
  );
}

