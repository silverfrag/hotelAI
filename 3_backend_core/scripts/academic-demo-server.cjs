// Real NestJS academic boundary without a PMS database. No auth/operational APIs.
require('reflect-metadata');
process.env.AI_ACADEMIC_URL ??= 'http://127.0.0.1:58000/api/v1/academic';
process.env.AI_REVENUE_URL ??= 'http://127.0.0.1:58010/api/v1/revenue';
const { Module, ValidationPipe } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { ConfigModule } = require('@nestjs/config');
const { AcademicModule } = require('../dist/modules/academic/academic.module');
const { RevenueModule } = require('../dist/modules/revenue/revenue.module');
const { ApiResponseInterceptor } = require('../dist/common/interceptors/api-response.interceptor');
const { GlobalExceptionFilter } = require('../dist/common/filters/global-exception.filter');

class DemoModule {}
Module({ imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), AcademicModule, RevenueModule] })(DemoModule);
(async () => {
  const app = await NestFactory.create(DemoModule);
  app.setGlobalPrefix('api/v1/core');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalInterceptors(new ApiResponseInterceptor());
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.listen(Number(process.env.ACADEMIC_CORE_PORT || 53013), process.env.ACADEMIC_CORE_HOST || '127.0.0.1');
})().catch(error => { console.error(error); process.exitCode = 1; });
