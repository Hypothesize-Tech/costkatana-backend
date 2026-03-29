import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import {
  TraceSession,
  TraceSessionSchema,
} from '@/schemas/trace/trace-session.schema';
import { TraceSpan, TraceSpanSchema } from '@/schemas/trace/trace-span.schema';
import {
  TraceMessage,
  TraceMessageSchema,
} from '@/schemas/trace/trace-message.schema';
import { Message, MessageSchema } from '@/schemas/trace/trace-full-message.schema';
import { TraceController } from './trace.controller';
import { TracesIngestController } from './traces-ingest.controller';
import { TraceService } from './trace.service';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: TraceSession.name, schema: TraceSessionSchema },
      { name: TraceSpan.name, schema: TraceSpanSchema },
      { name: TraceMessage.name, schema: TraceMessageSchema },
      { name: Message.name, schema: MessageSchema },
    ]),
  ],
  controllers: [TraceController, TracesIngestController],
  providers: [TraceService],
  exports: [TraceService],
})
export class TraceModule {}
