import { Injectable, OnModuleInit } from '@nestjs/common';
import { setGenAITelemetryStore } from '../../utils/genaiTelemetry';
import { TelemetryService } from '../../services/telemetry.service';

/**
 * Wires the global GenAI telemetry store to TelemetryService on app startup
 * so that recordGenAIUsage() persists span-style telemetry to MongoDB.
 */
@Injectable()
export class TelemetryBootstrapService implements OnModuleInit {
  constructor(private readonly telemetryService: TelemetryService) {}

  onModuleInit(): void {
    setGenAITelemetryStore((data) =>
      this.telemetryService.storeTelemetryData(data).then(() => undefined),
    );
  }
}
