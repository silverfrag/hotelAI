import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';
import { createApiErrorResponse, ApiMessage } from '../contracts/api-response';
import { getOrCreateRequestId, REQUEST_ID_HEADER } from '../utils/request-id';

type NestHttpError = {
  error?: unknown;
  message?: unknown;
};

type HttpLikeError = Error & {
  expose?: unknown;
  status?: unknown;
  statusCode?: unknown;
};

@Catch()
@Injectable()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const requestId = getOrCreateRequestId(request.headers[REQUEST_ID_HEADER]);
    request.headers[REQUEST_ID_HEADER] = requestId;
    const statusCode = this.resolveStatusCode(exception);
    const exceptionResponse = exception instanceof HttpException
      ? exception.getResponse()
      : null;
    const normalized = this.normalizeException(exception, exceptionResponse, statusCode);
    const message = this.removeQueryString(normalized.message, request);

    if (statusCode >= 500) {
      const stackFrames = exception instanceof Error && exception.stack
        ? exception.stack.split('\n').slice(1, 8).map((frame) => frame.trim())
        : undefined;
      process.stderr.write(`${JSON.stringify({
        level: 'error',
        event: 'api_exception',
        request_id: requestId,
        method: request.method,
        path: request.path,
        status_code: statusCode,
        exception_type: exception instanceof Error ? exception.constructor.name : typeof exception,
        stack_frames: stackFrames,
      })}\n`);
    }

    if (response.headersSent) {
      if (!response.writableEnded) response.end();
      return;
    }
    response.setHeader('X-Request-ID', requestId);
    response.status(statusCode).json(createApiErrorResponse({
      statusCode,
      error: normalized.error,
      message,
      path: request.path,
      requestId,
    }));
  }

  private normalizeException(
    exception: unknown,
    exceptionResponse: string | object | null,
    statusCode: number,
  ): { error: string; message: ApiMessage } {
    if (!(exception instanceof HttpException)) {
      if (exception instanceof QueryFailedError && statusCode === HttpStatus.CONFLICT) {
        return { error: 'Conflict', message: 'Dữ liệu hoặc trạng thái đã thay đổi. Hãy tải lại và kiểm tra yêu cầu trước khi thử lại.' };
      }
      const httpLikeError = exception as Partial<HttpLikeError>;
      if (
        statusCode < 500
        && httpLikeError.expose === true
        && typeof httpLikeError.message === 'string'
        && httpLikeError.message.length > 0
      ) {
        return {
          error: this.reasonPhrase(statusCode),
          message: httpLikeError.message,
        };
      }
      return {
        error: 'Internal Server Error',
        message: 'Đã xảy ra lỗi máy chủ.',
      };
    }
    if (typeof exceptionResponse === 'string') {
      return {
        error: this.reasonPhrase(statusCode),
        message: exceptionResponse,
      };
    }

    const payload = exceptionResponse as NestHttpError;
    const message = Array.isArray(payload.message)
      ? payload.message.map(String)
      : typeof payload.message === 'string'
        ? payload.message
        : exception.message || this.reasonPhrase(statusCode);
    return {
      error: typeof payload.error === 'string' ? payload.error : this.reasonPhrase(statusCode),
      message,
    };
  }

  private reasonPhrase(statusCode: number): string {
    const value = HttpStatus[statusCode];
    if (typeof value !== 'string') return 'Error';
    return value
      .toLowerCase()
      .split('_')
      .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
      .join(' ');
  }

  private resolveStatusCode(exception: unknown): number {
    if (exception instanceof HttpException) return exception.getStatus();
    if (exception instanceof QueryFailedError
      && ['23505', '23514', '55000', '40001', '40P01'].includes(
        String((exception.driverError as { code?: string }).code),
      )) return HttpStatus.CONFLICT;
    if (!exception || typeof exception !== 'object') return HttpStatus.INTERNAL_SERVER_ERROR;

    const candidate = exception as Partial<HttpLikeError>;
    const rawStatus = candidate.statusCode ?? candidate.status;
    return typeof rawStatus === 'number'
      && Number.isInteger(rawStatus)
      && rawStatus >= 400
      && rawStatus <= 599
      ? rawStatus
      : HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private removeQueryString(message: ApiMessage, request: Request): ApiMessage {
    const originalUrl = request.originalUrl;
    if (!originalUrl || originalUrl === request.path || !originalUrl.includes('?')) return message;
    const sanitize = (value: string) => value.split(originalUrl).join(request.path);
    return Array.isArray(message) ? message.map(sanitize) : sanitize(message);
  }
}
