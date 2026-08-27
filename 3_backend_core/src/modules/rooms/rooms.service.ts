import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RoomType } from './entities/room.entity';

@Injectable()
export class RoomsService {
  constructor(
    @InjectRepository(RoomType)
    private roomsRepository: Repository<RoomType>,
  ) {}

  // Hàm lấy toàn bộ danh sách loại phòng
  async findAllActiveRooms(): Promise<RoomType[]> {
    try {
      // Lấy toàn bộ danh sách phòng và sắp xếp theo giá cơ bản tăng dần
      return await this.roomsRepository.find({
        order: { base_price: 'ASC' }
      });
    } catch (error: any) {
      console.error("🔥 CHI TIẾT LỖI DB:", error);
      throw new InternalServerErrorException(`Lỗi DB: ${error.message}`);
    }
  }
}