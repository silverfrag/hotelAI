import 'server-only';

/** Only core API is reachable through the public frontend, never AI internals. */
export function getBackendApiUrl(): string {
  const configured = process.env.BACKEND_API_URL
    ?? (process.env.NEXT_PUBLIC_API_URL?.startsWith('http') ? process.env.NEXT_PUBLIC_API_URL : undefined)
    ?? 'http://127.0.0.1:3000/api/v1/core';
  const url = new URL(configured);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('BACKEND_API_URL must be an HTTP core API URL without credentials.');
  }
  return url.href.replace(/\/$/, '');
}
