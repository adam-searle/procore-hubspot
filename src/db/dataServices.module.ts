import {Module} from '@nestjs/common';
import {MongooseModule} from '@nestjs/mongoose';
import {IDataServices} from "./repository";
import {MongoDataServices} from "./dataServices";
import {ConfigModule} from "@nestjs/config";
import {Account, AccountSchema} from "../entities/account.entity";
import {Project, ProjectSchema} from "../entities/project.entity";
import {Company, CompanySchema} from "../entities/company.entity";
import {Office, OfficeSchema} from "../entities/office.entity";
import {Contact, ContactSchema} from "../entities/contact.entity";
import {PrimeContract, PrimeContractSchema} from "../entities/primeContract.entity";
import {Attachment, AttachmentSchema} from "../entities/attachment.entity";

@Module({
    imports: [
        ConfigModule.forRoot({isGlobal: true}),
        MongooseModule.forFeature([
            {name: Account.name, schema: AccountSchema},
            {name: Project.name, schema: ProjectSchema},
            {name: Company.name, schema: CompanySchema},
            {name: Office.name, schema: OfficeSchema},
            {name: Contact.name, schema: ContactSchema},
            {name: PrimeContract.name, schema: PrimeContractSchema},
            {name: Attachment.name, schema: AttachmentSchema}
        ]),
        MongooseModule.forRoot(process.env.MONGO_CONNECT_URL)
    ],
    providers: [
        {
            provide: IDataServices,
            useClass: MongoDataServices
        }
    ],
    exports: [IDataServices]
})
export class DataServicesModule {}