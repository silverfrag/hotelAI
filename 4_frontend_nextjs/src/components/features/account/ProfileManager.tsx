'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LoaderCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  AccountApiError,
  changeOwnPassword,
  deactivateOwnAccount,
  getOwnProfile,
  updateOwnProfile,
} from '@/services/user.service';
import type { UserProfile } from '@/types/user.type';
import Link from 'next/link';

export function ProfileManager() {
  const router = useRouter();
  const { ready, user, refreshSession, invalidateSession } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileNotice, setProfileNotice] = useState('');

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

  function getTierConfig(tier: string | undefined) {
    switch (tier) {
      case 'Platinum': return { color: '#e5e4e2', next: null, threshold: 0 };
      case 'Gold': return { color: '#ffd700', next: 'Platinum', threshold: 10000 };
      case 'Silver': return { color: '#c0c0c0', next: 'Gold', threshold: 5000 };
      default: return { color: '#cd7f32', next: 'Silver', threshold: 1000 };
    }
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("vi-VN", {
      style: "currency",
      currency: "VND",
    }).format(amount);
  };

  if (!ready || loading) {
    return (
      <div className="flex h-[50vh] items-center justify-center text-[var(--gold)]">
        <LoaderCircle className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (loadError || !profile) {
    return (
      <div className="mx-auto max-w-4xl p-6 md:p-12 text-center">
        <p className="text-red-400 mb-4">{loadError || 'Không thể tải thông tin hồ sơ.'}</p>
        <button onClick={loadProfile} className="text-xs uppercase tracking-[0.16em] bg-[var(--gold)] text-[var(--bg)] px-6 py-2">Thử lại</button>
      </div>
    );
  }

  const tierInfo = getTierConfig(profile.loyalty_tier);
  const progressPercent = tierInfo.next ? Math.min(100, Math.max(0, (profile.loyalty_points / tierInfo.threshold) * 100)) : 100;

  return (
    <div className="mx-auto max-w-5xl px-6 py-12 lg:px-12 lg:py-24">
      <div className="flex items-baseline justify-between mb-12" style={{ borderBottom: "1px solid var(--border-gold)", paddingBottom: "1rem" }}>
        <h1 className="font-display text-4xl" style={{ color: "var(--fg)" }}>My Profile</h1>
        <Link href="/bookings" className="text-xs uppercase tracking-widest hover:underline" style={{ color: "var(--gold)" }}>
          View My Bookings &rarr;
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
        {/* Left Column: Loyalty & Stats */}
        <div className="lg:col-span-5 space-y-8">
          <div className="p-8 border border-[var(--border-gold)]" style={{ background: "rgba(196,153,90,0.03)" }}>
            <div className="text-[10px] tracking-[0.2em] uppercase mb-4" style={{ color: "var(--gold)" }}>
              Guest 360 Loyalty
            </div>
            
            <div className="flex items-center gap-4 mb-8">
              <div className="w-16 h-16 rounded-full flex items-center justify-center font-display text-2xl" style={{ border: `2px solid ${tierInfo.color}`, color: tierInfo.color, background: 'var(--bg2)' }}>
                {profile.loyalty_tier?.charAt(0) || 'B'}
              </div>
              <div>
                <div className="font-display text-2xl mb-1" style={{ color: tierInfo.color }}>{profile.loyalty_tier} Member</div>
                <div className="text-xs text-[var(--muted)]">{profile.loyalty_points} Points</div>
              </div>
            </div>

            {tierInfo.next && (
              <div className="mb-6">
                <div className="flex justify-between text-[10px] uppercase tracking-wider mb-2">
                  <span style={{ color: "var(--muted)" }}>Progress to {tierInfo.next}</span>
                  <span style={{ color: "var(--fg)" }}>{tierInfo.threshold - profile.loyalty_points} pts needed</span>
                </div>
                <div className="w-full h-1 bg-[var(--border)] overflow-hidden">
                  <div className="h-full transition-all duration-1000" style={{ width: `${progressPercent}%`, background: tierInfo.color }} />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 mt-8">
              <div>
                <div className="text-[9px] uppercase tracking-widest text-[var(--muted)] mb-1">Total Stays</div>
                <div className="font-display text-xl text-[var(--fg)]">{profile.total_stays}</div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-widest text-[var(--muted)] mb-1">Total Spent</div>
                <div className="font-display text-xl text-[var(--gold)]">{formatCurrency(profile.total_spent)}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Edit Profile */}
        <div className="lg:col-span-7">
          <form onSubmit={saveProfile} className="space-y-6">
            <h2 className="font-display text-2xl mb-6" style={{ color: "var(--fg)" }}>Personal Details</h2>
            
            <div className="space-y-4">
              <div>
                <label htmlFor="full_name" className="block text-[10px] tracking-[0.16em] uppercase mb-2" style={{ color: "var(--gold)" }}>
                  Full Name
                </label>
                <input
                  id="full_name"
                  name="full_name"
                  type="text"
                  defaultValue={profile.full_name}
                  required
                  className="w-full bg-transparent text-sm p-3 outline-none transition-colors duration-200"
                  style={{ border: "1px solid var(--border)", color: "var(--fg)" }}
                  onFocus={(e) => (e.target.style.borderColor = "var(--gold)")}
                  onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="phone" className="block text-[10px] tracking-[0.16em] uppercase mb-2" style={{ color: "var(--gold)" }}>
                    Phone Number
                  </label>
                  <input
                    id="phone"
                    name="phone"
                    type="tel"
                    defaultValue={profile.phone ?? ''}
                    className="w-full bg-transparent text-sm p-3 outline-none transition-colors duration-200"
                    style={{ border: "1px solid var(--border)", color: "var(--fg)" }}
                    onFocus={(e) => (e.target.style.borderColor = "var(--gold)")}
                    onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
                  />
                </div>
                <div>
                  <label htmlFor="nationality" className="block text-[10px] tracking-[0.16em] uppercase mb-2" style={{ color: "var(--gold)" }}>
                    Country / Nationality
                  </label>
                  <input
                    id="nationality"
                    name="nationality"
                    type="text"
                    defaultValue={profile.nationality ?? ''}
                    className="w-full bg-transparent text-sm p-3 outline-none transition-colors duration-200"
                    style={{ border: "1px solid var(--border)", color: "var(--fg)" }}
                    onFocus={(e) => (e.target.style.borderColor = "var(--gold)")}
                    onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] tracking-[0.16em] uppercase mb-2" style={{ color: "var(--gold)" }}>
                  Email Address
                </label>
                <input
                  type="email"
                  value={profile.email}
                  disabled
                  className="w-full bg-[var(--bg2)] text-sm p-3 outline-none opacity-50 cursor-not-allowed"
                  style={{ border: "1px solid var(--border)", color: "var(--fg)" }}
                />
                <p className="text-[10px] mt-1 text-[var(--muted)]">Email addresses cannot be changed.</p>
              </div>
            </div>

            {profileError && <p className="text-red-400 text-xs mt-4">{profileError}</p>}
            {profileNotice && <p className="text-[var(--gold)] text-xs mt-4">{profileNotice}</p>}

            <div className="pt-4">
              <button
                type="submit"
                disabled={profileSaving}
                className="text-[10px] tracking-[0.16em] uppercase px-8 py-3 transition-all duration-200 disabled:opacity-50"
                style={{ background: "var(--gold)", color: "var(--bg)" }}
              >
                {profileSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
