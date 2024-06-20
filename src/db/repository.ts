import mongoose, {Model} from "mongoose";
import {Account} from "../entities/account.entity";
import {Company} from "../entities/company.entity";
import {Project} from "../entities/project.entity";
import {Office} from "../entities/office.entity";
import {Contact} from "../entities/contact.entity";
import {PrimeContract} from "../entities/primeContract.entity";
import {Attachment} from "../entities/attachment.entity";

export abstract class IGenericRepository<T> {
    abstract findAll(account?:Account): Promise<T[]>;
    abstract findById(id: string | mongoose.Types.ObjectId): Promise<T>;
    abstract findOne(query: any): Promise<T>;
    abstract find(query: any): Promise<T[]>;
    abstract create(entity: IGenericCreateDto): Promise<T>;
    abstract update(id: string, entity: IGenericUpdateDto): Promise<T>;
    abstract delete(id: string): Promise<T>;
}

export abstract class IDataServices {
    abstract accounts: IGenericRepository<Account>;
    abstract companies: IGenericRepository<Company>;
    abstract projects: IGenericRepository<Project>;
    abstract offices: IGenericRepository<Office>;
    abstract contacts: IGenericRepository<Contact>;
    abstract primeContracts: IGenericRepository<PrimeContract>;
    abstract attachments: IGenericRepository<Attachment>;
}

export class MongoGenericRepository<T> implements IGenericRepository<T> {
    private _repository: Model<T>;
    private _populateOnFind: string[];

    constructor(repository: Model<T>, populateOnFind: string[]) {
        this._repository = repository;
        this._populateOnFind = populateOnFind;
    }

    async findAll(account?: Account): Promise<T[]> {
        return this._repository.find().populate(this._populateOnFind).exec();
    }

    async findOne(query: any): Promise<T> {
        // @ts-ignore
        return this._repository.findOne(query).populate(this._populateOnFind).exec();
    }

    async findById(id: string): Promise<T> {
        // @ts-ignore
        return this._repository.findById(id).populate(this._populateOnFind).exec();
    }

    async find(query: any): Promise<T[]> {
        return this._repository.find(query).populate(this._populateOnFind).exec();
    }

    async create(entity: IGenericCreateDto): Promise<T> {
        return this._repository.create(entity);
    }

    async update(id: string, entity: IGenericUpdateDto): Promise<T> {
        return this._repository.findByIdAndUpdate(id, entity).exec();
    }

    async delete(id: string): Promise<T> {
        return this._repository.findByIdAndDelete(id).exec();
    }
}

export interface IGenericDto {}

export interface IGenericUpdateDto extends IGenericDto {}

export interface IGenericCreateDto extends IGenericDto {}