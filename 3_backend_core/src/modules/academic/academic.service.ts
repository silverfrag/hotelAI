import { BadGatewayException, BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { AcademicBookingDto } from './dto/academic-booking.dto';

export type AcademicTask = 'adr' | 'cancellation';
export type HoldoutOrder = 'source' | 'largest_error' | 'smallest_error';

@Injectable()
export class AcademicService {
  constructor(private readonly config: ConfigService) {}

  private async call(method: 'get' | 'post', path: string, body?: unknown) {
    const configured = this.config.get<string>('AI_ACADEMIC_URL');
    const legacyUrl = this.config.get<string>('AI_SERVICE_URL', 'http://127.0.0.1:8000/api/v1/predict-price');
    const base = configured ?? `${new URL(legacyUrl).origin}/api/v1/academic`;
    try {
      const { data } = await axios.request({ method, url: `${base.replace(/\/$/, '')}/${path}`, data: body,
        timeout: 15_000, maxContentLength: 4 * 1024 * 1024 });
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new BadGatewayException('Invalid academic response.');
      return data;
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      if (axios.isAxiosError(error) && error.response?.status === 404) throw new NotFoundException('Holdout booking not found.');
      if (axios.isAxiosError(error) && error.response?.status === 422) {
        throw new BadRequestException('Booking input does not satisfy the academic feature contract.');
      }
      throw new ServiceUnavailableException('AI học thuật tạm thời không khả dụng. Kiểm tra model artifacts và AI service rồi thử lại.');
    }
  }

  private validateDecision(data: any) {
    const finiteOrNull = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value));
    if (!['success', 'degraded'].includes(data.status)
      || !finiteOrNull(data.adr_reference) || (data.adr_reference !== null && data.adr_reference < 0)
      || !finiteOrNull(data.cancellation_probability)
      || (data.cancellation_probability !== null && (data.cancellation_probability < 0 || data.cancellation_probability > 1))
      || data.adr_unit !== 'EUR' || data.feature_contract_version !== 'academic-booking-v1'
      || typeof data.model_version !== 'string' || !data.model_version
      || typeof data.training_run_id !== 'string' || !data.training_run_id
      || !data.prediction_sources || !data.features || !data.explanation
      || !Array.isArray(data.caveats) || !Array.isArray(data.warnings) || !Array.isArray(data.business_rules)) {
      throw new BadGatewayException('AI returned an incompatible academic decision contract.');
    }
    return data;
  }

  async info() {
    const data = await this.call('get', 'info');
    if (data.feature_contract_version !== 'academic-booking-v1' || !data.tasks?.adr || !data.tasks?.cancellation || !data.categories) {
      throw new BadGatewayException('Invalid academic experiment metadata.');
    }
    return data;
  }

  async decide(dto: AcademicBookingDto) {
    return this.validateDecision(await this.call('post', 'decision', dto));
  }

  async holdout(task: AcademicTask, offset: number, limit: number, order: HoldoutOrder) {
    const data = await this.call('get', `holdout?${new URLSearchParams({ task, offset: String(offset), limit: String(limit), order })}`);
    if (data.task !== task || !Number.isInteger(data.total) || !Array.isArray(data.rows)) {
      throw new BadGatewayException('Invalid holdout response.');
    }
    return data;
  }

  async experiment(task: AcademicTask, rowId: string) {
    const data = await this.call('post', 'experiment', { task, row_id: rowId });
    if (data.task !== task || data.row_id !== rowId || data.partition !== 'test') {
      throw new BadGatewayException('Invalid holdout experiment response.');
    }
    this.validateDecision(data.decision);
    return data;
  }
}
