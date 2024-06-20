import {Injectable, OnApplicationBootstrap} from "@nestjs/common";
import {IDataServices, MongoGenericRepository} from "./repository";
import {Model} from "mongoose";
import {InjectModel} from "@nestjs/mongoose";

import {Account} from "../entities/account.entity";
import {Company} from "../entities/company.entity";
import {Project} from "../entities/project.entity";
import {Office} from "../entities/office.entity";
import {PrimeContract} from "../entities/primeContract.entity";
import {Contact} from "../entities/contact.entity";
import {Attachment} from "../entities/attachment.entity";


@Injectable()
export class MongoDataServices implements IDataServices, OnApplicationBootstrap {
    accounts: MongoGenericRepository<Account>;
    companies: MongoGenericRepository<Company>;
    projects: MongoGenericRepository<Project>;
    offices: MongoGenericRepository<Office>;
    primeContracts: MongoGenericRepository<PrimeContract>;
    contacts: MongoGenericRepository<Contact>;

    attachments: MongoGenericRepository<Attachment>


    constructor(
        @InjectModel(Account.name) private readonly accountRepository: Model<Account>,
        @InjectModel(Company.name) private readonly companyRepository: Model<Company>,
        @InjectModel(Project.name) private readonly projectRepository: Model<Project>,
        @InjectModel(Office.name) private readonly officeRepository: Model<Office>,
        @InjectModel(Contact.name) private readonly contactRepository: Model<Contact>,
        @InjectModel(PrimeContract.name) private readonly primeContractRepository: Model<PrimeContract>,
        @InjectModel(Attachment.name) private readonly attachmentRepository: Model<Attachment>,

    ) {}

    onApplicationBootstrap() {
        this.accounts = new MongoGenericRepository<Account>(this.accountRepository, []);
        this.companies = new MongoGenericRepository<Company>(this.companyRepository, []);
        this.projects = new MongoGenericRepository<Project>(this.projectRepository, ['contact', 'company', 'primeContract', 'contacts']);
        this.offices = new MongoGenericRepository<Office>(this.officeRepository, []);
        this.primeContracts = new MongoGenericRepository<PrimeContract>(this.primeContractRepository, ['company']);
        this.contacts = new MongoGenericRepository<Contact>(this.contactRepository, ['company']);
        this.attachments = new MongoGenericRepository<Attachment>(this.attachmentRepository, []);

    }
}
