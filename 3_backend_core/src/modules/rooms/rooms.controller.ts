import { Controller, Get } from '@nestjs/common';
import { RoomsService } from './rooms.service';

@Controller('rooms') // <-- Đảm bảo chỗ này là 'rooms'
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Get() // <-- Đảm bảo hàm này mapping với phương thức GET gốc
  async getAllRooms() {
    const rooms = await this.roomsService.findAllActiveRooms();
    return {
      status: 'success',
      count: rooms.length,
      data: rooms,
    };
  }
}