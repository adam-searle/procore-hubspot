import {Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, {Document} from 'mongoose';
import {Company} from "./company.entity";
import {Contact} from "./contact.entity";
import {Project} from "./project.entity";

@Schema()
export class PrimeContract extends Document {

    @Prop()
    procoreId: string;

    @Prop()
    hsId: string;

    @Prop()
    actualCompletionDate: number;

    @Prop()
    approvalLetterDate: number;

    @Prop()
    approvedChangeOrders: number;

    @Prop()
    billTo: String;

    @Prop()
    contractDate: number;

    @Prop()
    contractEstimatedCompletionDate: number;

    @Prop()
    contractStartDate: number;

    @Prop()
    contractTerminationDate: number;

    @Prop()
    issuedOnDate: number;

    @Prop()
    letterOfIntentDate: number;

    @Prop()
    projectId: number;

    @Prop()
    signedContractReceivedDate: number;

    @Prop()
    status: String;

    @Prop()
    title: String;

    @Prop()
    createdAt: number;

    @Prop()
    deliveryDate: number;

    @Prop()
    description: String;

    @Prop()
    draftChangeOrdersAmount: String;

    @Prop()
    exclusions: String;

    @Prop()
    hsStatus: String;


    @Prop({type: mongoose.Schema.Types.ObjectId, ref: 'Company'})
    company: Company

    @Prop({type: mongoose.Schema.Types.ObjectId, ref: 'Contact'})
    contact: Contact;

    @Prop({type: mongoose.Schema.Types.ObjectId, ref: 'Project'})
    project: Project

}


export const PrimeContractSchema = SchemaFactory.createForClass(PrimeContract);