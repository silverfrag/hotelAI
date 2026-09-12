import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ChatService } from './chat.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Request } from 'express';

export class ChatMessageDto {
  message: string;
}

@Controller('api/v1/core/chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  async handleChat(@Req() req: Request, @Body() body: ChatMessageDto) {
    const user = req.user;
    const response = await this.chatService.processMessage(user?.id, body.message);
    return { response };
  }
}
