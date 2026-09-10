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
      setProfileNotice('Hồ sơ đã được cập nhật.');
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
      <main className="profile-page profile-state" role="status">
        <LoaderCircle className="profile-spinner" />
        <p>Đang tải hồ sơ…</p>
      </main>
    );
  }
  if (!user) return null;
  if (loadError || !profile) {
    return (
      <main className="profile-page profile-state">
        <AlertTriangle className="profile-danger-icon" />
        <h1>Không thể tải hồ sơ</h1>
        <p>{loadError || 'Máy chủ không trả về dữ liệu hợp lệ.'}</p>
        <button type="button" onClick={() => void loadProfile()}>
          <RefreshCw size={17} /> Thử lại
        </button>
      </main>
    );
  }

  return (
    <main className="profile-page">
      <header className="profile-heading">
        <div className="profile-heading-icon"><UserRound /></div>
        <div>
          <p className="eyebrow">Tài khoản Hotel AI</p>
          <h1>Hồ sơ của tôi</h1>
          <p className="subtitle">Quản lý thông tin liên hệ, mật khẩu và vòng đời tài khoản.</p>
        </div>
      </header>

      <section className="profile-summary" aria-label="Tóm tắt tài khoản">
        <div><span>Email đăng nhập</span><strong>{profile.email}</strong></div>
        <div><span>Vai trò</span><strong>{profile.role === 'admin' ? 'Quản trị viên' : 'Khách hàng'}</strong></div>
        <div><span>Trạng thái</span><strong className="profile-status-active"><ShieldCheck /> Đang hoạt động</strong></div>
        <div><span>Cập nhật gần nhất</span><strong>{formatDateTime(profile.updated_at)}</strong></div>
      </section>

      <div className="profile-grid">
        <section className="profile-card">
          <div className="profile-card-heading">
            <UserRound />
            <div><h2>Thông tin cá nhân</h2><p>Email đăng nhập không thể thay đổi tại đây.</p></div>
          </div>
          <form className="profile-form" onSubmit={saveProfile} key={profile.version}>
            <label>Họ và tên
              <input name="full_name" defaultValue={profile.full_name} maxLength={150} required autoComplete="name" />
            </label>
            <label>Số điện thoại
              <input name="phone" defaultValue={profile.phone ?? ''} maxLength={20} autoComplete="tel" placeholder="+84 912 345 678" />
            </label>
            <label>Quốc tịch
              <input name="nationality" defaultValue={profile.nationality ?? ''} maxLength={50} autoComplete="country-name" placeholder="Việt Nam" />
            </label>
            {profileError && <p className="profile-message error" role="alert">{profileError}</p>}
            {profileNotice && <p className="profile-message success" role="status"><CheckCircle2 /> {profileNotice}</p>}
            <button type="submit" disabled={profileSaving}>
              {profileSaving ? <LoaderCircle className="profile-spinner" /> : <Save size={17} />}
              Lưu thay đổi
            </button>
          </form>
        </section>

        <section className="profile-card">
          <div className="profile-card-heading">
            <KeyRound />
            <div><h2>Đổi mật khẩu</h2><p>Tất cả phiên cũ sẽ hết hiệu lực ngay sau khi đổi.</p></div>
          </div>
          <form className="profile-form" onSubmit={changePassword}>
            <label>Mật khẩu hiện tại
              <input name="current_password" type="password" minLength={8} maxLength={72} required autoComplete="current-password" />
            </label>
            <label>Mật khẩu mới
              <input name="new_password" type="password" minLength={8} maxLength={72} required autoComplete="new-password" />
            </label>
            <label>Nhập lại mật khẩu mới
              <input name="password_confirmation" type="password" minLength={8} maxLength={72} required autoComplete="new-password" />
            </label>
            {passwordError && <p className="profile-message error" role="alert">{passwordError}</p>}
            <button type="submit" disabled={passwordSaving}>
              {passwordSaving ? <LoaderCircle className="profile-spinner" /> : <KeyRound size={17} />}
              Đổi mật khẩu
            </button>
          </form>
        </section>
      </div>

      <section className="profile-card profile-danger-zone">
        <div className="profile-card-heading">
          <AlertTriangle />
          <div>
            <h2>Vô hiệu hóa tài khoản</h2>
            <p>Thao tác này ẩn vĩnh viễn dữ liệu cá nhân và không thể hoàn tác. Bạn phải xử lý mọi booking đã xác nhận trước.</p>
          </div>
        </div>
        <form className="profile-form profile-deactivation-form" onSubmit={deactivate}>
          <label>Nhập “{DEACTIVATION_PHRASE}”
            <input name="confirmation" required autoComplete="off" />
          </label>
          <label>Mật khẩu hiện tại
            <input name="password" type="password" minLength={8} maxLength={72} required autoComplete="current-password" />
          </label>
          {deactivationError && <p className="profile-message error" role="alert">{deactivationError}</p>}
          <button className="danger-button" type="submit" disabled={deactivating}>
            {deactivating ? <LoaderCircle className="profile-spinner" /> : <AlertTriangle size={17} />}
            Vô hiệu hóa tài khoản
          </button>
        </form>
      </section>
    </main>
  );
}
