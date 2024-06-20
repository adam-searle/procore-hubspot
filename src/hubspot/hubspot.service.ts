import { Injectable } from '@nestjs/common';
import * as Hubspot from '@hubspot/api-client';
import { IDataServices } from "../db/repository";
import { AuthService } from "../auth/auth.service";
import { Account } from "../entities/account.entity";
import {Project} from "../entities/project.entity";
import {Company} from "../entities/company.entity";
import {FilterOperatorEnum, SimplePublicObjectWithAssociations} from "@hubspot/api-client/lib/codegen/crm/companies";
import {ProcoreService} from "../procore/procore.service";
import {Contact} from "../entities/contact.entity";
import {PrimeContract} from "../entities/primeContract.entity";
import {SimplePublicObjectInput} from "@hubspot/api-client/lib/codegen/crm/deals";



import {DateTime} from "luxon";
import {Cron} from "@nestjs/schedule";
import {Attachment} from "../entities/attachment.entity";
import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import { AssociatedId } from '@hubspot/api-client/lib/codegen/crm/contacts'
import { count } from 'console'

@Injectable()
export class HubspotService {
   // redirectUrl = process.env.SERVER_URL + process.env.HUBSPOT_REDIRECT_PATH;

    @Cron('45 * * * * *')
    async handleCron() {
        let projectsToUpdate = await this.dataServices.projects.find({needsHsUpdate: true});

        for (let p of projectsToUpdate){
            let account = await this.dataServices.accounts.findOne({});
            await this.writeDealUpdate(p, account);
            p.needsHsUpdate = false;
            await p.save();
        }
    }

    redirectUrl = 'https://procore.hubwidget.com/hubspot/redirect'

    constructor(private dataServices: IDataServices, private authService: AuthService, private procoreService: ProcoreService){}

    async getClient(account: Account): Promise<Hubspot.Client> {
        if (account.hsTokenExpiry < new Date()) {
            await this.refreshToken(account);
        }
        return new Hubspot.Client({accessToken: account.hsToken});
    }

    async refreshToken(account: Account) {
        const client = new Hubspot.Client({})
        const tokenResponse = await client.oauth.tokensApi.createToken('refresh_token', null, null, process.env.HUBSPOT_CLIENT_ID, process.env.HUBSPOT_CLIENT_SECRET, account.hsRefreshToken);
        if (tokenResponse && tokenResponse.accessToken){
            account.hsToken = tokenResponse.accessToken;
            account.hsTokenExpiry = new Date(Date.now() + (tokenResponse.expiresIn * 1000));
            account.hsRefreshToken = tokenResponse.refreshToken;
            await account.save();
        }
    }

    async authorize(code: string, account: Account): Promise<Account> {
        if (!account){
            throw new Error("Invalid account");
        }

        const client = new Hubspot.Client({});
        const tokenResponse = await client.oauth.tokensApi.createToken('authorization_code', code, this.redirectUrl, process.env.HUBSPOT_CLIENT_ID, process.env.HUBSPOT_CLIENT_SECRET);
        if (tokenResponse && tokenResponse.accessToken){
            account.hsToken = tokenResponse.accessToken;
            account.hsTokenExpiry = new Date(Date.now() + ((tokenResponse.expiresIn * 1000) - 1000));
            account.hsRefreshToken = tokenResponse.refreshToken;
            const portalInfo = await this.getPortalInfo(account);
            // @ts-ignore
            account.portalId = portalInfo.portalId;
            await account.save();
        }
        return account;
    }
    async getPortalInfo(account: Account){
        const client = await this.getClient(account);

        const detailsResult = await client.apiRequest({
            path: '/account-info/v3/details',
            method: 'GET'
        });
        console.log("Get portal info result", detailsResult.body);
        return detailsResult.body;
    };

    async getInstallUrl(account: Account): Promise<string> {
        const client = new Hubspot.Client({})
       // const state = await this.authService.signOauthState(account);
        const state = account._id;
        return client.oauth.getAuthorizationUrl(process.env.HUBSPOT_CLIENT_ID,this.redirectUrl, process.env.HUBSPOT_SCOPES, null, state);
    }

    async handleCompanyUpdateWebhook(companyId: string, account: Account){
        const company = await this.getCompany(companyId, account);
        await this.procoreService.updateVendorInCompanyDirectory(company, account);
    }

    async handleProjectCreationWebhook(dealId: string, account: Account){
        const dealData = await this.getDeal(dealId, account);
        if ((dealData.properties.procore_refresh !== 'true' && dealData.properties.create_in_procore !== 'true')) {
            console.log("Ignore project, not scheduled for creation in procore", dealData);
            return;
        }
        const project = await this.processDeal(dealData, account);
        let company;
        let contact;

        console.log("Handle project creation webhook", JSON.stringify(dealData));
        let contacts = [];

        if (dealData.associations.companies && dealData.associations.companies.results.length){
            let companyId = dealData.associations.companies.results[0].id;
            company = await this.getCompany(companyId, account);
            project.company = company;
            await company.save();
        }

        if (dealData.associations.contacts && dealData.associations.contacts.results.length){
            for (let cid of dealData.associations.contacts.results){
                let contact = await this.getContact(cid.id, company, account);
                contacts.push(contact);
            }
            project.contacts = contacts;
            await project.save();


            let contactId = dealData.associations.contacts.results[0].id;
            if (dealData.associations.contacts.results[0].type === 'project_contact'){
                contact = await this.getContact(contactId, company, account);
                project.contact = contact;
                await project.save();
            }
        }



        if (!project.projectNumber){
            const dealData = await this.getDeal(dealId, account);
            project.projectNumber = dealData.properties.project_id;

        }

        console.log("Project", project);

        if (project.procoreId){
            await this.procoreService.updateProject(project, account);
        } else {
            await this.procoreService.createProject(project, account);
        }

        await this.procoreService.processProjectFiles(project, account);


        let primeContract = await this.processPrimeContract(project, company, contact, dealData, account);
        project.primeContract = primeContract;
        await project.save();

        await this.procoreService.createAllForProject(project, account);
    }

    async getDeal(dealId: string, account: Account){
        const client = await this.getClient(account);

        const dealData = await client.crm.deals.basicApi.getById(dealId, [
            'dealname',
            'amount',
            'dealstage',
            'pipeline',
            'closedate',
            'department',
            'project_id',
            'description',
            'project_street_address',
            'project_city',
            'project_state',
            'state_code',
            'project_postal_code',
            'latitude',
            'longitude',
            'office_location',
            'departments',
            'department',
            'procore_id',
            'hubspot_owner_id',
            'procore_refresh',
            'create_in_procore',
            'procore_estimated_start_date',
            'type'
        ], null, ['COMPANY', 'CONTACT']);
        console.log("Got deal data", dealData);
        return dealData;
    }

    async getContact(contactId: string, company: Company, account: Account): Promise<Contact> {
        const client = await this.getClient(account);
        const contactData = await client.crm.contacts.basicApi.getById(contactId, ['firstname', 'lastname', 'phone', 'address', 'mobile', 'zip', 'fax', 'city', 'state', 'email'], null, ['COMPANY', 'CONTACT']);
        console.log("Got contact data", contactData);
        return this.processContact(contactData, company, account);
    }


    async getCompany(companyId: string, account: Account): Promise<Company>{
        console.log("Get company", companyId);
        const client = await this.getClient(account);
        const companyData = await client.crm.companies.basicApi.getById(companyId, ['phone', 'name', 'address', 'city', 'state', 'zip', 'phone', 'fax']);
        console.log("Get company data", companyData);
        return this.processCompany(companyData, account);
    }

    /*
    This is used by the customer portal details update webhook
     */
    async getCompanyContacts(company: Company, account: Account): Promise<Contact[]> {
        const client = await this.getClient(account);
        const companyData = await client.crm.companies.basicApi.getById(company.hsId, ['phone', 'name', 'address', 'city', 'state', 'zip', 'phone', 'fax'], null, ['CONTACT']);
        let contacts: Contact[] = [];
        if (companyData.associations && companyData.associations.contacts && companyData.associations.contacts.results){
            for (let c of companyData.associations.contacts.results){
                const contact = await this.getContact(c.id, company, account);
                contacts.push(contact);
            }
        }
        return contacts;
    }

    async processPrimeContract(project: Project, company: Company, contact: Contact, dealData: SimplePublicObjectWithAssociations, account: Account): Promise<PrimeContract> {
        let primeContract = await this.dataServices.primeContracts.findOne({hsId: dealData.id});
        if (!primeContract){
            primeContract = await this.dataServices.primeContracts.create({
                hsId: dealData.id,
                contractDate: new Date(dealData.properties.closedate).getTime(),
                projectId: project.procoreId,
                grandTotal: dealData.properties.amount,
                title: dealData.properties.dealname,
                project,
                company,
                contact,
                hsStatus: project.dealstage
            });
        } else {
            primeContract.project = project;
            primeContract.company = company;
            primeContract.contact = contact;
            await primeContract.save();
        }

        return primeContract;
    }

    async processDeal(dealData: SimplePublicObjectWithAssociations, account: Account): Promise<Project>{
        console.log("Process deal", dealData);
        let project = await this.dataServices.projects.findOne({hsId: dealData.id});

        if (!project){
            console.log("Process Deal, create new project");
            project = await this.dataServices.projects.create({
                name: dealData.properties.dealname,
                amount: dealData.properties.amount,
                dealstage: dealData.properties.dealstage,
                initialStage: dealData.properties.dealstage,
                closeDate: new Date(dealData.properties.closedate),
                department: dealData.properties.department,
                projectNumber: dealData.properties.project_id,
                description: dealData.properties.description,
                address: dealData.properties.project_street_address,
                city: dealData.properties.project_city,
                state: dealData.properties.state_code,
                zip: dealData.properties.project_postal_code,
                latitude: dealData.properties.latitude,
                longitude: dealData.properties.longitude,
                officeName: dealData.properties.office_location,
                departments: dealData.properties.departments,
                hsOwnerId: dealData.properties.hubspot_owner_id,
                hsId: dealData.id
            });

            if (dealData.properties.type){
                let types = dealData.properties.type.split(';');
                project.types = types;
            }

            let office = await this.dataServices.offices.findOne({account, name: dealData.properties.office_location});

            if (!office){
                office = await this.dataServices.offices.create({account, name: dealData.properties.office_location});
            }

            project.office = office;

            project.hsId = dealData.id;

            await project.save();
            console.log("Created project", project);
            try {
                await this.getOwner(project, account);
            } catch (err){
                console.error("Error assigning owner", err);
            }

        } else {
            console.log("Process deal, update existing", project);
            project.name = dealData.properties.dealname;
            project.amount = parseFloat(dealData.properties.amount || '0');
            project.dealstage = dealData.properties.dealstage;
            project.closeDate = new Date(dealData.properties.closedate);
            project.department = dealData.properties.department;
            project.projectNumber = dealData.properties.project_id;
            project.description = dealData.properties.description;
            project.address = dealData.properties.project_street_address;
            project.city = dealData.properties.project_city;
            project.state = dealData.properties.state_code;
            project.zip = dealData.properties.project_postal_code;
            project.latitude = dealData.properties.latitude;
            project.longitude = dealData.properties.longitude;

            if (dealData.properties.type){
                let types = dealData.properties.type.split(';');
                project.types = types;
            }
            await project.save();
            console.log("Project data updated to", project);
        }

        if (dealData.associations) {
            if (dealData.associations.companies && dealData.associations.companies.results.length > 0) {
                console.log("dealData.associations.companies.results", dealData.associations.companies.results);
                console.log("Process deal, get company", dealData.associations.companies.results[0].id);
                project.company = await this.getCompany(dealData.associations.companies.results[0].id, account);
            }
        }

        return project
    }

    /*
    Create a company in the local db from the hubspot data
     */
    async processCompany(companyData: SimplePublicObjectWithAssociations, account: Account): Promise<Company> {
        let company = await this.dataServices.companies.findOne({hsId: companyData.id});
        const properties = {
            name: companyData.properties.name,
            hsId: companyData.id,
            businessPhone: companyData.properties.phone,
            address: companyData.properties.address,
            address2: companyData.properties.address2,
            city: companyData.properties.city,
            emailAddress: companyData.properties.general_email,
            zip: companyData.properties.zip,
            fax: companyData.properties.fax,
            companyType: companyData.properties.lifecyclestage === "customer" ? "customer" : "vendor" as "customer" | "vendor",
            primaryContact: null,
            countryCode: companyData.properties.country ? convertCountryCode(companyData.properties.country) : null,
            stateCode: companyData.properties.state ? convertStateCode(convertCountryCode(companyData.properties.country), companyData.properties.state) : null,
            billingContacts: [] as Contact[]
        }

        console.log("processCompany properties", properties)
        if (!company) {
            console.log("Create company", properties);
            company = await this.dataServices.companies.create(properties);
            console.log("Company created", company);
        } else {
            console.log("Update company", properties);
            company = await this.dataServices.companies.update(company.id, properties);
        }

        if (companyData.associations && companyData.associations.contacts && companyData.associations.contacts.results){
            let primary_contact_hs: AssociatedId | null = companyData.associations.contacts.results.find(contact => contact.type === 'primary_contact');
            if (primary_contact_hs) {
                let primary_contact = await this.handle_contact_update_webhook(primary_contact_hs.id, account); // will add as primary contact
                await sleep(300);
                properties.primaryContact = primary_contact._id;
            }
            // add all billing contacts
            for (let hs_contact of companyData.associations.contacts.results) {
                if (hs_contact.type === 'billing_contact') {
                    let billing_contact = await this.handle_contact_update_webhook(hs_contact.id, account); // will add as contact
                    properties.billingContacts.push(billing_contact._id);
                    await sleep(300);
                }
            }
        }

        company = await this.dataServices.companies.update(company.id, properties);

        company.name = properties.name;
        company.businessPhone = properties.businessPhone;
        company.address = properties.address;
        company.city = properties.city;
        company.zip = properties.zip;
        company.emailAddress = properties.emailAddress;
        company.faxNumber = properties.fax;
        company.companyType = properties.companyType;
        company.primaryContact = properties.primaryContact;
        company.billingContacts = properties.billingContacts;
        company.countryCode = properties.countryCode;
        company.stateCode = properties.stateCode;
        console.log("Company updated", company)

        return company;
    }

    /*
    Create a contact in the local db from the hubspot data
     */
    async processContact(contactData: SimplePublicObjectWithAssociations, company: Company, account: Account, company_certainly_didnt_exist = false): Promise<Contact> {
        let contact = await this.dataServices.contacts.findOne({hsId: contactData.id});

        console.log("Process contact", contactData, contact);

        if (!contact){
            const properties = {
                firstName: contactData.properties.firstname,
                lastName: contactData.properties.lastname,
                email: contactData.properties.email,
                hsId: contactData.id,
                address: contactData.properties.address,
                zip: contactData.properties.zip,
                phone: contactData.properties.phone,
                mobilePhone: contactData.properties.mobilephone,
                city: contactData.properties.city,
                jobTitle: contactData.properties.jobtitle,
                company
            }

            contactData.properties.state ? properties["stateCode"] = convertStateCode(convertCountryCode(contactData.properties.country), contactData.properties.state) : null;
            contactData.properties.country ? properties["countryCode"] = convertCountryCode(contactData.properties.country) : null;
            contact = await this.dataServices.contacts.create(properties);

           /* if (contactData.associations && contactData.associations.companies && contactData.associations.companies.results && contactData.associations.companies.results[0]){
                let companyId = contactData.associations.companies.results[0].id;

                let company = await this.dataServices.companies.findOne({hsId: companyId});
                if (!company){
                    company = await this.getCompany(companyId, account);
                }

                contact.company = company;
                await contact.save();
            }*/

        } else { // else update
            const properties = {
                firstName: contactData.properties.firstname,
                lastName: contactData.properties.lastname,
                email: contactData.properties.email,
                address: contactData.properties.address,
                zip: contactData.properties.zip,
                phone: contactData.properties.phone,
                mobilePhone: contactData.properties.mobilephone,
                city: contactData.properties.city,
                jobTitle: contactData.properties.jobtitle,
                company
            }
            contactData.properties.state ? properties["stateCode"] = convertStateCode(convertCountryCode(contactData.properties.country), contactData.properties.state) : null;
            contactData.properties.country ? properties["countryCode"] = convertCountryCode(contactData.properties.country) : null;

            company_certainly_didnt_exist ? properties["procoreId"] = null : null;
            contact = await this.dataServices.contacts.update(contact.id, properties);
            // Reload contact to ensure it has the latest data
            // only doing it like this because await this.dataServices.contacts.getById returned the wrong user ???
            // weird
            contact.firstName = contactData.properties.firstname;
            contact.lastName = contactData.properties.lastname;
            contact.email = contactData.properties.email;
            contact.address = contactData.properties.address;
            contact.zip = contactData.properties.zip;
            contact.phone = contactData.properties.phone;
            contact.mobilePhone = contactData.properties.mobilephone;
            contact.company = company;
            contact.city = contactData.properties.city;
            contact.jobTitle = contactData.properties.jobtitle;
            contact.phone = contactData.properties.phone;
            contact.stateCode = properties["stateCode"] ? properties["stateCode"] : null;
            contact.countryCode = properties["countryCode"] ? properties["countryCode"] : null;
            contact.procoreId = properties["procoreId"] ? properties["procoreId"] : contact.procoreId;
        }
        return contact;
    }

    async getOwner(project: Project, account: Account): Promise<string> {

        if (project.hsOwnerEmail) return project.hsOwnerEmail;
        const client = await this.getClient(account);
        let deal = await this.getDeal(project.hsId, account);
        const ownerData = await client.crm.owners.ownersApi.getById(parseInt(project.hsOwnerId));
        if (ownerData && ownerData.email){
            project.hsOwnerEmail = ownerData.email;
            await project.save();
            return ownerData.email;
        }
    }



    async writeDealUpdate(project: Project, account: Account){
        console.log("Write deal update", project);
        if (project.id === '116773'){
            return;
        }
        const client = await this.getClient(account);
        let properties: any = {
            procore_total_value: project.procoreTotalValue,
            was_this_bid_in_procore_test: true,
            procore_status_text: project.procoreStage,
            procore_id: project.procoreId,
            procore_estimated_start_date: midnightFromMs(project.procoreEstimatedStartDate),
            procore_estimated_completion_date: midnightFromMs(project.procoreEstimatedCompletionDate),
            procore_estimated_value: project.procoreEstimatedValue,
            procore_projected_finish_date: midnightFromMs(project.procoreProjectedFinishDate),
            procore_actual_start_date: midnightFromMs(project.procoreActualStartDate)
        }

        // @ts-ignore
        const updateDealResponse = await client.crm.deals.basicApi.update(project.hsId, {
            properties
        });

        await this.readAttachmentsForProject(project, account);

        console.log("Update deal response", updateDealResponse);
    }

    async readAttachmentsForProject(project: Project, account: Account): Promise<Attachment[]>{
        try {
            const client = await this.getClient(account);
            const dealResponse = await client.crm.deals.basicApi.getById(project.hsId, null, null, ['NOTES', 'EMAILS', 'TASKS', '2-16233260']);
            if (!dealResponse || !dealResponse.associations){
                return;
            }

           //await this.processDealEngagement('NOTE', dealResponse, project, account);
          //  await this.processDealEngagement('EMAIL', dealResponse, project, account);
           // await this.processDealEngagement('TASK', dealResponse, project, account);
            await this.processProjectDocuments(dealResponse, project, account);

            return this.dataServices.attachments.find({project});
        } catch (err){
            console.error("Error reading attachments", err);
        }
    }


/*
    async processDealEngagement(engagementType: string, dealData: SimplePublicObjectWithAssociations, project: Project, account: Account){
        console.log(`Process deal engagement type ${engagementType}`, dealData);
        let engagementCollection = engagementType.toLowerCase() + 's';
        const client = await this.getClient(account);
        if (dealData.associations && dealData.associations[engagementCollection] && dealData.associations[engagementCollection].results){
            for (let engagementId of dealData.associations[engagementCollection].results){
                let engagementResponse = await client.crm.objects.basicApi.getById(engagementType, engagementId.id, ['hs_attachment_ids']);
                if (engagementResponse && engagementResponse.properties.hs_attachment_ids){
                    console.log("Attachment ids", engagementResponse.properties.hs_attachment_ids);
                    let attachmentIds = engagementResponse.properties.hs_attachment_ids.split(';');
                    for (let at of attachmentIds){
                        await this.processAttachment(at, project, client, account, null, null);
                    }
                }
            }
        }
    }*/

    async processDocumentNote(noteId: string, documentId: string, project: Project, account: Account){
        const client = await this.getClient(account);
        let noteResponse = await client.crm.objects.basicApi.getById('NOTE', noteId, ['hs_attachment_ids']);
        if (noteResponse && noteResponse.properties.hs_attachment_ids){
            console.log("Attachment ids", noteResponse.properties.hs_attachment_ids);
            let attachmentIds = noteResponse.properties.hs_attachment_ids.split(';');
            for (let at of attachmentIds){
                await this.processAttachment(at, project, client, account, documentId);
            }
        }
    }

    async processProjectDocuments(dealData: SimplePublicObjectWithAssociations, project: Project, account: Account){
        console.log(`Process project documents`, dealData);
        const client = await this.getClient(account);
        if (dealData.associations && dealData.associations['2-16233260'] && dealData.associations['2-16233260'].results){
            for (let documentId of dealData.associations['2-16233260'].results){
                let documentResponse = await client.crm.objects.basicApi.getById('2-16233260', documentId.id, [], ['NOTE']);
                if (documentResponse && documentResponse.associations && documentResponse.associations.notes && documentResponse.associations.notes.results){
                    for (let a of documentResponse.associations.notes.results){
                        await this.processDocumentNote(a.id, documentId.id, project, account);
                    }
                }
            }
        }
    }

    async processAttachment(attachmentId: string, project: Project, client, account:Account, hsDocumentObjectId: string){
        console.log("Get attachment by id", attachmentId);
        let attachment= await client.files.filesApi.getById(attachmentId);
        console.log("Attachment response", attachment);
        let existingAttachment = await this.dataServices.attachments.findOne({hsId: attachment.id, project});
        if (!existingAttachment) {
            existingAttachment = await this.dataServices.attachments.create({
                hsId: attachment.id,
                filename: attachment.name,
                url: attachment.url,
                extension: attachment.extension,
               // documentType: attachment.documentType,
                project,
                hsDocumentObjectId,
                fileOrigin: 'hubspot'
            });
            await this.getFileWithSignedAccess(existingAttachment, account);
            await this.procoreService.createProjectFile(project, existingAttachment, account);
        }
    }

    /*
    Download a file from hubspot file manager using a signed url
     */
    async getFileWithSignedAccess(attachment: Attachment, account: Account){
        const client = await this.getClient(account);
        const signedUrl = await client.files.filesApi.getSignedUrl(attachment.hsId);
        let file = await axios.get(signedUrl.url, {responseType: 'arraybuffer'});
        const filepath = path.resolve('./filestorage/' + attachment.hsId);
        console.log("WRITE FILE", filepath);
        fs.writeFileSync(filepath, file.data);
        return signedUrl;
    }

    async syncAttachmentsFromProcore(account: Account){
        let attachments = await this.dataServices.attachments.find({hsDocumentObjectId: null, procoreId: {$ne: null}});
        for (let attachment of attachments){
            await this.createDocumentObject(attachment, account);
        }
    }

    async processProjectDocumentWebhook(body: any){
        const account = await this.dataServices.accounts.findOne({});
        const client = await this.getClient(account);
        let documentId = body.hs_object_id;
        let document = await client.crm.objects.basicApi.getById(process.env.HUBSPOT_DOCUMENT_OBJECT_ID, documentId, ['document_type'], null, ['DEAL', 'NOTE']);
        console.log("Document", document);
        let project = await this.dataServices.projects.findOne({hsId: document.associations.deals.results[0].id});
        if (!project){
            throw new Error(`Project not found for document ${documentId}`);
        }
        if (document && document.associations.notes && document.associations.notes.results){
            for (let note of document.associations.notes.results){
                await this.processDocumentNote(note.id, documentId, project, account);
            }
        }

    }

    /*
    Create document custom object to store the document/attachment
     */
    async createDocumentObject(attachment: Attachment, account: Account){
        let properties = {
            name: `${attachment.project.name} - ${attachment.filename}.${attachment.extension}`,
            document_type: attachment.documentType,
            hs_createdate: attachment.procoreCreateDate.toString()
        }
        const client = await this.getClient(account);
        const documentResponse = await client.crm.objects.basicApi.create(process.env.HUBSPOT_DOCUMENT_OBJECT_ID, {properties});
        if (documentResponse && documentResponse.id){
            attachment.hsDocumentObjectId = documentResponse.id;
            await attachment.save();
            await this.uploadFile(attachment, account);
            await this.createNoteForAttachment(attachment, account);
        }
    }

    async createNoteForAttachment(attachment: Attachment, account: Account){
        let properties = {
            hs_timestamp: attachment.procoreCreateDate.toString(),
            hs_note_body: `${attachment.filename}.${attachment.extension} Added by ${attachment.createdBy}`,
            hs_attachment_ids: attachment.hsId
        }

        let associations = [
            {
                to: {
                    id: attachment.hsDocumentObjectId
                },
                types: {
                    associationCategory: 'USER_DEFINED',
                    associationTypeId: process.env.HUBSPOT_DOCUMENT_TO_NOTE_ASSOCIATION_ID
                }
            }
        ]

        const client = await this.getClient(account);
        // @ts-ignore
        const noteResponse = await client.crm.objects.basicApi.create('NOTE', {properties, associations});
        console.log("Create note for attachment response", noteResponse);
        attachment.hsNoteId = noteResponse.id;
        await attachment.save();

    }

    async uploadFile(attachment: Attachment, account: Account): Promise<Attachment> {
        const client = await this.getClient(account);
        const file = fs.readFileSync(attachment.localPath);
        let form = new FormData();
        form.append('file', new Blob([file]), attachment.filename);
        form.append('folderId', process.env.HUBSPOT_PROCORE_FOLDER_ID);
        form.append('fileName', `${attachment.filename}.${attachment.extension}`);
        form.append('options', JSON.stringify({
            "access": "PRIVATE"
        }));
        const uploadResponse = await axios.post('https://api.hubapi.com/files/v3/files/', form, {
            headers: {
                'Authorization': 'Bearer ' + account.hsToken
            }
        });

        if (uploadResponse && uploadResponse.data){
            console.log("Upload response", uploadResponse.data);
            attachment.hsId = uploadResponse.data.id;
            await attachment.save();
        }
        return attachment;
    }

    // FROM THIS POINT DOWN IS LACHY'S CODE. ANYTHING BELOW THIS IS TO BE KEPT CLEAN. -------|
    async get_hubspot_company(company_id: string, account: Account) {
        return (await this.getClient(account)).crm.companies.basicApi.getById(company_id, [
            "lifecyclestage",
            'phone',
            "general_email",
            'name',
            'domain',
            'address',
            'address2',
            'city',
            'state',
            'zip',
            'phone',
            'fax',
            'type',
            "country",
            'company_type'
        ], null, ['CONTACT'])
    }

    async handle_contact_update_webhook(contact_id: string, account: Account, company_certainly_didnt_exist = false): Promise<Contact> {
        await sleep(1000)
        const client = await this.getClient(account);
        let contact = await client.crm.contacts.basicApi.getById(contact_id, ['firstname', 'lastname', 'phone', 'address', 'mobile', 'zip', 'fax', 'city', 'state', "country", 'email', "jobtitle"], null, ['COMPANY', 'CONTACT']);
        console.log("Got contact data", contact);

        let contacts_hubspot_company = await this.get_associated_company(contact.associations.companies.results, account, client);
        if (!contacts_hubspot_company) return

        console.log("contacts_company", contacts_hubspot_company)

        if (this.is_customer_or_vendor(contacts_hubspot_company)) {
            let contacts_company: Company | null = await this.dataServices.companies.findOne({hsId: contacts_hubspot_company.id});
            if (!contacts_company) contacts_company = await this.dataServices.companies.findOne({name: contacts_hubspot_company.properties.name});
            console.log("contacts_company (existing)", contacts_company)
            if (!contacts_company) {
                // contacts_company = await this.processCompany(contacts_hubspot_company, account);
                console.log("contacts_company (new)", contacts_company)
                this.handle_company_update_webhook(contacts_hubspot_company.id, account);
            }
            let updated_contact = await this.processContact(contact, contacts_company, account, company_certainly_didnt_exist); // save to db
            console.log("updated contact after process Contact", updated_contact)
            await this.procoreService.create_or_update_contact(updated_contact, account); // save to procore
            return updated_contact;
        }
    }

    async handle_company_update_webhook(company_id: string, account: Account) {
        await sleep(1000)
        let hs_company = await this.get_hubspot_company(company_id, account);
        console.log("hs_company", hs_company)
        if (hs_company.associations && hs_company.associations.contacts && hs_company.associations.contacts.results && hs_company.associations.contacts.results.length > 0) {
            console.log("hs_company contacts", hs_company.associations.contacts)
        } else {
            console.log("hs_company has no associations")
        }


        if (this.is_customer_or_vendor(hs_company)) {
            let company = await this.dataServices.companies.findOne({hsId: hs_company.id});
            let company_didnt_exist = !company;

            let updated_company = await this.processCompany(hs_company, account);
            await this.procoreService.create_or_update_company(updated_company.id, account);

            if (company_didnt_exist) {
                await sleep(10000);
                hs_company = await this.get_hubspot_company(company_id, account);
                if (hs_company.associations && hs_company.associations.contacts && hs_company.associations.contacts.results && hs_company.associations.contacts.results.length > 0) {
                    // we need to create all of it's associated contacts
                    for (let contact of hs_company.associations.contacts.results) {
                        await this.handle_contact_update_webhook(contact.id, account, company_didnt_exist);
                        await sleep(400);
                    }
                } else {
                    console.log("company has no contacts")
                }
            }
        }
    }

    async get_associated_company(companies: any[], account: Account, client): Promise<SimplePublicObjectWithAssociations> {
        if (companies && companies.length > 0) {
            // if more than 1 find primary
            if (companies.length > 1) {
                for (let company of companies) {
                    if (company.associationLabel && company.associationLabel.toLowerCase() === 'primary') {
                        return await this.get_hubspot_company(company.id, account);
                    }
                }
            }

            return await this.get_hubspot_company(companies[0].id, account);
        }
        return null;
    }

    is_customer_or_vendor(company): boolean {
        if (company && company.properties) {
            return company.properties.lifecyclestage === "customer" || company.properties.lifecyclestage === "34623414" // vendor
            || company.properties.lifecyclestage === "39552113" || company.properties.lifecyclestage === "other" // contractor | other
        }

        return false;
    }

    async create_contact(contact: Contact, account: Account) {
        try {
            const client = await this.getClient(account);
            let create_body: SimplePublicObjectInput = {
                properties: {
                    firstname: contact.firstName,
                    lastname: contact.lastName,
                    email: contact.email,
                    address: contact.address,
                    zip: contact.zip,
                    phone: contact.phone,
                    mobilephone: contact.mobilePhone,
                    city: contact.city,
                    state: contact.stateCode,
                    jobtitle: contact.jobTitle
                }
            };

            console.log("create_body", create_body);

            try {
                const contact_response = await client.crm.contacts.basicApi.create(create_body);
                contact.hsId = contact_response.id;
                contact.save();
                await sleep(1000);
                let contact_id_as_number = parseInt(contact_response.id);
                if (contact.company && contact.company.hsId && contact_id_as_number) {
                    let company_id_as_number = parseInt(contact.company.hsId);
                    if (company_id_as_number) {
                        try {
                            await client.crm.contacts.associationsApi.create(
                                contact_id_as_number,
                                "company",
                                company_id_as_number,
                                [{
                                    associationCategory: "HUBSPOT_DEFINED",
                                    associationTypeId: 1
                                }]
                            );
                        } catch (association_error) {
                            console.log("Error associating contact with company", association_error);
                        }
                    } else {
                        console.log("company_id_as_number is not a number during create contact from procore", company_id_as_number);
                    }
                } else {
                    console.log("something preventing contact creation from procore to associate", contact.company, contact_id_as_number);
                }

                return contact_response;
            } catch (contact_creation_error) {
                console.log("Error creating contact", contact_creation_error);
            }
        } catch (client_error) {
            console.log("Error getting client", client_error);
        }
    }


    async update_contact(contact: Contact, account: Account) {
        try {
            const client = await this.getClient(account);
            try {
                const contact_response = await client.crm.contacts.basicApi.update(contact.hsId, {
                    properties: {
                        firstname: contact.firstName,
                        lastname: contact.lastName,
                        email: contact.email,
                        address: contact.address,
                        zip: contact.zip,
                        phone: contact.phone,
                        mobilephone: contact.mobilePhone,
                        city: contact.city,
                        state: contact.stateCode,
                        jobtitle: contact.jobTitle
                    }
                });
                return contact_response;
            } catch (update_error) {
                console.log("Error updating contact", update_error);
            }
        } catch (client_error) {
            console.log("Error getting client", client_error);
        }
    }

    async create_company(company: Company, account: Account) {
        try {
            const client = await this.getClient(account);
            console.log("company creating to hubspot", company);
            let create_body = {
                properties: {
                    name: company.name,
                    address: company.address,
                    city: company.city,
                    zip: company.zip,
                    phone: company.businessPhone,
                    general_email: company.emailAddress,
                    country: company.countryCode,
                    state: company.stateCode,
                }
            };

            try {
                const company_response = await client.crm.companies.basicApi.create(create_body);
                company.hsId = company_response.id;
                company.save();
                return company_response;
            } catch (company_creation_error) {
                console.log("Error creating company", company_creation_error);
            }
        } catch (client_error) {
            console.log("Error getting client", client_error);
        }
    }

    async update_company(company: Company, account: Account) {
        try {
            const client = await this.getClient(account);
            console.log("company updating to hubspot", company);
            let properties = {
                name: company.name,
                address: company.address,
                city: company.city,
                zip: company.zip,
                phone: company.businessPhone,
                general_email: company.emailAddress,
                country: company.countryCode,
                state: company.stateCode,
            };

            try {
                const company_response = await client.crm.companies.basicApi.update(
                    company.hsId,
                    { properties }
                );
                return company_response;
            } catch (company_update_error) {
                console.log("Error updating company", company_update_error);
            }
        } catch (client_error) {
            console.log("Error getting client", client_error);
        }
    }


    async find_matching_company(company: Company, account: Account): Promise<Company> {
        const client = await this.getClient(account);
        const search_request = {
            filterGroups: [
                {
                    filters: [
                        {
                            propertyName: 'name',
                            operator: "EQ" as FilterOperatorEnum,
                            value: company.name
                        }
                    ]
                }
            ],
            sorts: [],
            properties: [],
            limit: 10,
            after: 0
        };

        try {
            const company_response = await client.crm.companies.searchApi.doSearch(search_request);
            let results = company_response.results;
            console.log("company search results", results)
            if (results.length > 0) {
                if (results.length > 1) {
                    console.log("more than one company with the same name: ", company.name)
                } else {
                    console.log("found company", results[0])
                    company.hsId = results[0].id;
                    company.save();
                }
            }

            return company
        } catch (error) {
            console.error('Error searching for company:', error);
            throw error;
        }
    }
}

function midnightFromMs(dateNum: number): number{
    if (!dateNum){
        return null;
    }
    let date = DateTime.fromMillis(dateNum).set({hour: 0, minute: 0, second: 0})
    return date.toUnixInteger() * 1000;

}

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Country codes based on ISO-3166 Alpha-2
const countryCodes = {
    'united states': 'us',
    'us': 'us',
    'usa': 'us',
    'united states of america': 'us',
    'america': 'us',
    'canada': 'ca',
    'ca': 'ca',
    'united kingdom': 'gb',
    'uk': 'gb',
    'england': 'gb',
    'great britain': 'gb',
    'gb': 'gb',
    'turkey': 'tr',
    'tr': 'tr',
    'mexico': 'mx',
    'mx': 'mx',
    'australia': 'au',
    'au': 'au',
    'italy': 'it',
    'it': 'it',
    'uruguay': 'uy',
    'uy': 'uy',
    'switzerland': 'ch',
    'ch': 'ch'
  };


// State codes for each country
const stateCodes = {
    'us': {
        'alabama': 'al',
        'al': 'al',
        'alaska': 'ak',
        'ak': 'ak',
        'arizona': 'az',
        'az': 'az',
        'arkansas': 'ar',
        'ar': 'ar',
        'california': 'ca',
        'ca': 'ca',
        'colorado': 'co',
        'co': 'co',
        'connecticut': 'ct',
        'ct': 'ct',
        'delaware': 'de',
        'de': 'de',
        'florida': 'fl',
        'fl': 'fl',
        'georgia': 'ga',
        'ga': 'ga',
        'hawaii': 'hi',
        'hi': 'hi',
        'idaho': 'id',
        'id': 'id',
        'illinois': 'il',
        'il': 'il',
        'indiana': 'in',
        'in': 'in',
        'iowa': 'ia',
        'ia': 'ia',
        'kansas': 'ks',
        'ks': 'ks',
        'kentucky': 'ky',
        'ky': 'ky',
        'louisiana': 'la',
        'la': 'la',
        'maine': 'me',
        'me': 'me',
        'maryland': 'md',
        'md': 'md',
        'massachusetts': 'ma',
        'ma': 'ma',
        'michigan': 'mi',
        'mi': 'mi',
        'minnesota': 'mn',
        'mn': 'mn',
        'mississippi': 'ms',
        'ms': 'ms',
        'missouri': 'mo',
        'mo': 'mo',
        'montana': 'mt',
        'mt': 'mt',
        'nebraska': 'ne',
        'ne': 'ne',
        'nevada': 'nv',
        'nv': 'nv',
        'new hampshire': 'nh',
        'nh': 'nh',
        'new jersey': 'nj',
        'nj': 'nj',
        'new mexico': 'nm',
        'nm': 'nm',
        'new york': 'ny',
        'ny': 'ny',
        'north carolina': 'nc',
        'nc': 'nc',
        'north dakota': 'nd',
        'nd': 'nd',
        'ohio': 'oh',
        'oh': 'oh',
        'oklahoma': 'ok',
        'ok': 'ok',
        'oregon': 'or',
        'or': 'or',
        'pennsylvania': 'pa',
        'pa': 'pa',
        'rhode island': 'ri',
        'ri': 'ri',
        'south carolina': 'sc',
        'sc': 'sc',
        'south dakota': 'sd',
        'sd': 'sd',
        'tennessee': 'tn',
        'tn': 'tn',
        'texas': 'tx',
        'tx': 'tx',
        'utah': 'ut',
        'ut': 'ut',
        'vermont': 'vt',
        'vt': 'vt',
        'virginia': 'va',
        'va': 'va',
        'washington': 'wa',
        'wa': 'wa',
        'west virginia': 'wv',
        'wv': 'wv',
        'wisconsin': 'wi',
        'wi': 'wi',
        'wyoming': 'wy',
        'wy': 'wy'
    },
    'ca': {
        'alberta': 'ab',
        'ab': 'ab',
        'british columbia': 'bc',
        'bc': 'bc',
        'manitoba': 'mb',
        'mb': 'mb',
        'new brunswick': 'nb',
        'nb': 'nb',
        'newfoundland and labrador': 'nl',
        'nl': 'nl',
        'nova scotia': 'ns',
        'ns': 'ns',
        'ontario': 'on',
        'on': 'on',
        'prince edward island': 'pe',
        'pe': 'pe',
        'quebec': 'qc',
        'qc': 'qc',
        'saskatchewan': 'sk',
        'sk': 'sk',
        'northwest territories': 'nt',
        'nt': 'nt',
        'nunavut': 'nu',
        'nu': 'nu',
        'yukon': 'yt',
        'yt': 'yt'
      },
    'gb': {
      'england': 'eng',
      'eng': 'eng',
      'scotland': 'sct',
      'sct': 'sct',
      // add other UK subdivisions
    },
    'tr': {
      'istanbul': '34',
      '34': '34',
      'ankara': '06',
      '06': '06',
      // add other Turkish provinces
    },
    'mx': {
      'jalisco': 'jal',
      'jal': 'jal',
      'nuevo leon': 'nle',
      'nle': 'nle',
      // add other Mexican states
    },
    'au': {
      'new south wales': 'nsw',
      'nsw': 'nsw',
      'victoria': 'vic',
      'vic': 'vic',
      // add other Australian states
    },
    'it': {
      'lazio': 'laz',
      'laz': 'laz',
      'lombardy': 'lom',
      'lom': 'lom',
      // add other Italian regions
    },
    'uy': {
      'montevideo': 'mo',
      'mo': 'mo',
      'canelones': 'ca',
      'ca': 'ca',
      // add other Uruguayan departments
    },
    'ch': {
      'zurich': 'zh',
      'zh': 'zh',
      'geneva': 'ge',
      'ge': 'ge',
      // add other Swiss cantons
    }
  };

  // Function to convert country name to ISO-3166 Alpha-2 code
  function convertCountryCode(countryName: string) {
    if (!countryName) {
        console.log('Country name not provided');
        return ""
    }

    const countryCode = countryCodes[countryName.toLowerCase()];
    if (!countryCode) {
      console.log(`Country code not found for ${countryName}`);
        return ""
    }
    return countryCode.toUpperCase();
  }

  // Function to convert state name/abbreviation to ISO-3166 Alpha-2 code
  function convertStateCode(countryName: string, stateName: string) {
    if (!stateName || !countryName) {
        console.log('State name not provided');
        return ""
    }
    const countryCode = convertCountryCode(countryName);
    const stateCodeMap = stateCodes[countryCode.toLowerCase()];
    if (!stateCodeMap) {
      console.log(`State codes not available for country: ${countryName}`);
      return ""
    }
    const stateCode = stateCodeMap[stateName.toLowerCase()];
    if (!stateCode) {
      console.log(`State code not found for ${stateName} in ${countryName}`);
        return ""
    }
    return stateCode.toUpperCase();
  }