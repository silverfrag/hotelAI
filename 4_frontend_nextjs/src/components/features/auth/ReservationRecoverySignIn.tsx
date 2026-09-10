'use client';

import { type FormEvent, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';

/** Reauthenticate without navigating away from the unresolved booking attempt. */
export function ReservationRecoverySignIn({ account }: { account: { id: string; email: string } }) {
  const { login, user, ready } = useAuth();
  const busy = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const form = event.currentTarget;
    const password = String(new FormData(form).get('password') ?? '');
    busy.current = true;
    setLoading(true);
    setError('');
    try {
      const session = await login({ email: account.email, password });
      if (session.user.id !== account.id) {
        setError('This account does not match the original reservation. Sign in with the original guest account.');
      }
      form.reset();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Sign-in failed. Please try again.');
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }

  return <form onSubmit={submit} className="mt-6 space-y-4 rounded-xl border border-current/20 p-5" aria-label="Sign in to recover reservation">
    <p className="font-semibold">Sign in to recover your reservation</p>
    <p className="text-sm">{user && user.id !== account.id ? 'You are signed in with a different account. ' : 'Your session has expired. '}Sign in as {account.email}, then use Recover reservation.</p>
    <label className="block text-sm">Email<input name="email" type="email" autoComplete="username" value={account.email} readOnly className="mt-1 block w-full rounded border border-current/20 bg-transparent p-2" /></label>
    <label className="block text-sm">Password<input name="password" type="password" autoComplete="current-password" minLength={8} required disabled={loading} className="mt-1 block w-full rounded border border-current/20 bg-transparent p-2" /></label>
    {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    <button type="submit" disabled={loading || !ready} className="rounded border border-current/30 px-4 py-2 text-sm disabled:opacity-50">{loading ? 'Signing in…' : 'Sign in and keep this reservation'}</button>
    <p className="text-xs">Keep this page open. Recovery is retained only while this form stays open; before reloading or leaving, check My bookings in another tab.</p>
  </form>;
}
