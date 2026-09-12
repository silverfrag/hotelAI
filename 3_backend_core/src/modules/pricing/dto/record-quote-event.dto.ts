import { IsIn, IsOptional, IsUUID } from 'class-validator';

export const CLIENT_QUOTE_EVENT_TYPES = [
  'quote.exposed.v1',
  'quote.rejected.v1',
] as const;

export type ClientQuoteEventType = typeof CLIENT_QUOTE_EVENT_TYPES[number];

export class RecordQuoteEventDto {
  @IsIn(CLIENT_QUOTE_EVENT_TYPES)
  event_type: ClientQuoteEventType;

  @IsOptional()
  @IsUUID('4')
  session_id?: string;

  @IsOptional()
  @IsUUID('4')
  search_id?: string;
}
