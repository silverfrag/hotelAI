export type ApiMessage = string | string[];

export type ApiErrorResponse = {
  status: 'error';
  statusCode: number;
  error: string;
  message: ApiMessage;
  path: string;
  timestamp: string;
  request_id: string;
};

export function createApiErrorResponse(input: {
  statusCode: number;
  error: string;
  message: ApiMessage;
  path: string;
  requestId: string;
}): ApiErrorResponse {
  return {
    status: 'error',
    statusCode: input.statusCode,
    error: input.error,
    message: input.message,
    path: input.path,
    timestamp: new Date().toISOString(),
    request_id: input.requestId,
  };
}
