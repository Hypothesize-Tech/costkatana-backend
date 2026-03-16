import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  UserPreference,
  UserPreferenceSchema,
} from '../../schemas/agent/memory.schema';
import { UserPreferenceService } from './user-preference.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UserPreference.name, schema: UserPreferenceSchema },
    ]),
  ],
  providers: [UserPreferenceService],
  exports: [UserPreferenceService],
})
export class SharedPreferencesModule {}
