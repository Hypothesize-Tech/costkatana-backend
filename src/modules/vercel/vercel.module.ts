import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import { SchemasModule } from '../../schemas/schemas.module';
import { McpModule } from '../mcp/mcp.module';
import { AuthModule } from '../auth/auth.module';
import { VercelController } from './vercel.controller';
import { VercelService } from './vercel.service';

@Module({
  imports: [CommonModule, SchemasModule, McpModule, AuthModule],
  controllers: [VercelController],
  providers: [VercelService],
  exports: [VercelService],
})
export class VercelModule {}
