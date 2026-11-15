'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Crown,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/contexts/LanguageContext';
import {
  AccountApiError,
  changeOwnPassword,
  deactivateOwnAccount,
  getOwnProfile,
  updateOwnProfile,
} from '@/services/user.service';
import type { UserProfile } from '@/types/user.type';

const DEACTIVATION_PHRASE = 'VÔ HIỆU HÓA';

function formatDateTime(value: string, locale = 'vi-VN'): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(date);
}

export function ProfileManager() {
  const router = useRouter();
  const { ready, user } = useAuth();
  const accountId = user?.id;

  useEffect(() => {
    if (ready && !accountId) router.replace('/login?next=/profile');
  }, [accountId, ready, router]);

  if (!ready) return <ProfileLoading />;
  if (!accountId) return null;
  return <ProfileEditor key={accountId} accountId={accountId} />;
}

function ProfileLoading() {
  return (
    <main className="min-h-[80vh] flex flex-col items-center justify-center px-5 pt-32 pb-24" role="status">
      <div className="w-12 h-12 rounded-full border border-[var(--border-gold)] flex items-center justify-center mb-5">
        <LoaderCircle className="animate-spin" size={24} style={{ color: 'var(--gold)' }} />
      </div>
      <p className="text-sm tracking-wider uppercase text-[var(--muted)]">Đang tải hồ sơ của bạn…</p>
    </main>
  );
}

function ProfileEditor({ accountId }: { accountId: string }) {
  const router = useRouter();
  const { refreshSession, invalidateSession } = useAuth();
  const { formatPrice } = useTranslation();
  const active = useRef(false);
  const profileRequest = useRef<AbortController | null>(null);
  const saveInFlight = useRef(false);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileNotice, setProfileNotice] = useState('');

  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordNotice, setPasswordNotice] = useState('');

  const [deactivating, setDeactivating] = useState(false);
  const [deactivationError, setDeactivationError] = useState('');

  const loadProfile = useCallback(async () => {
    profileRequest.current?.abort();
    const controller = new AbortController();
    profileRequest.current = controller;
    setLoading(true);
    setLoadError('');
    try {
      const loaded = await getOwnProfile(controller.signal);
      if (!active.current || controller.signal.aborted) return;
      if (loaded.id !== accountId) throw new Error('Phiên đăng nhập đã thay đổi. Vui lòng tải lại trang.');
      setProfile(loaded);
    } catch (caught) {
      if (active.current && !controller.signal.aborted) {
        setLoadError(caught instanceof Error ? caught.message : 'Không thể tải hồ sơ.');
      }
    } finally {
      if (active.current && !controller.signal.aborted) setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    active.current = true;
    void loadProfile();
    return () => {
      active.current = false;
      profileRequest.current?.abort();
    };
  }, [loadProfile]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || saveInFlight.current || !active.current) return;
    const values = new FormData(event.currentTarget);
    const fullName = String(values.get('full_name') ?? '').trim();
    const phone = String(values.get('phone') ?? '').trim();
    const nationality = String(values.get('nationality') ?? '').trim();
    if (!fullName) return setProfileError('Vui lòng nhập họ và tên.');

    saveInFlight.current = true;
    profileRequest.current?.abort();
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
      if (!active.current) return;
      setProfile(updated);
      setProfileNotice('Hồ sơ đã được cập nhật thành công.');
      try {
        await refreshSession();
      } catch {
        if (active.current) {
          setProfileNotice('Hồ sơ đã được cập nhật thành công. Chưa thể đồng bộ thông tin phiên đăng nhập; vui lòng tải lại trang khi kết nối ổn định.');
        }
      }
    } catch (caught) {
      if (!active.current) return;
      setProfileError(caught instanceof Error ? caught.message : 'Không thể cập nhật hồ sơ.');
      if (caught instanceof AccountApiError && caught.status === 409) void loadProfile();
    } finally {
      saveInFlight.current = false;
      if (active.current) setProfileSaving(false);
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
    setPasswordNotice('');
    try {
      await changeOwnPassword({ current_password: currentPassword, new_password: newPassword });
      if (!active.current) return;
      form.reset();
      invalidateSession();
      router.replace('/login?next=/profile&changed=password');
    } catch (caught) {
      if (active.current) setPasswordError(caught instanceof Error ? caught.message : 'Không thể đổi mật khẩu.');
    } finally {
      if (active.current) setPasswordSaving(false);
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
      if (!active.current) return;
      invalidateSession();
      router.replace('/login?account=deactivated');
    } catch (caught) {
      if (active.current) setDeactivationError(caught instanceof Error ? caught.message : 'Không thể vô hiệu hóa tài khoản.');
    } finally {
      if (active.current) setDeactivating(false);
    }
  }

  function getTierConfig(tier: string | undefined) {
    switch (tier) {
      case 'Platinum':
        return { color: '#e5e4e2', glow: 'rgba(229,228,226,0.25)', next: null, threshold: 0, label: 'Platinum Member' };
      case 'Gold':
        return { color: '#ffd700', glow: 'rgba(255,215,0,0.25)', next: 'Platinum', threshold: 20000, label: 'Gold Member' };
      case 'Silver':
        return { color: '#c0c0c0', glow: 'rgba(192,192,192,0.25)', next: 'Gold', threshold: 5000, label: 'Silver Member' };
      default:
        return { color: '#cd7f32', glow: 'rgba(205,127,50,0.25)', next: 'Silver', threshold: 1000, label: 'Bronze Member' };
    }
  }

  if (loading) return <ProfileLoading />;

  if (loadError || !profile) {
    return (
      <main className="min-h-[80vh] flex flex-col items-center justify-center px-5 pt-32 pb-24 text-center max-w-lg mx-auto">
        <div className="w-14 h-14 rounded-full border border-amber-500/30 bg-amber-500/10 flex items-center justify-center mb-5 text-[var(--status-warning)]">
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

  const tierInfo = getTierConfig(profile.loyalty_tier);
  const progressPercent = tierInfo.next
    ? Math.min(100, Math.max(0, (profile.loyalty_points / tierInfo.threshold) * 100))
    : 100;

  return (
    <main className="min-h-[85vh] pt-32 pb-24 px-5 md:px-10 lg:px-16 max-w-6xl mx-auto">
      {/* ── HEADING ── */}
      <header className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <div className="flex items-center gap-3 mb-3">
            <div className="h-px w-8" style={{ background: 'var(--gold)' }} />
            <span className="text-[10px] tracking-[0.28em] uppercase font-medium" style={{ color: 'var(--gold)' }}>
              White Sand Guest Privileges
            </span>
          </div>
          <h1 className="font-display text-4xl md:text-5xl leading-[1.05] text-[var(--fg)] mb-3">
            Hồ sơ cá nhân
          </h1>
          <p className="text-sm max-w-xl leading-relaxed" style={{ color: 'var(--muted)' }}>
            Quản lý thông tin định danh cá nhân, thứ hạng hội viên Guest 360 và bảo mật tài khoản.
          </p>
        </div>
        <Link
          href="/bookings"
          className="inline-flex items-center gap-2 text-xs tracking-widest uppercase py-2 px-4 border transition-all duration-300"
          style={{ borderColor: 'var(--border-gold)', color: 'var(--gold)' }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'rgba(196,153,90,0.1)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'transparent';
          }}
        >
          Lịch sử đặt phòng <ArrowRight size={14} />
        </Link>
      </header>

      {/* ── GUEST 360 LOYALTY CARD ── */}
      <section
        className="p-6 md:p-8 backdrop-blur-xl border mb-10 transition-all duration-300 relative overflow-hidden"
        style={{
          background: 'var(--bg2)',
          borderColor: 'var(--border-gold)',
          boxShadow: `0 8px 32px ${tierInfo.glow}`,
        }}
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-8">
          <div className="flex items-center gap-6">
            <div
              className="w-20 h-20 rounded-2xl border-2 flex flex-col items-center justify-center font-display text-2xl shrink-0 shadow-lg"
              style={{
                borderColor: tierInfo.color,
                color: tierInfo.color,
                background: 'rgba(12,9,5,0.85)',
              }}
            >
              <Crown size={24} className="mb-0.5" />
              <span className="text-xs font-sans uppercase tracking-wider font-semibold">
                {profile.loyalty_tier || 'Bronze'}
              </span>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] tracking-[0.22em] uppercase font-semibold" style={{ color: 'var(--gold)' }}>
                  Hội viên Guest 360
                </span>
                <span
                  className="px-2 py-0.5 text-[9px] uppercase tracking-wider font-semibold rounded"
                  style={{ background: 'rgba(196,153,90,0.15)', color: tierInfo.color, border: `1px solid ${tierInfo.color}40` }}
                >
                  {tierInfo.label}
                </span>
              </div>
              <h2 className="font-display text-2xl md:text-3xl text-[var(--fg)] mb-1">
                {profile.full_name}
              </h2>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                {profile.email} · Tham gia từ {new Date(profile.created_at).getFullYear()}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-6 lg:border-l lg:pl-8" style={{ borderColor: 'var(--border)' }}>
            <div>
              <div className="text-[9px] tracking-[0.2em] uppercase mb-1" style={{ color: 'var(--muted)' }}>
                Điểm tích lũy
              </div>
              <div className="font-display text-2xl text-[var(--gold)]">
                {profile.loyalty_points.toLocaleString('vi-VN')}
              </div>
            </div>
            <div>
              <div className="text-[9px] tracking-[0.2em] uppercase mb-1" style={{ color: 'var(--muted)' }}>
                Kỳ nghỉ đã lưu
              </div>
              <div className="font-display text-2xl text-[var(--fg)]">
                {profile.total_stays}
              </div>
            </div>
            <div>
              <div className="text-[9px] tracking-[0.2em] uppercase mb-1" style={{ color: 'var(--muted)' }}>
                Tổng tích lũy
              </div>
              <div className="font-display text-xl text-[var(--gold)] truncate">
                {formatPrice(profile.total_spent)}
              </div>
            </div>
          </div>
        </div>

        {tierInfo.next && (
          <div className="mt-6 pt-5 border-t" style={{ borderColor: 'rgba(196,153,90,0.15)' }}>
            <div className="flex justify-between text-[10px] uppercase tracking-wider mb-2">
              <span style={{ color: 'var(--muted)' }}>Tiến trình thăng hạng {tierInfo.next}</span>
              <span style={{ color: 'var(--fg)' }}>
                Cần thêm {(tierInfo.threshold - profile.loyalty_points).toLocaleString('vi-VN')} điểm
              </span>
            </div>
            <div className="w-full h-1.5 bg-[var(--border)] rounded-full overflow-hidden">
              <div
                className="h-full transition-all duration-1000 rounded-full"
                style={{ width: `${progressPercent}%`, background: `linear-gradient(90deg, var(--gold), ${tierInfo.color})` }}
              />
            </div>
          </div>
        )}
      </section>

      {/* ── MAIN FORMS GRID ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-10">
        {/* Profile Details Card */}
        <section
          className="p-6 md:p-8 backdrop-blur-xl border flex flex-col justify-between"
          style={{ background: 'var(--bg2)', borderColor: 'var(--border-gold)' }}
        >
          <div>
            <div className="flex items-center gap-3 mb-6 pb-4" style={{ borderBottom: '1px solid var(--border)' }}>
              <div className="w-10 h-10 rounded-full border border-[var(--border-gold)] flex items-center justify-center shrink-0 text-[var(--gold)]">
                <UserRound size={18} />
              </div>
              <div>
                <h2 className="font-display text-2xl text-[var(--fg)]">Thông tin cá nhân</h2>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                  Cập nhật họ tên, số điện thoại và quốc tịch
                </p>
              </div>
            </div>

            <form key={profile.version} className="space-y-5" onSubmit={saveProfile}>
              <div>
                <label htmlFor="profile-full_name" className="block text-[10px] tracking-[0.16em] uppercase font-semibold mb-2" style={{ color: 'var(--fg2)' }}>
                  Họ và tên <span style={{ color: 'var(--gold)' }}>*</span>
                </label>
                <input id="profile-full_name"
                  name="full_name"
                  required
                  autoComplete="name"
                  defaultValue={profile.full_name}
                  className="w-full bg-[var(--bg)] border text-sm px-4 py-3 outline-none transition-colors duration-200"
                  style={{ borderColor: 'var(--border-gold)', color: 'var(--fg)' }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--gold)')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border-gold)')}
                />
              </div>

              <div>
                <label htmlFor="profile-phone" className="block text-[10px] tracking-[0.16em] uppercase font-semibold mb-2" style={{ color: 'var(--fg2)' }}>
                  Số điện thoại
                </label>
                <input id="profile-phone"
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  placeholder="+84 901 234 567"
                  defaultValue={profile.phone ?? ''}
                  className="w-full bg-[var(--bg)] border text-sm px-4 py-3 outline-none transition-colors duration-200"
                  style={{ borderColor: 'var(--border-gold)', color: 'var(--fg)' }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--gold)')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border-gold)')}
                />
              </div>

              <div>
                <label htmlFor="profile-nationality" className="block text-[10px] tracking-[0.16em] uppercase font-semibold mb-2" style={{ color: 'var(--fg2)' }}>
                  Quốc tịch / Vùng lãnh thổ
                </label>
                <input id="profile-nationality"
                  name="nationality"
                  autoComplete="country-name"
                  placeholder="Việt Nam"
                  defaultValue={profile.nationality ?? ''}
                  className="w-full bg-[var(--bg)] border text-sm px-4 py-3 outline-none transition-colors duration-200"
                  style={{ borderColor: 'var(--border-gold)', color: 'var(--fg)' }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--gold)')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border-gold)')}
                />
              </div>

              <div>
                <label htmlFor="profile-email" className="block text-[10px] tracking-[0.16em] uppercase font-semibold mb-2" style={{ color: 'var(--muted)' }}>
                  Email đăng ký (Bất biến)
                </label>
                <input id="profile-email"
                  value={profile.email}
                  readOnly
                  tabIndex={-1}
                  className="w-full bg-[var(--bg3)] border text-sm px-4 py-3 outline-none"
                  style={{ borderColor: 'var(--border)', color: 'var(--fg2)' }}
                />
              </div>

              {profileNotice && (
                <div role="status" className="p-3.5 border border-emerald-500/30 bg-emerald-500/10 text-[var(--status-success)] text-xs flex items-center gap-2">
                  <CheckCircle2 size={15} className="shrink-0 text-[var(--status-success)]" />
                  <span>{profileNotice}</span>
                </div>
              )}

              {profileError && (
                <div className="p-3.5 border border-rose-500/30 bg-rose-500/10 text-[var(--status-danger)] text-xs flex items-center gap-2" role="alert">
                  <AlertTriangle size={15} className="shrink-0 text-[var(--status-danger)]" />
                  <span>{profileError}</span>
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
                      <LoaderCircle className="animate-spin" size={16} /> Đang lưu thông tin…
                    </>
                  ) : (
                    <>
                      <Save size={16} /> Lưu thay đổi hồ sơ
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
            <div className="flex items-center gap-3 mb-6 pb-4" style={{ borderBottom: '1px solid var(--border)' }}>
              <div className="w-10 h-10 rounded-full border border-[var(--border-gold)] flex items-center justify-center shrink-0 text-[var(--gold)]">
                <KeyRound size={18} />
              </div>
              <div>
                <h2 className="font-display text-2xl text-[var(--fg)]">Đổi mật khẩu</h2>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                  Bảo vệ tài khoản bằng mật khẩu mạnh có độ dài tối thiểu 8 ký tự
                </p>
              </div>
            </div>

            <form className="space-y-5" onSubmit={changePassword}>
              <div>
                <label htmlFor="profile-current_password" className="block text-[10px] tracking-[0.16em] uppercase font-semibold mb-2" style={{ color: 'var(--fg2)' }}>
                  Mật khẩu hiện tại <span style={{ color: 'var(--gold)' }}>*</span>
                </label>
                <input id="profile-current_password"
                  name="current_password"
                  type="password"
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="w-full bg-[var(--bg)] border text-sm px-4 py-3 outline-none transition-colors duration-200"
                  style={{ borderColor: 'var(--border-gold)', color: 'var(--fg)' }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--gold)')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border-gold)')}
                />
              </div>

              <div>
                <label htmlFor="profile-new_password" className="block text-[10px] tracking-[0.16em] uppercase font-semibold mb-2" style={{ color: 'var(--fg2)' }}>
                  Mật khẩu mới <span style={{ color: 'var(--gold)' }}>*</span>
                </label>
                <input id="profile-new_password"
                  name="new_password"
                  type="password"
                  minLength={8}
                  maxLength={72}
                  required
                  autoComplete="new-password"
                  placeholder="Tối thiểu 8 ký tự"
                  className="w-full bg-[var(--bg)] border text-sm px-4 py-3 outline-none transition-colors duration-200"
                  style={{ borderColor: 'var(--border-gold)', color: 'var(--fg)' }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--gold)')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border-gold)')}
                />
              </div>

              <div>
                <label htmlFor="profile-password_confirmation" className="block text-[10px] tracking-[0.16em] uppercase font-semibold mb-2" style={{ color: 'var(--fg2)' }}>
                  Nhập lại mật khẩu mới <span style={{ color: 'var(--gold)' }}>*</span>
                </label>
                <input id="profile-password_confirmation"
                  name="password_confirmation"
                  type="password"
                  minLength={8}
                  maxLength={72}
                  required
                  autoComplete="new-password"
                  placeholder="Xác nhận mật khẩu mới"
                  className="w-full bg-[var(--bg)] border text-sm px-4 py-3 outline-none transition-colors duration-200"
                  style={{ borderColor: 'var(--border-gold)', color: 'var(--fg)' }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--gold)')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border-gold)')}
                />
              </div>

              {passwordError && (
                <div className="p-3.5 border border-rose-500/30 bg-rose-500/10 text-[var(--status-danger)] text-xs flex items-center gap-2" role="alert">
                  <AlertTriangle size={15} className="shrink-0 text-[var(--status-danger)]" />
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
          background: 'var(--bg2)',
          borderColor: 'rgba(244, 63, 94, 0.25)',
        }}
      >
        <div className="flex items-start gap-4 mb-6 pb-4" style={{ borderBottom: '1px solid rgba(244, 63, 94, 0.15)' }}>
          <div className="w-10 h-10 rounded-full border border-rose-500/40 bg-rose-500/10 flex items-center justify-center shrink-0 text-[var(--status-danger)] mt-0.5">
            <AlertTriangle size={18} />
          </div>
          <div>
            <h2 className="font-display text-2xl text-[var(--status-danger)] mb-1">Vô hiệu hóa tài khoản</h2>
            <p className="text-xs text-[var(--status-danger)] max-w-2xl leading-relaxed">
              Thao tác này ẩn vĩnh viễn dữ liệu định danh cá nhân của bạn và không thể hoàn tác. Mọi đặt phòng đã xác nhận phải được hoàn tất hoặc hủy trước khi vô hiệu hóa.
            </p>
          </div>
        </div>

        <form className="max-w-xl space-y-4" onSubmit={deactivate}>
          <div>
            <label htmlFor="profile-confirmation" className="block text-[10px] tracking-[0.16em] uppercase font-semibold mb-2 text-[var(--status-danger)]">
              Nhập chính xác cụm từ: <span className="text-[var(--status-danger)] underline font-mono">{DEACTIVATION_PHRASE}</span>
            </label>
            <input id="profile-confirmation"
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
            <label htmlFor="profile-password" className="block text-[10px] tracking-[0.16em] uppercase font-semibold mb-2 text-[var(--status-danger)]">
              Mật khẩu tài khoản để xác nhận
            </label>
            <input id="profile-password"
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
            <div className="p-3.5 border border-rose-500/40 bg-rose-500/20 text-[var(--status-danger)] text-xs flex items-center gap-2" role="alert">
              <AlertTriangle size={15} className="shrink-0 text-[var(--status-danger)]" />
              <span>{deactivationError}</span>
            </div>
          )}

          <div className="pt-2">
            <button
              type="submit"
              disabled={deactivating}
              className="px-6 py-3 border border-rose-500/40 bg-rose-500/10 text-[var(--status-danger)] hover:bg-rose-500/20 hover:border-rose-500/70 text-[11px] tracking-[0.16em] uppercase font-semibold flex items-center gap-2 transition-all duration-200"
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
