import { Module } from '@nestjs/common';
import { ConfigModule } from "@nestjs/config";
import { DataServicesModule } from "../db/dataServices.module";
import { AuthModule } from "../auth/auth.module";
import { HubspotService } from "./hubspot.service";
import { HubspotController } from "./hubspot.controller";
import {ProcoreModule} from "../procore/procore.module";


@Module({
    imports: [ConfigModule.forRoot({isGlobal: true}),
        DataServicesModule,
        AuthModule,
        ProcoreModule
    ],
    controllers: [HubspotController],
    exports: [HubspotService],
    providers: [HubspotService],
})
export class HubspotModule {}
