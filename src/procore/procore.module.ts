import { Module } from '@nestjs/common';
import { ConfigModule } from "@nestjs/config";
import { DataServicesModule } from "../db/dataServices.module";
import { AuthModule } from "../auth/auth.module";
import {ProcoreController} from "./procore.controller";
import {ProcoreService} from "./procore.service";

@Module({
    imports: [ConfigModule.forRoot({isGlobal: true}),
        DataServicesModule,
        AuthModule
    ],
    controllers: [ProcoreController],
    exports: [ProcoreService],
    providers: [ProcoreService],
})
export class ProcoreModule {}
