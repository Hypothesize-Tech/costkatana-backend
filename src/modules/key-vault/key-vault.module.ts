import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { KeyVaultController } from './key-vault.controller';
import { KeyVaultService } from './key-vault.service';
import { ProxyKey, ProxyKeySchema } from '../../schemas/misc/proxy-key.schema';
import {
  ProviderKey,
  ProviderKeySchema,
} from '../../schemas/misc/provider-key.schema';
import {
  Project,
  ProjectSchema,
} from '../../schemas/team-project/project.schema';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: ProxyKey.name, schema: ProxyKeySchema },
      { name: ProviderKey.name, schema: ProviderKeySchema },
      { name: Project.name, schema: ProjectSchema },
    ]),
  ],
  controllers: [KeyVaultController],
  providers: [KeyVaultService],
  exports: [KeyVaultService],
})
export class KeyVaultModule {}
