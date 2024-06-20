import {Body, Controller, Get, Param, Post, Query, Render, Request, Res, UseGuards} from "@nestjs/common";
import { Public } from "../auth/auth.module";
import { HubspotService } from "./hubspot.service";
import { LocalAuthGuard } from "../auth/local-auth.guard";
import { Account } from "../entities/account.entity";
import { IDataServices } from "../db/repository";
import {ProcoreService} from "../procore/procore.service";
const net = require('net');

@Controller('hubspot')
export class HubspotController {
    constructor(private readonly hubspotService: HubspotService, private dataServices: IDataServices, private procoreService: ProcoreService) {}

    @Public()
    @Get('redirect')
    async authorize(@Query('code') code: string, @Query('state') state: string): Promise<any> {
        console.log("Validate authorization code state",code, state);
        const user = await this.dataServices.accounts.findOne({username: 'julian'})
        const authorized = await this.hubspotService.authorize(code, user);
        return authorized;
    }

    @Get('connect')
    async connect(@Request() req) {

       // console.log("Req user", req.user);
        const user = await this.dataServices.accounts.findOne({username: 'julian'});
        return this.hubspotService.getInstallUrl(user);
    }

    @Get('setup')
    async setup(@Request() req, @Res() res){

        // console.log("Hubspot setup", req.user);
        let user = await this.dataServices.accounts.findOne({username: 'julian'});
        let installUrl = await this.hubspotService.getInstallUrl(user);
        res.redirect(installUrl);
    }

    @Get('attachments/sync')
    async syncAttachments(@Request() req, @Res() res){
        let user = await this.dataServices.accounts.findOne({username: 'julian'});
        let attachments = await this.hubspotService.syncAttachmentsFromProcore(user);
        res.send(attachments);
    }

    @Get('crmcard')
    async getProjectDetails(@Body() body, @Query() query, @Res() res) {
        //const projectItems = await this.hubspotService.getProjectItems(body.);

        const portalId = query.portalId;
        const associatedObjectId = query.associatedObjectId;
        const associatedObjectType = query.associatedObjectType;

        console.log("Get project details", portalId, associatedObjectId, associatedObjectType);

        let results = [];
        let account = await this.dataServices.accounts.findOne({});

        let dealProperties = await this.hubspotService.getDeal(query.associatedObjectId, account);

        let procoreId = dealProperties.properties.procore_id;
        if (!procoreId){
            return res.send({results})
        }


       // let projectDetails = await this.dataServices.projects.findOne({hsId: associatedObjectId});
       // console.log("Project details", projectDetails);

        let projectDetails = await this.procoreService.getProject(procoreId, account);
        let primeContract = await this.procoreService.getPrimeContract(procoreId, account);

        if (primeContract) {

            console.log("Prime contract details", primeContract);

            /*  if (!projectDetails || !projectDetails.procoreId){
                  console.log("Project doesnt have a procoreid", projectDetails);
                 return res.send({results});
              }*/

            results.push({
                objectId: 1,
                title: projectDetails.name,
                link: `${process.env.PROCORE_APP_BASE_URL}/${procoreId}/project/home`,
                total_payments: primeContract.total_payments,
                revised_contract_amount: primeContract.pending_revised_contract_amount,
                approved_change_orders: primeContract.approved_change_orders,
                original_contract_amount: primeContract.grand_total,
                invoiced_amount: primeContract.owner_invoices_amount,
            });
        } else {
            results.push({
                objectId: 1,
                title: projectDetails.name,
                link: `${process.env.PROCORE_APP_BASE_URL}/${procoreId}/project/home`,
            })
        }


        console.log("Results", results);
        res.send({results});
    }

    @Post('document/webhook')
    async postProjectDocument(@Body() body, @Res() res){
        console.log("Project Document Webhook body", body);
        res.send({});

        await this.hubspotService.processProjectDocumentWebhook(body);
    }

    @Post('webhook')
    async handleWebhook(@Body() body, @Res() res) {
        console.log("Handle hubspot webhook", body);
        res.send({});

        // const webhookBody = {
        //     eventId: 12345,
        //     subscriptionId: 1234,
        //     portalId: 12345,
        //     appId: 123545,
        //     occurredAt: 123455,
        //     subscriptionType: 'deal.propertyChange',
        //     attemptNumber: 0,
        //     objectId: 12354,
        //     propertyName: 'dealstage',
        //     propertyValue: 'appointmentscheduled',
        //     changeSource: 'CRM_UI',
        //     sourceId: 'userId:3826663'
        // }

        for (let i = 0; i < body.length; i++){
            const event = body[i];
            if (event.changeSource === "INTEGRATION") return
            console.log("webhook event", event);
            const account = await this.dataServices.accounts.findOne({hsPortalId: event.portalId});

            if (!event.objectId) {
                return
            }

            let record_has_recently_updated = await send_to_cache({
                Get: {
                    key: event.objectId.toString()
                }
            })
            console.log("Record has recently updated: ", record_has_recently_updated);

            if (record_has_recently_updated && record_has_recently_updated["value"] !== null){
                console.log("Record has recently updated. HS ID: ", record_has_recently_updated);
                return
            } else {
                console.log("Record has not recently updated. HS ID: ", record_has_recently_updated);
                await send_to_cache({
                    Set: {
                        key: event.objectId.toString(),
                        value: event.objectId.toString(),
                        ttl: 4000
                    }
                })
            }

            if (event.subscriptionType === 'deal.propertyChange' && event.propertyName === 'dealstage'){
                // await this.hubspotService.handleProjectCreationWebhook(event.objectId, account);
            }
            else if (event.subscriptionType === 'deal.propertyChange' && (event.propertyName === 'procore_refresh' || event.propertyName === 'create_in_procore')){
                console.log("Procore force refresh", event);
                // await this.hubspotService.handleProjectCreationWebhook(event.objectId, account);
            } else if (event.subscriptionType === 'company.propertyChange' && event.propertyName === 'procore_refresh'){
                console.log("Update company webhook", event);
                // await this.hubspotService.handleCompanyUpdateWebhook(event.objectId, account);
            } else if (event.subscriptionType.includes("contact")){

                // ignore association changes until we got that sorted. probs want just for billing contacts
                if (event.subscriptionType === 'contact.associationChange') return

                if (event.changeFlag === 'CREATED') return // we want to ignore this too as it is covered by the create webhook already
                if (event.changeSource === 'OBJECT_DELETION') return // currently ignoring but they may want this impl in future

                console.log("Contact created or updated", event);
                await this.hubspotService.handle_contact_update_webhook(event.objectId, account);
            } else if (event.subscriptionType.includes("company")) {
                if (event.changeFlag === 'CREATED') return // we want to ignore this too as it is covered by the create webhook already
                if (event.changeSource === 'OBJECT_DELETION') return // currently ignoring but they may want this impl in future

                console.log("Company created or updated", event);
                await this.hubspotService.handle_company_update_webhook(event.objectId, account);
            }
        }
    }

    @Get("procore_sync_contact")
    async syncProcoreContact(@Query('procoreId') procore_id,@Request() req, @Res() res){
        console.log("Sync procore contact", procore_id);
        let account = await this.dataServices.accounts.findOne({username: 'julian'});
        let contact = await this.dataServices.contacts.findOne({procoreId: procore_id});
        console.log("Contact received to sync to HS", contact)
        if (!contact){
            return res.send({message: 'Contact not found'});
        }

        if (!contact.hsId) this.hubspotService.create_contact(contact, account);
        else this.hubspotService.update_contact(contact, account);

        res.send({message: 'Contact synced'});
    }

    @Get("procore_sync_company")
    async sync_procore_company(@Query('procoreId') procore_id,@Request() req, @Res() res){
        console.log("Sync procore company", procore_id);
        let account = await this.dataServices.accounts.findOne({username: 'julian'});
        let company = await this.dataServices.companies.findOne({procoreId: procore_id});
        console.log("getting company for after being updated by procore", company);
        if (!company){
            return res.send({message: 'Contact not found'});
        }

        if (!company.hsId) {
            company = await this.hubspotService.find_matching_company(company, account);
        }
        if (!company.hsId) this.hubspotService.create_company(company, account);
        else this.hubspotService.update_company(company, account);

        res.send({message: 'company synced'});
    }
}

async function send_to_cache(message) {
    return new Promise((resolve, reject) => {
        const client = new net.Socket();

        client.connect(4000, '127.0.0.1', () => {
            console.log('Connected to IronVault server');
            client.write(JSON.stringify(message));
        });

        client.on('data', (data) => {
            console.log('Received: ' + data);
            resolve(JSON.parse(data.toString()));
            client.destroy(); // kill client after server's response
        });

        client.on('close', () => {
            console.log('Connection closed');
        });

        client.on('error', (err) => {
            console.error('Error: ', err);
            reject(err);
        });
    });
}