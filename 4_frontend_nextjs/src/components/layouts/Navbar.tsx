'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';

export function Navbar() {
  const router = useRouter();
  const { user, ready, logout } = useAuth();

  function signOut() {
    logout();
    router.push('/');
    router.refresh();
  }

  return (
    <nav className="navbar" aria-label="Điều hướng chính">
      <div className="navbar-inner">
        <Link className="brand" href="/">Hotel AI</Link>
        <div className="nav-links">
          <Link href="/">Đặt phòng</Link>
          {ready && user ? (
            <>
              <Link href="/bookings">Booking của tôi</Link>
              <span className="user-greeting">Xin chào, {user.full_name}</span>
              <button className="nav-button" onClick={signOut} type="button">Đăng xuất</button>
            </>
          ) : ready ? (
            <>
              <Link href="/login">Đăng nhập</Link>
              <Link className="nav-register" href="/register">Đăng ký</Link>
            </>
          ) : null}
        </div>
      </div>
    </nav>
  );
}
