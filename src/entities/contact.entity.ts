import {Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, {Document} from 'mongoose';
import {Company} from "./company.entity";

@Schema()
export class Contact extends Document {
    @Prop()
    hsId: string;

    @Prop()
    procoreId: string;

    @Prop()
    firstName: string;

    @Prop()
    lastName: string;

    @Prop()
    phone: string;

    @Prop()
    email: string;

    @Prop()
    mobilePhone: string;

    @Prop()
    address: string;

    @Prop()
    fax: string;

    @Prop()
    jobTitle: string;

    @Prop()
    city: string;

    @Prop()
    zip: string;

    @Prop()
    stateCode: string;

    @Prop()
    countryCode: string;

    @Prop({type: mongoose.Schema.Types.ObjectId, ref: 'Company'})
    company: Company


}


export const ContactSchema = SchemaFactory.createForClass(Contact);