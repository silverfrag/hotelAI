export function getPostgresErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;

  const candidate = error as {
    code?: string;
    driverError?: { code?: string };
  };

  return candidate.driverError?.code ?? candidate.code;
}
