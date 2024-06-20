// src/filters/detailed-exception.filter.ts

import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { Logger } from '@nestjs/common';

@Catch()
export class DetailedExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DetailedExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const errorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      message: exception instanceof HttpException ? exception.message : 'Internal server error',
      stack: exception instanceof Error ? exception.stack : null,
    };

    this.logger.error(
      `HTTP Status: ${status} Error Message: ${exception instanceof Error ? exception.message : JSON.stringify(exception)} Stack: ${errorResponse.stack}`,
    );

    response.status(status).json(errorResponse);
  }
}
