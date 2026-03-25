import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Guard for GET /api/security-dashboard.
 * Use with JwtAuthGuard. Allows: admin role, or security_monitoring permission, or admin permission.
 * Optionally restricts by SECURITY_DASHBOARD_ALLOWED_IPS.
 */
@Injectable()
export class SecurityDashboardGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user as
      | { id?: string; role?: string; permissions?: string[] }
      | undefined;

    if (!user?.id) {
      throw new ForbiddenException('Authentication required');
    }

    const hasAccess =
      user.role === 'admin' ||
      user.permissions?.includes('security_monitoring') ||
      user.permissions?.includes('admin');

    if (!hasAccess) {
      throw new ForbiddenException('Insufficient permissions');
    }

    // IP-based protection (optional)
    const allowedIPsRaw = this.configService.get<string>(
      'SECURITY_DASHBOARD_ALLOWED_IPS',
    );
    const allowedIPs =
      allowedIPsRaw
        ?.split(',')
        .map((s) => s.trim())
        .filter(Boolean) ?? [];

    if (allowedIPs.length > 0 && !allowedIPs.includes('*')) {
      const clientIP =
        request.ip ??
        request.connection?.remoteAddress ??
        request.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ??
        'unknown';

      const isAllowed = allowedIPs.some((range: string) => {
        if (range.includes('/')) {
          return this.isIPInCIDR(clientIP, range);
        }
        return clientIP === range;
      });

      if (!isAllowed) {
        throw new ForbiddenException('Access denied from this IP');
      }
    }

    return true;
  }

  private isIPInCIDR(ip: string, cidr: string): boolean {
    try {
      const [network, prefixLengthStr] = cidr.split('/');
      const prefixLength = parseInt(prefixLengthStr, 10);
      const ipNum = this.ipToNumber(ip);
      const networkNum = this.ipToNumber(network);
      const mask = ~(0xffffffff >>> prefixLength);
      return (ipNum & mask) === (networkNum & mask);
    } catch {
      return false;
    }
  }

  private ipToNumber(ip: string): number {
    return (
      ip
        .split('.')
        .map((part) => parseInt(part, 10))
        .reduce((acc, octet) => (acc << 8) + octet, 0) >>> 0
    );
  }
}
