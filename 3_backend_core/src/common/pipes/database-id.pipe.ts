import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

@Injectable()
export class DatabaseIdPipe implements PipeTransform<string, number> {
  transform(value: string): number {
    if (!/^\d+$/.test(value)) throw new BadRequestException('ID phải là số nguyên dương hợp lệ.');

    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 2_147_483_647) {
      throw new BadRequestException('ID phải nằm trong khoảng từ 1 đến 2147483647.');
    }

    return parsed;
  }
}
