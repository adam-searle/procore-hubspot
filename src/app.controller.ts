import {Body, Controller, Get, Post, Query, Render, Request, UnauthorizedException, UseGuards} from "@nestjs/common";
import { AppService } from './app.service';
import { Public } from "./auth/auth.module";
import { LocalAuthGuard } from "./auth/local-auth.guard";
import { AuthService } from "./auth/auth.service";
import {AuthenticatedGuard} from "./auth/authenticated.guard";

@Controller()
export class AppController {
  constructor(private readonly authService: AuthService) {}


 // @Public()
  @UseGuards(LocalAuthGuard)
  @Post('login')
  @Render('dashboard')
  async login(@Request() req){
    return {user: req.user, message:null};
  }

  @UseGuards(AuthenticatedGuard)
  @Get('dashboard')
  @Render('dashboard')
  async getDashboard(@Request() req, @Query('message') message: string){
    console.log("Get dashboard for user", req.user);
    if (message){
      message = decodeURIComponent(message);
    }

    return {user: req.user, message}
  }

 //@Public()
  @Post('register')
  async register(@Body() body){
    if (process.env.REGISTRATION_SECRET === body.registration_code){
      return this.authService.register(body.username, body.password);
    }
    throw new UnauthorizedException("Invalid registration code");
  }

//  @Public()
  @Get('login')
  @Render('login')
  getLogin(){}

 // @Public()
  @Get('register')
  @Render('register')
  getRegister(){}
}
