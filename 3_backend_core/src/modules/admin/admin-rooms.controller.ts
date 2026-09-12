import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { DatabaseIdPipe } from '../../common/pipes/database-id.pipe';
import { AdminRoomsService } from './admin-rooms.service';
import { CreatePhysicalRoomDto, UpdatePhysicalRoomDto } from './dto/physical-room.dto';
import { CreateRoomTypeDto, UpdateRoomTypeDto } from './dto/room-type.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminRoomsController {
  constructor(private readonly adminRooms: AdminRoomsService) {}

  @Get('room-types')
  async listRoomTypes() {
    const data = await this.adminRooms.listRoomTypes();
    return { status: 'success', count: data.length, data };
  }

  @Post('room-types')
  async createRoomType(@Body() dto: CreateRoomTypeDto) {
    return {
      status: 'success',
      message: 'Tạo loại phòng thành công.',
      data: await this.adminRooms.createRoomType(dto),
    };
  }

  @Patch('room-types/:typeId')
  async updateRoomType(
    @Param('typeId', DatabaseIdPipe) typeId: number,
    @Body() dto: UpdateRoomTypeDto,
  ) {
    return {
      status: 'success',
      message: 'Cập nhật loại phòng thành công.',
      data: await this.adminRooms.updateRoomType(typeId, dto),
    };
  }

  @Delete('room-types/:typeId')
  async deleteRoomType(@Param('typeId', DatabaseIdPipe) typeId: number) {
    await this.adminRooms.deleteRoomType(typeId);
    return { status: 'success', message: 'Xóa loại phòng thành công.' };
  }

  @Get('rooms')
  async listPhysicalRooms() {
    const data = await this.adminRooms.listPhysicalRooms();
    return { status: 'success', count: data.length, data };
  }

  @Post('rooms')
  async createPhysicalRoom(@Body() dto: CreatePhysicalRoomDto) {
    return {
      status: 'success',
      message: 'Tạo phòng thành công.',
      data: await this.adminRooms.createPhysicalRoom(dto),
    };
  }

  @Patch('rooms/:roomId')
  async updatePhysicalRoom(
    @Param('roomId', DatabaseIdPipe) roomId: number,
    @Body() dto: UpdatePhysicalRoomDto,
  ) {
    return {
      status: 'success',
      message: 'Cập nhật phòng thành công.',
      data: await this.adminRooms.updatePhysicalRoom(roomId, dto),
    };
  }

  @Delete('rooms/:roomId')
  async deletePhysicalRoom(@Param('roomId', DatabaseIdPipe) roomId: number) {
    await this.adminRooms.deletePhysicalRoom(roomId);
    return { status: 'success', message: 'Xóa phòng thành công.' };
  }
}
