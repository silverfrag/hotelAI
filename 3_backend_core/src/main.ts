import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';
import { MetricsService } from './infrastructure/metrics.service';
import { createApiErrorResponse } from './common/contracts/api-response';
import { getOrCreateRequestId, REQUEST_ID_HEADER } from './common/utils/request-id';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.set('trust proxy', 1);
  app.setGlobalPrefix('api/v1/core');
  const config = app.get(ConfigService);
  const metrics = app.get(MetricsService);
  const allowedOrigins = config
    .get<string>('CORS_ORIGINS', 'http://localhost,http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (config.get('DEPLOYMENT_MODE', 'development') === 'production') {
    if (config.get('COOKIE_SECURE') !== 'true' || !allowedOrigins.length
      || allowedOrigins.some(origin => !origin.startsWith('https://'))) {
      throw new Error('Production requires secure cookies and explicit HTTPS CORS origins.');
    }
    const [role] = await app.get(DataSource).query(`SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls,
      has_table_privilege(current_user, 'schema_migrations', 'INSERT') AS can_migrate,
      has_table_privilege(current_user, 'bookings', 'DELETE') AS can_erase_bookings,
      has_schema_privilege(current_user, 'public', 'CREATE') AS can_create
      FROM pg_roles WHERE rolname = current_user`);
    if (!role || Object.values(role).some(Boolean)) {
      throw new Error('Production requires a restricted runtime database login, separate from the migration owner.');
    }
  }
  app.enableShutdownHooks();

  app.use((request, response, next) => {
    const requestId = getOrCreateRequestId(request.headers[REQUEST_ID_HEADER]);
    request.headers[REQUEST_ID_HEADER] = requestId;
    response.setHeader('X-Request-ID', requestId);
    const startedAt = process.hrtime.bigint();
    response.on('finish', () => {
      const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
      const routePath = request.route?.path
        ? `${request.baseUrl ?? ''}${request.route.path}`
        : '__unmatched__';
      metrics.recordHttp(request.method, routePath, response.statusCode, durationSeconds);
      process.stdout.write(`${JSON.stringify({
        level: response.statusCode >= 500 ? 'error' : 'info',
        event: 'http_request',
        request_id: requestId,
        method: request.method,
        route: routePath,
        status_code: response.statusCode,
        duration_ms: Math.round(durationSeconds * 100_000) / 100,
      })}\n`);
    });
    next();
  });

  // CORS headers alone do not prevent a cross-origin form/fetch from mutating
  // state. Reject unsafe browser requests from untrusted origins before they
  // reach cookie-authenticated controllers.
  app.use((request, response, next) => {
    const unsafeMethod = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    const origin = request.headers.origin;
    const fetchSite = request.headers['sec-fetch-site'];
    if (
      unsafeMethod
      && (
        (typeof origin === 'string' && !allowedOrigins.includes(origin))
        || fetchSite === 'cross-site'
      )
    ) {
      const requestId = getOrCreateRequestId(request.headers[REQUEST_ID_HEADER]);
      request.headers[REQUEST_ID_HEADER] = requestId;
      response.setHeader('X-Request-ID', requestId);
      response.status(403).json(createApiErrorResponse({
        statusCode: 403,
        message: 'Cross-origin mutation is not allowed.',
        error: 'Forbidden',
        path: request.path,
        requestId,
      }));
      return;
    }
    next();
  });
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    exposedHeaders: ['X-Request-ID'],
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
