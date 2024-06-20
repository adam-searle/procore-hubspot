import { Body, Controller, Get, Post, UseGuards, Request, Render } from "@nestjs/common";
import { AuthService } from './auth.service';
import { LocalAuthGuard } from "./local-auth.guard";
import { Public } from "./auth.module";

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

}
