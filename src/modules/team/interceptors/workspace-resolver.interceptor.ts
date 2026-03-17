import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { WorkspaceService } from '../services/workspace.service';

/**
 * Resolves user.workspaceId when missing (e.g. JWT doesn't include it).
 * Fetches default workspace from DB and attaches to request.user.
 */
@Injectable()
export class WorkspaceResolverInterceptor implements NestInterceptor {
  constructor(private readonly workspaceService: WorkspaceService) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest();
    const user = request.user as { id?: string; workspaceId?: string } | null;

    if (user?.id && !user.workspaceId) {
      const workspaceId = await this.workspaceService.getUserDefaultWorkspaceId(
        user.id,
      );
      if (workspaceId) {
        user.workspaceId = workspaceId;
      }
    }

    return next.handle();
  }
}
