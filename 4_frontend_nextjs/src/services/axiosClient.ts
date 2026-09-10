export const apiBaseUrl = (
  process.env.NEXT_PUBLIC_API_URL ?? '/api/v1/core'
).replace(/\/$/, '');
