import { Controller, Get, Param } from '@nestjs/common';
import { DatabaseIdPipe } from '../../common/pipes/database-id.pipe';
import { RoomsService } from './rooms.service';

@Controller('rooms')
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Get()
  async getAllRooms() {
    const rooms = await this.roomsService.findAllActiveRooms();
    return {
      status: 'success',
      count: rooms.length,
      data: rooms,
    };
  }

  @Get(':typeId')
  async getRoomType(@Param('typeId', DatabaseIdPipe) typeId: number) {
    return {
      status: 'success',
      data: await this.roomsService.findRoomType(typeId),
    };
  }
}
