import {Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, {Document} from 'mongoose';
import {Account} from "./account.entity";

@Schema()
export class Office extends Document {

    @Prop()
    procoreId: string;

    @Prop()
    name: string;

    @Prop()
    address: string;

    @Prop()
    country_code: string;

    @Prop()
    division: string;

    @Prop()
    state_code: string;

    @Prop()
    zip: string;

    @Prop()
    fax: string;

    @Prop()
    phone: string;

    @Prop({type: mongoose.Schema.Types.ObjectId, ref: 'Account'})
    account: Account;

}


export const OfficeSchema = SchemaFactory.createForClass(Office);