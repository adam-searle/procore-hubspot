import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';

@Injectable()
export class AuthenticatedGuard implements CanActivate {
  private readonly logger = new Logger(AuthenticatedGuard.name);

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    this.logger.debug(`Request user: ${JSON.stringify(request.user)}`);
    const isAuthenticated = request.isAuthenticated();
    this.logger.debug(`isAuthenticated: ${isAuthenticated}`);
    return isAuthenticated;
  }
}
