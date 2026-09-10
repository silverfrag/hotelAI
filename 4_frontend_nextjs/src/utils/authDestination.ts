/** Keep post-auth navigation on this origin, including after URL normalization. */
export function safeAuthDestination(next: string | null, origin: string): string {
  if (!next?.startsWith('/') || next.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(next)) return '/';
  try {
    const destination = new URL(next, origin);
    if (destination.origin !== new URL(origin).origin || destination.pathname.startsWith('//')) return '/';
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return '/';
  }
}
