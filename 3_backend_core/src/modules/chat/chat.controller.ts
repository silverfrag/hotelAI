import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ChatService } from './chat.service';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { AuthenticatedUser } from '../../common/guards/jwt-auth.guard';
import { Request } from 'express';

import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class ChatMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  message: string;

  @IsOptional()
  @IsIn(['vi', 'en'])
  language?: 'vi' | 'en';
}

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  @UseGuards(OptionalJwtAuthGuard)
  async handleChat(@Req() req: Request & { user?: AuthenticatedUser }, @Body() body: ChatMessageDto) {
    const user = req.user;
    const rich = await this.chatService.processRichMessage(user?.sub, body.message, user?.full_name, body.language);
    return {
      status: 'success',
      response: rich.response,
      citations: rich.citations,
      slots: rich.slots,
      suggested_action: rich.suggested_action,
      retriever: rich.retriever,
      live_tools_used: rich.live_tools_used,
      sender: 'bot',
      mode: 'guided_assistant',
      timestamp: new Date().toISOString(),
    };
  }
}
