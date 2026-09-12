'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  Save,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  AccountApiError,
  changeOwnPassword,
  deactivateOwnAccount,
  getOwnProfile,
  updateOwnProfile,
} from '@/services/user.service';
import type { UserProfile } from '@/types/user.type';

const DEACTIVATION_PHRASE = 'VÔ HIỆU HÓA';

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(date);
}

export function ProfileManager() {
  const router = useRouter();
  const { ready, user, refreshSession, invalidateSession } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileNotice, setProfileNotice] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [deactivating, setDeactivating] = useState(false);
  const [deactivationError, setDeactivationError] = useState('');

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      setProfile(await getOwnProfile());
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : 'Không thể tải hồ sơ.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      router.replace('/login?next=/profile');
      return;
    }
    void loadProfile();
  }, [loadProfile, ready, router, user]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) return;
    const values = new FormData(event.currentTarget);
    const fullName = String(values.get('full_name') ?? '').trim();
    const phone = String(values.get('phone') ?? '').trim();
    const nationality = String(values.get('nationality') ?? '').trim();
    if (!fullName) return setProfileError('Vui lòng nhập họ và tên.');

    setProfileSaving(true);
    setProfileError('');
    setProfileNotice('');
    try {
      const updated = await updateOwnProfile({
        full_name: fullName,
        phone: phone || null,
        nationality: nationality || null,
        expected_version: profile.version,
      });
      setProfile(updated);
      await refreshSession();
      setProfileNotice('Hồ sơ đã được cập nhật thành công.');
    } catch (caught) {
      setProfileError(caught instanceof Error ? caught.message : 'Không thể cập nhật hồ sơ.');
      if (caught instanceof AccountApiError && caught.status === 409) void loadProfile();
    } finally {
      setProfileSaving(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const currentPassword = String(values.get('current_password') ?? '');
    const newPassword = String(values.get('new_password') ?? '');
    const confirmation = String(values.get('password_confirmation') ?? '');
    if (newPassword !== confirmation) return setPasswordError('Mật khẩu xác nhận không khớp.');
    if (newPassword === currentPassword) return setPasswordError('Mật khẩu mới phải khác mật khẩu hiện tại.');

    setPasswordSaving(true);
    setPasswordError('');
    try {
      await changeOwnPassword({ current_password: currentPassword, new_password: newPassword });
      form.reset();
      invalidateSession();
      router.replace('/login?next=/profile&changed=password');
    } catch (caught) {
      setPasswordError(caught instanceof Error ? caught.message : 'Không thể đổi mật khẩu.');
    } finally {
      setPasswordSaving(false);
    }
  }

  async function deactivate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const phrase = String(values.get('confirmation') ?? '').trim();
    const password = String(values.get('password') ?? '');
    if (phrase !== DEACTIVATION_PHRASE) {
      return setDeactivationError(`Hãy nhập chính xác “${DEACTIVATION_PHRASE}” để xác nhận.`);
    }

    setDeactivating(true);
    setDeactivationError('');
    try {
      await deactivateOwnAccount(password);
      invalidateSession();
      router.replace('/login?account=deactivated');
    } catch (caught) {
      setDeactivationError(caught instanceof Error ? caught.message : 'Không thể vô hiệu hóa tài khoản.');
    } finally {
      setDeactivating(false);
    }
  }

  if (!ready || (user && loading)) {
    return (
      <main className="min-h-[80vh] flex flex-col items-center justify-center px-5 pt-32 pb-24" role="status">
        <div className="w-12 h-12 rounded-full border border-[var(--border-gold)] flex items-center justify-center mb-5">
          <LoaderCircle className="animate-spin" size={24} style={{ color: 'var(--gold)' }} />
        </div>
        <p className="text-sm tracking-wider uppercase text-[var(--muted)]">Đang tải hồ sơ của bạn…</p>
      </main>
    );
  }

  if (!user) return null;

  if (loadError || !profile) {
    return (
      <main className="min-h-[80vh] flex flex-col items-center justify-center px-5 pt-32 pb-24 text-center max-w-lg mx-auto">
        <div className="w-14 h-14 rounded-full border border-amber-500/30 bg-amber-500/10 flex items-center justify-center mb-5 text-amber-400">
          <AlertTriangle size={26} />
        </div>
        <h1 className="font-display text-3xl md:text-4xl text-[var(--fg)] mb-3">Không thể tải hồ sơ</h1>
        <p className="text-sm text-[var(--muted)] mb-8 leading-relaxed">
          {loadError || 'Máy chủ không trả về dữ liệu hợp lệ. Vui lòng kiểm tra lại kết nối.'}
        </p>
        <button
          type="button"
          onClick={() => void loadProfile()}
          className="px-8 py-3.5 text-[11px] tracking-[0.18em] uppercase font-semibold flex items-center gap-2 transition-colors duration-200"
          style={{ background: 'var(--gold)', color: 'var(--bg)' }}
        >
          <RefreshCw size={15} /> Thử lại
        </button>
      </main>
    );
  }

  return (
    <main className="min-h-[85vh] pt-32 pb-24 px-5 md:px-10 lg:px-16 max-w-6xl mx-auto" lang="vi">
      {/* ── HEADING ── */}
      <header className="mb-10">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-px w-8" style={{ background: 'var(--gold)' }} />
          <span className="text-[10px] tracking-[0.28em] uppercase font-medium" style={{ color: 'var(--gold)' }}>
            Tài khoản Aurum
          </span>
        </div>
        <h1 className="font-display text-4xl md:text-5xl leading-[1.05] text-[var(--fg)] mb-3">
          Hồ sơ của tôi
        </h1>
        <p className="text-sm max-w-xl leading-relaxed" style={{ color: 'var(--muted)' }}>
          Quản lý thông tin định danh cá nhân, bảo mật tài khoản và trạng thái thành viên.
        </p>
      </header>

      {/* ── SUMMARY STATS BAR ── */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10" aria-label="Tóm tắt tài khoản">
        <div
          className="p-5 backdrop-blur-xl border transition-all duration-300"
          style={{ background: 'var(--bg2)', borderColor: 'var(--border-gold)' }}
        >
          <span className="block text-[9px] tracking-[0.22em] uppercase font-semibold mb-1.5" style={{ color: 'var(--gold)' }}>
            Email đăng nhập
          </span>
          <strong className="block text-sm font-medium truncate" style={{ color: 'var(--fg)' }}>
            {profile.email}
          </strong>
        </div>

        <div
          className="p-5 backdrop-blur-xl border transition-all duration-300"
          style={{ background: 'var(--bg2)', borderColor: 'var(--border-gold)' }}
        >
          <span className="block text-[9px] tracking-[0.22em] uppercase font-semibold mb-1.5" style={{ color: 'var(--gold)' }}>
            Vai trò thành viên
          </span>
          <strong className="block text-sm font-medium" style={{ color: 'var(--fg)' }}>
            {profile.role === 'admin' ? 'Quản trị viên' : 'Khách hàng VIP'}
          </strong>
        </div>

        <div
          className="p-5 backdrop-blur-xl border transition-all duration-300"
          style={{ background: 'var(--bg2)', borderColor: 'var(--border-gold)' }}
        >
          <span className="block text-[9px] tracking-[0.22em] uppercase font-semibold mb-1.5" style={{ color: 'var(--gold)' }}>
            Trạng thái tài khoản
          </span>
          <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-400 mt-0.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="flex items-center gap-1"><ShieldCheck size={14} /> Đang hoạt động</span>
          </div>
        </div>

        <div
          className="p-5 backdrop-blur-xl border transition-all duration-300"
          style={{ background: 'var(--bg2)', borderColor: 'var(--border-gold)' }}
        >
          <span className="block text-[9px] tracking-[0.22em] uppercase font-semibold mb-1.5" style={{ color: 'var(--gold)' }}>
            Cập nhật gần nhất
          </span>
          <strong className="block text-xs font-medium" style={{ color: 'var(--fg)' }}>
            {formatDateTime(profile.updated_at)}
          </strong>
        </div>
      </section>

      {/* ── MAIN FORMS GRID ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-10">
        {/* Profile Details Card */}
        <section
          className="p-6 md:p-8 backdrop-blur-xl border flex flex-col justify-between"
          style={{ background: 'var(--bg2)', borderColor: 'var(--border-gold)' }}
        >
          <div>
            <div className="flex items-center gap-3.5 mb-6 pb-4" style={{ borderBottom: '1px solid var(--border)' }}>
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                style={{ border: '1px solid var(--gold)', color: 'var(--gold)' }}
              >
                <UserRound size={18} />
              </div>
              <div>
                <h2 className="font-display text-2xl text-[var(--fg)]">Thông tin cá nhân</h2>
                <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
                  Email đăng nhập được bảo mật và không thể thay đổi tại đây.
                </p>
              </div>
            </div>

            <form className="space-y-5" onSubmit={saveProfile} key={profile.version}>
              <div>
                <label className="block text-[10px] tracking-[0.16em] uppercase font-semibold mb-2" style={{ color: 'var(--fg2)' }}>
                  Họ và tên <span style={{ color: 'var(--gold)' }}>*</span>
                </label>
                <input
                  name="full_name"
                  defaultValue={profile.full_name}
                  maxLength={150}
                  required
                  autoComplete="name"
                  placeholder="Nhập họ và tên đầy đủ"
                  className="w-full bg-[var(--bg)] border text-sm px-4 py-3 outline-none transition-colors duration-200"
                  style={{
                    borderColor: 'var(--border-gold)',
                    color: 'var(--fg)',
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--gold)')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border-gold)')}
                />
              </div>

              <div>
                <label className="block text-[10px] tracking-[0.16em] uppercase font-semibold mb-2" style={{ color: 'var(--fg2)' }}>
                  Số điện thoại
                </label>
                <input
                  name="phone"
                  defaultValue={profile.phone ?? ''}
                  maxLength={20}
                  autoComplete="tel"
                  placeholder="+84 912 345 678"
                  className="w-full bg-[var(--bg)] border text-sm px-4 py-3 outline-none transition-colors duration-200"
                  style={{
                    borderColor: 'var(--border-gold)',
                    color: 'var(--fg)',
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--gold)')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border-gold)')}
                />
              </div>

              <div>
                <label className="block text-[10px] tracking-[0.16em] uppercase font-semibold mb-2" style={{ color: 'var(--fg2)' }}>
                  Quốc tịch
                </label>
                <input
                  name="nationality"
                  defaultValue={profile.nationality ?? ''}
                  maxLength={50}
                  autoComplete="country-name"
                  placeholder="Việt Nam"
                  className="w-full bg-[var(--bg)] border text-sm px-4 py-3 outline-none transition-colors duration-200"
                  style={{
                    borderColor: 'var(--border-gold)',
                    color: 'var(--fg)',
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--gold)')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border-gold)')}
                />
              </div>

              {profileError && (
                <div className="p-3.5 border border-rose-500/30 bg-rose-500/10 text-rose-300 text-xs flex items-center gap-2" role="alert">
                  <AlertTriangle size={15} className="shrink-0 text-rose-400" />
                  <span>{profileError}</span>
                </div>
              )}

              {profileNotice && (
                <div className="p-3.5 border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-xs flex items-center gap-2" role="status">
                  <CheckCircle2 size={15} className="shrink-0 text-emerald-400" />
                  <span>{profileNotice}</span>
                </div>
              )}

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={profileSaving}
                  className="w-full py-3.5 px-6 font-semibold text-[11px] tracking-[0.16em] uppercase flex items-center justify-center gap-2 transition-all duration-300"
                  style={{ background: 'var(--gold)', color: 'var(--bg)' }}
                  onMouseEnter={(e) => {
                    if (!profileSaving) (e.currentTarget as HTMLElement).style.background = 'var(--gold-hi)';
                  }}
                  onMouseLeave={(e) => {
                    if (!profileSaving) (e.currentTarget as HTMLElement).style.background = 'var(--gold)';
                  }}
                >
                  {profileSaving ? (
                    <>
                      <LoaderCircle className="animate-spin" size={16} /> Đang lưu thay đổi…
                    </>
                  ) : (
                    <>
                      <Save size={16} /> Lưu thay đổi
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </section>

        {/* Change Password Card */}
        <section
          className="p-6 md:p-8 backdrop-blur-xl border flex flex-col justify-between"
          style={{ background: 'var(--bg2)', borderColor: 'var(--border-gold)' }}
        >
          <div>
            <div className="flex items-center gap-3.5 mb-6 pb-4" style={{ borderBottom: '1px solid var(--border)' }}>
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                style={{ border: '1px solid var(--gold)', color: 'var(--gold)' }}
              >
                <KeyRound size={18} />
              </div>
              <div>
                <h2 className="font-display text-2xl text-[var(--fg)]">Đổi mật khẩu</h2>
                <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
                  Mọi phiên đăng nhập hiện tại sẽ tự động kết thúc sau khi đổi mật khẩu.
                </p>
              </div>
            </div>

            <form className="space-y-5" onSubmit={changePassword}>
              <div>
                <label className="block text-[10px] tracking-[0.16em] uppercase font-semibold mb-2" style={{ color: 'var(--fg2)' }}>
                  Mật khẩu hiện tại <span style={{ color: 'var(--gold)' }}>*</span>
                </label>
                <input
                  name="current_password"
                  type="password"
                  minLength={8}
                  maxLength={72}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="w-full bg-[var(--bg)] border text-sm px-4 py-3 outline-none transition-colors duration-200"
                  style={{
                    borderColor: 'var(--border-gold)',
                    color: 'var(--fg)',
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--gold)')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border-gold)')}
                />
              </div>

              <div>
                <label className="block text-[10px] tracking-[0.16em] uppercase font-semibold mb-2" style={{ color: 'var(--fg2)' }}>
                  Mật khẩu mới <span style={{ color: 'var(--gold)' }}>*</span>
                </label>
                <input
                  name="new_password"
                  type="password"
                  minLength={8}
                  maxLength={72}
                  required
                  autoComplete="new-password"
                  placeholder="Tối thiểu 8 ký tự"
                  className="w-full bg-[var(--bg)] border text-sm px-4 py-3 outline-none transition-colors duration-200"
                  style={{
                    borderColor: 'var(--border-gold)',
                    color: 'var(--fg)',
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--gold)')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border-gold)')}
                />
              </div>

              <div>
                <label className="block text-[10px] tracking-[0.16em] uppercase font-semibold mb-2" style={{ color: 'var(--fg2)' }}>
                  Nhập lại mật khẩu mới <span style={{ color: 'var(--gold)' }}>*</span>
                </label>
                <input
                  name="password_confirmation"
                  type="password"
                  minLength={8}
                  maxLength={72}
                  required
                  autoComplete="new-password"
                  placeholder="Xác nhận mật khẩu mới"
                  className="w-full bg-[var(--bg)] border text-sm px-4 py-3 outline-none transition-colors duration-200"
                  style={{
                    borderColor: 'var(--border-gold)',
                    color: 'var(--fg)',
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--gold)')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border-gold)')}
                />
              </div>

              {passwordError && (
                <div className="p-3.5 border border-rose-500/30 bg-rose-500/10 text-rose-300 text-xs flex items-center gap-2" role="alert">
                  <AlertTriangle size={15} className="shrink-0 text-rose-400" />
                  <span>{passwordError}</span>
                </div>
              )}

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={passwordSaving}
                  className="w-full py-3.5 px-6 font-semibold text-[11px] tracking-[0.16em] uppercase flex items-center justify-center gap-2 transition-all duration-300"
                  style={{
                    border: '1px solid var(--border-gold)',
                    color: 'var(--gold)',
                    background: 'transparent',
                  }}
                  onMouseEnter={(e) => {
                    if (!passwordSaving) {
                      (e.currentTarget as HTMLElement).style.borderColor = 'var(--gold)';
                      (e.currentTarget as HTMLElement).style.background = 'rgba(196,153,90,0.08)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!passwordSaving) {
                      (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-gold)';
                      (e.currentTarget as HTMLElement).style.background = 'transparent';
                    }
                  }}
                >
                  {passwordSaving ? (
                    <>
                      <LoaderCircle className="animate-spin" size={16} /> Đang cập nhật mật khẩu…
                    </>
                  ) : (
                    <>
                      <KeyRound size={16} /> Đổi mật khẩu
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </section>
      </div>

      {/* ── DANGER ZONE ── */}
      <section
        className="p-6 md:p-8 backdrop-blur-xl border transition-all duration-300"
        style={{
          background: 'rgba(25, 12, 12, 0.45)',
          borderColor: 'rgba(244, 63, 94, 0.25)',
        }}
      >
        <div className="flex items-start gap-4 mb-6 pb-4" style={{ borderBottom: '1px solid rgba(244, 63, 94, 0.15)' }}>
          <div className="w-10 h-10 rounded-full border border-rose-500/40 bg-rose-500/10 flex items-center justify-center shrink-0 text-rose-400 mt-0.5">
            <AlertTriangle size={18} />
          </div>
          <div>
            <h2 className="font-display text-2xl text-rose-300 mb-1">Vô hiệu hóa tài khoản</h2>
            <p className="text-xs text-rose-200/60 max-w-2xl leading-relaxed">
              Thao tác này ẩn vĩnh viễn dữ liệu định danh cá nhân của bạn và không thể hoàn tác. Mọi đặt phòng đã xác nhận phải được hoàn tất hoặc hủy trước khi vô hiệu hóa.
            </p>
          </div>
        </div>

        <form className="max-w-xl space-y-4" onSubmit={deactivate}>
          <div>
            <label className="block text-[10px] tracking-[0.16em] uppercase font-semibold mb-2 text-rose-300/80">
              Nhập chính xác cụm từ: <span className="text-rose-300 underline font-mono">{DEACTIVATION_PHRASE}</span>
            </label>
            <input
              name="confirmation"
              required
              autoComplete="off"
              placeholder={DEACTIVATION_PHRASE}
              className="w-full bg-[var(--bg)] border text-sm px-4 py-3 outline-none transition-colors duration-200"
              style={{
                borderColor: 'rgba(244, 63, 94, 0.3)',
                color: 'var(--fg)',
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(244, 63, 94, 0.8)')}
              onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(244, 63, 94, 0.3)')}
            />
          </div>

          <div>
            <label className="block text-[10px] tracking-[0.16em] uppercase font-semibold mb-2 text-rose-300/80">
              Mật khẩu tài khoản để xác nhận
            </label>
            <input
              name="password"
              type="password"
              minLength={8}
              maxLength={72}
              required
              autoComplete="current-password"
              placeholder="••••••••"
              className="w-full bg-[var(--bg)] border text-sm px-4 py-3 outline-none transition-colors duration-200"
              style={{
                borderColor: 'rgba(244, 63, 94, 0.3)',
                color: 'var(--fg)',
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(244, 63, 94, 0.8)')}
              onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(244, 63, 94, 0.3)')}
            />
          </div>

          {deactivationError && (
            <div className="p-3.5 border border-rose-500/40 bg-rose-500/20 text-rose-200 text-xs flex items-center gap-2" role="alert">
              <AlertTriangle size={15} className="shrink-0 text-rose-400" />
              <span>{deactivationError}</span>
            </div>
          )}

          <div className="pt-2">
            <button
              type="submit"
              disabled={deactivating}
              className="px-6 py-3 border border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 hover:border-rose-500/70 text-[11px] tracking-[0.16em] uppercase font-semibold flex items-center gap-2 transition-all duration-200"
            >
              {deactivating ? (
                <>
                  <LoaderCircle className="animate-spin" size={15} /> Đang vô hiệu hóa…
                </>
              ) : (
                <>
                  <AlertTriangle size={15} /> Xác nhận vô hiệu hóa tài khoản
                </>
              )}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
