import {Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, {Document} from 'mongoose';
import {Project} from "./project.entity";

@Schema()
export class Attachment extends Document {

    @Prop({required: true, index: true})
    hsId: string;

    @Prop()
    procoreId: string;

    @Prop()
    hsDocumentObjectId: string;

    @Prop()
    hsNoteId: string;

    @Prop()
    localPath: string;

    @Prop({required: true})
    filename: string;

    @Prop({required: true})
    extension: string;

    @Prop({required: true})
    url: string;

    @Prop()
    data: string

    @Prop({required: true})
    fileOrigin: string;

    @Prop()
    procoreCreateDate: number;

    @Prop()
    createdBy: string

    @Prop()
    documentType: string;

    @Prop({type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true})
    project: Project
}


export const AttachmentSchema = SchemaFactory.createForClass(Attachment);