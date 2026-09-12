import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { getOrCreateRequestId, REQUEST_ID_HEADER } from '../utils/request-id';

type JsonRecord = Record<string, unknown>;

@Injectable()
export class ApiResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const header = request.headers[REQUEST_ID_HEADER];
    const requestId = getOrCreateRequestId(header);
    request.headers[REQUEST_ID_HEADER] = requestId;
    response.setHeader('X-Request-ID', requestId);

    return next.handle().pipe(map((payload: unknown) => {
      // Metrics and any future text/stream response must preserve their wire format.
      if (typeof payload === 'string' || Buffer.isBuffer(payload)) return payload;
      if (payload === null || payload === undefined || Array.isArray(payload)) {
        return { status: 'success', data: payload ?? null, request_id: requestId };
      }

      if (typeof payload === 'object') {
        const body = payload as JsonRecord;
        return {
          ...(!Object.prototype.hasOwnProperty.call(body, 'status') ? { status: 'success' } : {}),
          ...body,
          request_id: requestId,
        };
      }

      return { status: 'success', data: payload, request_id: requestId };
    }));
  }
}
