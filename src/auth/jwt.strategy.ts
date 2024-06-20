import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';
import { IDataServices } from "../db/repository";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private dataServices: IDataServices) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET,
    });
  }

  async validate(payload: any) {
    return await this.dataServices.accounts.findById(payload.sub);
  }
}