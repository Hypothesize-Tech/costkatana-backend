import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getRoot(): { status: string; message: string } {
    return {
      status: 'ok',
      message: 'Cost Katana API Server',
    };
  }

  @Get('health')
  getHealthCheck(): { status: string } {
    return this.appService.getHealth();
  }

  @Get('api/health')
  getApiHealth(): { status: string } {
    return this.appService.getHealth();
  }

  @Get('api/version')
  getVersion(): { version: string } {
    return this.appService.getVersion();
  }
}
