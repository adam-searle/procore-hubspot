import {Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, {Document} from 'mongoose';
import {Company} from "./company.entity";

@Schema()
export class Account extends Document {

    @Prop()
    portalId: string;

    @Prop()
    hsToken: string;

    @Prop()
    hsTokenExpiry: Date;

    @Prop()
    hsRefreshToken: string;

    @Prop()
    procoreToken: string;

    @Prop()
    procoreRefreshToken: string;

    @Prop()
    procoreTokenExpiry: Date;

    @Prop()
    activeProcoreCompanyId: string;

    @Prop()
    activeProcoreCompanyName: string;

    @Prop({required: true})
    username: string;

    @Prop({required: true})
    password: string;

    @Prop({default: true})
    active: boolean;

}


export const AccountSchema = SchemaFactory.createForClass(Account);