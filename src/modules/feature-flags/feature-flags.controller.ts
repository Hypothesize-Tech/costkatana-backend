import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';

/**
 * Remote feature flag + experiment rollout config (read by clients; override local defaults).
 */
@Controller('api/feature-flags')
export class FeatureFlagsController {
  @Public()
  @Get()
  getFeatureFlags() {
    return {
      success: true,
      data: {
        version: 1,
        experiments: {
          pricing_page_v2: { control: 50, variant_a: 50 },
          onboarding_flow_v2: { control: 33, variant_a: 33, variant_b: 34 },
          dashboard_layout_v2: { control: 50, variant_a: 50 },
          feature_discovery_modal: { control: 50, variant_a: 50 },
        },
        features: {
          new_usage_dashboard: { enabledPercent: 100, defaultValue: true },
        },
      },
      metadata: {
        generatedAt: new Date().toISOString(),
      },
    };
  }
}
