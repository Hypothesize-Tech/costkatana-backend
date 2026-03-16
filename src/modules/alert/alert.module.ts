import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Alert, AlertSchema } from '../../schemas/core/alert.schema';
import { AlertService } from './alert.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Alert.name, schema: AlertSchema }]),
  ],
  providers: [AlertService],
  exports: [AlertService],
})
export class AlertModule {}
