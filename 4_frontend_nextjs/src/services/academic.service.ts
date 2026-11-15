import type { AcademicDecision, AcademicExperiment, AcademicInfo, AcademicInput, AcademicTask, HoldoutOrder, HoldoutPage } from '@/types/academic.type';

async function call<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/v1/core/academic/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store', signal,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.data) {
    const message = payload?.message;
    throw new Error(Array.isArray(message) ? message.join(' · ') : message ?? 'Không thể kết nối dịch vụ AI học thuật.');
  }
  return payload.data as T;
}
export const getAcademicInfo = (signal?: AbortSignal) => call<AcademicInfo>('info', undefined, signal);
export const getAcademicHoldout = (task: AcademicTask, order: HoldoutOrder, offset = 0, signal?: AbortSignal) =>
  call<HoldoutPage>(`holdout?${new URLSearchParams({ task, order, offset: String(offset), limit: '30' })}`, undefined, signal);
export const runAcademicExperiment = (task: AcademicTask, row_id: string, signal?: AbortSignal) =>
  call<AcademicExperiment>('experiment', { task, row_id }, signal);
export const runAcademicDecision = (input: AcademicInput, signal?: AbortSignal) => call<AcademicDecision>('decision', input, signal);
