/**
 * Bridge: Re-exports GatewayCortexService for legacy Express middleware.
 * For NestJS usage, inject GatewayCortexService from GatewayModule.
 */
import { GatewayCortexService as NestGatewayCortexService } from '../modules/gateway/services/gateway-cortex.service';

const processGatewayRequest = async (
  _req: unknown,
  opts: { prompt?: string },
) => ({
  shouldBypass: true,
  processedBody: { prompt: opts?.prompt || '' },
});

/** GatewayCortexService with static processGatewayRequest for legacy middleware */
export const GatewayCortexService = Object.assign(NestGatewayCortexService, {
  processGatewayRequest,
}) as typeof NestGatewayCortexService & {
  processGatewayRequest: typeof processGatewayRequest;
};
