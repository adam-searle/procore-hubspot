import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { DataServicesModule } from './db/dataServices.module';
import { AuthModule } from './auth/auth.module';
import { ProcoreModule } from './procore/procore.module';
import { HubspotModule } from './hubspot/hubspot.module';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DataServicesModule,
    AuthModule,
    ProcoreModule,
    HubspotModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
