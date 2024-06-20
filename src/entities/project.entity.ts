import {Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, {Document} from 'mongoose';
import {Company} from "./company.entity";
import {Office} from "./office.entity";
import {PrimeContract} from "./primeContract.entity";
import {Contact} from "./contact.entity";

@Schema()
export class Project extends Document {

    @Prop()
    hsId: string;

    @Prop()
    procoreId: string;

    @Prop()
    name: string;

    @Prop()
    amount: number;

    @Prop()
    code: string;

    @Prop()
    active: boolean;

    @Prop()
    logoUrl: string;

    @Prop()
    photoUrl: string;

    //hs close date - set to end of current month
    @Prop({type: Date})
    closeDate: Date;

    @Prop({type: Date})
    startDate: Date;

    @Prop({type: Date})
    completionDate: Date;

    @Prop({type: Date})
    actualStartDate: Date;

    @Prop({type: Date})
    projectedFinishDate: Date;

    @Prop()
    dealstage: string;

    //determine whether project was created in procore before closed won
    @Prop()
    initialStage: string;

    @Prop()
    procoreStage: string;

    //hs property: department
    @Prop()
    type: string;

    @Prop()
    projectNumber: string;

    @Prop()
    quickbooksId: string;

    @Prop()
    description: string;

    @Prop()
    country: string;

    @Prop()
    timezone: string;

    @Prop()
    address: string;

    @Prop()
    city: string;

    @Prop()
    state: string;

    @Prop()
    zip: string;

    @Prop()
    latitude: string;

    @Prop()
    longitude: string;

    //hs property: associated company phone
    @Prop()
    phone: string;

    @Prop()
    officeName: string;

    @Prop()
    departments: string[];

    @Prop()
    department: string;

    @Prop()
    types: string[];

    @Prop()
    flag: string;

    @Prop()
    bidType: string;

    @Prop()
    ownerType: string;

    @Prop()
    copyDirectoryForm: string;

    @Prop()
    useTaxCodes: string;

    @Prop()
    language: string;

    @Prop()
    enableDocusign: boolean;

    @Prop()
    preventOverbilling: boolean;

    @Prop()
    nonCommitmentCosts: boolean;

    @Prop()
    testProject: boolean;

    @Prop()
    laborProductivity: boolean;

    @Prop()
    firstName: string;

    @Prop()
    lastName: string;

    @Prop()
    companyName: string;

    @Prop()
    procoreTotalValue: number;

    @Prop()
    procoreStatus: string;

    @Prop()
    procoreEstimatedStartDate: number;

    @Prop()
    procoreEstimatedCompletionDate: number;

    @Prop()
    procoreEstimatedValue: number;

    @Prop()
    procoreActualStartDate: number;

    @Prop()
    procoreProjectedFinishDate: number;

    @Prop()
    procoreFolderId: string;

    @Prop()
    needsHsUpdate: boolean;

    @Prop()
    hsOwnerId: string;

    @Prop()
    hsOwnerEmail: string;

    @Prop({type: mongoose.Schema.Types.ObjectId, ref: 'Contact'})
    contact: Contact;

    @Prop({type: mongoose.Schema.Types.ObjectId, ref: 'Company'})
    company: Company

    @Prop({type: mongoose.Schema.Types.ObjectId, ref: 'Office'})
    office: Office

    @Prop({type: mongoose.Schema.Types.ObjectId, ref: 'PrimeContract'})
    primeContract: PrimeContract

    @Prop({type: [mongoose.Schema.Types.ObjectId], ref: 'Contact'})
    contacts: Contact[];

}


export const ProjectSchema = SchemaFactory.createForClass(Project);