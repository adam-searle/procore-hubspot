import { Injectable } from '@nestjs/common';
import { compareSync, hashSync } from 'bcryptjs';
import { JwtService } from "@nestjs/jwt";
import {Account} from "../entities/account.entity";
import { IDataServices } from "../db/repository";

@Injectable()
export class AuthService {
  constructor(private dataServices: IDataServices, private jwtService: JwtService) {}


  async validateUser(username: string, password: string): Promise<any> {
    console.log("Validate user", username);
    const user = await this.dataServices.accounts.findOne({username});
    if (user && compareSync(password, user.password)) {
      return user;
    }
  }

  async login(user: any){
    const payload = {username: user.username, sub: user.id};
  /* return {
      access_token: this.jwtService.sign(payload),
    };*/
  }

  async validateToken(username): Promise<Account | undefined>{
    return this.dataServices.accounts.findOne({username});
    //const userData = await this.jwtService.verify(access_token);
   // return this.dataServices.accounts.findById(userData.sub);
  }

  async register(username: string, password: string): Promise<Account>{
    let user = await this.dataServices.accounts.findOne({username});
    if (user) return
    let pwHash = hashSync(password, 10);
    return await this.dataServices.accounts.create({username, password:pwHash});
  }

  async signOauthState(account: Account){
    return this.jwtService.sign({sub: account.id, date: Date.now()});
  }
}
