import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PassportModule } from "@nestjs/passport";
import { LocalStrategy } from "./local.strategy";
import {JwtModule, JwtService} from "@nestjs/jwt";
import { JwtStrategy } from "./jwt.strategy";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { SetMetadata } from '@nestjs/common';
import { ConfigModule } from "@nestjs/config";
import { AuthController } from "./auth.controller";
import { DataServicesModule } from "../db/dataServices.module";
import {SessionSerializer} from "./session.serializer";

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

@Module({
  imports: [ConfigModule.forRoot(), PassportModule, DataServicesModule, PassportModule.register({session: true})],
  providers: [AuthService, LocalStrategy, JwtService, SessionSerializer],
  exports: [AuthService],
  controllers: [AuthController]
})
export class AuthModule {}