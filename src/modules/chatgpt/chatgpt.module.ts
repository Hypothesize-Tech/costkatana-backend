import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChatGPTController } from './chatgpt.controller';
import { ChatGPTService } from './chatgpt.service';
import { User, UserSchema } from '../../schemas/user/user.schema';
import { ProjectModule } from '../project/project.module';
import { UsageModule } from '../usage/usage.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { AuthModule } from '../auth/auth.module';
import { ApiKeyModule } from '../api-key/api-key.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    ProjectModule,
    UsageModule,
    OnboardingModule,
    AuthModule,
    ApiKeyModule,
  ],
  controllers: [ChatGPTController],
  providers: [ChatGPTService],
  exports: [ChatGPTService],
})
export class ChatGPTModule {}