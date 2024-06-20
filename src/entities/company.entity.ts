import {Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, {Document} from 'mongoose';
import {Contact} from "./contact.entity";

@Schema()
export class Company extends Document {

    @Prop()
    hsId: string;

    @Prop()
    procoreId: string;

    @Prop()
    name: string;

    @Prop()
    businessPhone: string;

    @Prop()
    mobilePhone: string;

    @Prop()
    address: string;

    @Prop()
    address2: string;

    @Prop()
    city: string;

    @Prop()
    zip: string;

    @Prop()
    stateCode: string;

    @Prop()
    countryCode: string;

    @Prop()
    emailAddress: string;

    @Prop()
    faxNumber: string;

    @Prop()
    logo: string;

    @Prop()
    companyType?: "customer" | "vendor";


    @Prop({type: mongoose.Schema.Types.ObjectId, ref: 'Contact'})
    primaryContact?: Contact;

    @Prop({type: [mongoose.Schema.Types.ObjectId], ref: 'Contact'})
    billingContacts?: Contact[];



}


export const CompanySchema = SchemaFactory.createForClass(Company);