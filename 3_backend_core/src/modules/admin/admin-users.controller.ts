import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthenticatedUser, JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AdminUsersService } from './admin-users.service';
import {
  AdminUserAuditsQueryDto,
  AdminUsersQueryDto,
  UpdateAdminUserDto,
} from './dto/admin-users.dto';

@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminUsersController {
  constructor(private readonly adminUsers: AdminUsersService) {}

  @Get()
  async listUsers(@Query() query: AdminUsersQueryDto) {
    const result = await this.adminUsers.listUsers(query);
    return {
      status: 'success',
      count: result.data.length,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
      data: result.data,
    };
  }

  @Get(':customerId/audits')
  async listAudits(
    @Param('customerId', new ParseUUIDPipe({ version: '4' })) customerId: string,
    @Query() query: AdminUserAuditsQueryDto,
  ) {
    const result = await this.adminUsers.listAudits(customerId, query);
    return { status: 'success', ...result, count: result.data.length };
  }

  @Get(':customerId')
  async getUser(
    @Param('customerId', new ParseUUIDPipe({ version: '4' })) customerId: string,
  ) {
    return { status: 'success', data: await this.adminUsers.getUser(customerId) };
  }

  @Patch(':customerId')
  async updateUser(
    @Param('customerId', new ParseUUIDPipe({ version: '4' })) customerId: string,
    @Body() dto: UpdateAdminUserDto,
    @Req() request: { user: AuthenticatedUser },
  ) {
    return {
      status: 'success',
      message: 'Cập nhật tài khoản thành công.',
      data: await this.adminUsers.updateUser(customerId, request.user.sub, dto),
    };
  }
}
