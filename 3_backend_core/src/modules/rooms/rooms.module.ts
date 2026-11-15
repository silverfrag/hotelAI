import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoomsService } from './rooms.service';
import { RoomsController } from './rooms.controller';
import { RoomType } from './entities/room.entity';

@Module({
  // Đăng ký Entity vào đây
  imports: [TypeOrmModule.forFeature([RoomType])], 
  controllers: [RoomsController],
  providers: [RoomsService],
  exports: [RoomsService],
})
export class RoomsModule {}
