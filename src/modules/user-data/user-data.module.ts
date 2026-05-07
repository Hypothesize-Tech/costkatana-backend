import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserDataController } from './user-data.controller';
import { UserDataService } from './user-data.service';
import { User, UserSchema } from '../../schemas/user/user.schema';
import {
  ChatConversation,
  ChatConversationSchema,
} from '../../schemas/chat/conversation.schema';
import {
  ChatMessage,
  ChatMessageSchema,
} from '../../schemas/chat/chat-message.schema';
import {
  UploadedFile,
  UploadedFileSchema,
} from '../../schemas/misc/uploaded-file.schema';
import {
  UserDataExportJob,
  UserDataExportJobSchema,
} from '../../schemas/misc/user-data-export-job.schema';
import { AccountClosureModule } from '../account-closure/account-closure.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    AuthModule,
    AccountClosureModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: ChatConversation.name, schema: ChatConversationSchema },
      { name: ChatMessage.name, schema: ChatMessageSchema },
      { name: UploadedFile.name, schema: UploadedFileSchema },
      { name: UserDataExportJob.name, schema: UserDataExportJobSchema },
    ]),
  ],
  controllers: [UserDataController],
  providers: [UserDataService],
})
export class UserDataModule {}
