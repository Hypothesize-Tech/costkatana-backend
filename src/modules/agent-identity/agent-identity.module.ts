import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  AgentIdentity,
  AgentIdentitySchema,
} from '../../schemas/agent/agent-identity.schema';
import { User, UserSchema } from '../../schemas/user/user.schema';
import { AgentIdentityService } from './agent-identity.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AgentIdentity.name, schema: AgentIdentitySchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  providers: [AgentIdentityService],
  exports: [AgentIdentityService],
})
export class AgentIdentityModule {}
