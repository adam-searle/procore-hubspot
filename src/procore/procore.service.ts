import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { IDataServices } from '../db/repository';
import { AuthService } from '../auth/auth.service';
import { Account } from '../entities/account.entity';

import axios, { AxiosError } from 'axios';
import { Project } from '../entities/project.entity';
import { Office } from '../entities/office.entity';
import { PrimeContract } from '../entities/primeContract.entity';
import { Company } from '../entities/company.entity';
import { Contact } from '../entities/contact.entity';
// @ts-ignore
import { DateTime } from 'luxon';
import { HubspotService } from '../hubspot/hubspot.service';
import { Attachment } from '../entities/attachment.entity';
import * as path from 'path';
import * as fs from 'fs';
import mongoose from 'mongoose';

import * as FormData from 'form-data';

const documentTypes = [
  '1.0_Public Project Data',
  '2.2_Quotes',
  '2.4_Material Tracking',
  '3.0_Maintenance Documents',
  '4.2_Deliverables_10%',
  '4.2_Deliverables_30%',
  '4.2_Deliverables_Concept',
  '4.2_Deliverables_Exhibits',
  'External Documents',
  '5.1_Bid Package',
];

/* Hubspot departments - procore types */
const projectTypes = {
  Admin: 562949953529723,
  Construction: 562949953529722,
  Engineering: 562949953529721,
  Geospatial: 562949953529720,
  Maintenance: 562949953478270,
  'Material Purchase': 562949953572385,
  Operations: 562949953572384,
  Signal: 562949953530793,
  'Simulation Modeling': 562949953529718,
};

/* Hubspot types - procore departments */
const projectDepartments = {
  Video: 562949953445197,
  'Track Inspection': 562949953445196,
  Simulation: 562949953445195,
  'Scheduled Maintenance': 562949953442817,
  Rendering: 562949953445193,
  Rehabilitation: 562949953445192,
  Photogrammetric: 562949953445191,
  Overhead: 562949953445190,
  LIDAR: 562949953445187,
  'New Construction': 562949953445189,
  'Ground Survey': 562949953445186,
  GIS: 562949953445185,
  Feasibility: 562949953445184,
  'Emergency Maintenance': 562949953445183,
  'Design/Build': 562949953445182,
  Design: 562949953445181,
  Coordination: 562949953445180,
};

const procoreAdminUserPermission = '562949953523890';

const enableWrites = true; //process.env.PROCORE_WRITES_ENABLED || false;

@Injectable()
export class ProcoreService {
  redirectUrl = process.env.SERVER_URL + process.env.PROCORE_REDIRECT_PATH;

  constructor(
    private dataServices: IDataServices,
    private authService: AuthService,
  ) {}

  private readonly logger = new Logger(ProcoreService.name);

  async refreshToken(account: Account) {
    try {
      console.log('Procore token expired', account);

      const accountRes = await this.dataServices.accounts.findById(account._id);

      const authUrl = `${process.env.PROCORE_API_URL}oauth/token`;
      console.log('Tokren refresh Auth url', authUrl);

      const pcResponse = await axios.post(authUrl, {
        grant_type: 'refresh_token',
        client_id: process.env.PROCORE_PRODUCTION_ID,
        client_secret: process.env.PROCORE_PRODUCTION_SECRET,
        refresh_token: accountRes.procoreRefreshToken,
        redirect_uri: this.redirectUrl,
      });

      console.log('Procore refresh token', pcResponse.data);

      account.procoreToken = pcResponse.data.access_token;
      account.procoreRefreshToken = pcResponse.data.refresh_token;
      let expiry = new Date();
      expiry.setSeconds(expiry.getSeconds() + pcResponse.data.expires_in);
      // account.procoreTokenExpiry = new Date((Date.now() + (pcResponse.data.expires_in * 1000)))
      account.procoreTokenExpiry = expiry;
      await account.save();
    } catch (err) {
      console.error('Error refreshing procore token', err);
    }
  }

  async getHeaders(account: Account) {
    const accountRef = await this.dataServices.accounts.findById(account._id);

    if (accountRef.procoreTokenExpiry < new Date()) {
      await this.refreshToken(accountRef);
    }

    return {
      Authorization: `Bearer ${accountRef.procoreToken}`,
    };
  }

  async authorize(code: string, user: any): Promise<Account> {
    const authUrl = `${process.env.PROCORE_TOKEN_ENDPOINT}oauth/token`;
    console.log('Auth url', authUrl);
    const pcResponse = await axios.post(authUrl, {
      grant_type: 'authorization_code',
      client_id: process.env.PROCORE_PRODUCTION_ID,
      client_secret: process.env.PROCORE_PRODUCTION_SECRET,
      code,
      redirect_uri: this.redirectUrl,
    });

    console.log('Procore authorize', pcResponse.data);

    const account = await this.dataServices.accounts.findOne({
      username: user.username,
    });

    account.procoreToken = pcResponse.data.access_token;
    account.procoreRefreshToken = pcResponse.data.refresh_token;
    let expiry = new Date();
    expiry.setSeconds(expiry.getSeconds() + pcResponse.data.expires_in);
    account.procoreTokenExpiry = expiry;
    await account.save();

    const companies = await this.getCompanies(account);
    if (companies && companies[0]) {
      account.activeProcoreCompanyId = companies[0].id;
    }

    return account;
  }

  async writeProjectDocuments() {
    let account = await this.dataServices.accounts.findOne({});
    let documents = await this.dataServices.attachments.find({
      procoreId: { $exists: false },
    });

    for (let d of documents) {
      console.log('Document', d);
      await this.createProjectFile(d.project, d, account);
    }
  }

  async getProjects(account: Account) {
    console.log('Account', account);
    const dataUrl = `${process.env.PROCORE_API_URL}rest/v1.1/projects?company_id=${account.activeProcoreCompanyId}`;

    console.log('Project data url', dataUrl);
    const options = {
      headers: await this.getHeaders(account),
    };
    const response = await axios.get(dataUrl, options);
    console.log('Response', response);
    return response.data;
  }

  async getProject(projectId: string, account: Account) {
    console.log('Get project', projectId);
    const dataUrl = `${process.env.PROCORE_API_URL}rest/v1.0/projects/${projectId}?company_id=${account.activeProcoreCompanyId}`;

    const options = {
      headers: await this.getHeaders(account),
    };
    const response = await axios.get(dataUrl, options);
    // console.log("response", response);
    return response.data;
  }

  async getPrimeContract(projectId: string, account: Account) {
    try {
      console.log('Get prime contract', projectId);
      const dataUrl = `${process.env.PROCORE_API_URL}rest/v1.0/prime_contract?project_id=${projectId}&company_id=${account.activeProcoreCompanyId}`;
      const options = {
        headers: await this.getHeaders(account),
      };
      const response = await axios.get(dataUrl, options);
      console.log('Get prime contract response', response.data);
      return response.data;
    } catch (err) {
      //  console.error("Error getting prime contract", err);
    }
  }

  async getCompanies(account: Account) {
    const dataUrl = `${process.env.PROCORE_API_URL}rest/v1.0/companies`;

    const options = {
      headers: await this.getHeaders(account),
    };

    this.logger.debug(`Request URL: ${dataUrl}`);
    this.logger.debug(`Request Options: ${JSON.stringify(options)}`);

    try {
      const response = await axios.get(dataUrl, options);

      this.logger.debug('Response Data: ', response.data);

      // Set the first company as active if no company is active already
      if (
        !account.activeProcoreCompanyId &&
        response.data &&
        response.data.length
      ) {
        const accountEnt = await this.dataServices.accounts.findOne({
          username: account.username,
        });
        accountEnt.activeProcoreCompanyId = response.data[0].id;
        await accountEnt.save();
      }

      return response.data;
    } catch (error) {
      this.logger.error(
        `Error fetching companies: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async createAllForProject(project: Project, account: Account) {
    checkWriteEnabled(project);
    await this.createProject(project, account);
    //await this.createContact(project.contact, account);
    await this.createCompany(project.company, project, account);
    await this.addVendorToProject(project.company, project, account);
    await this.createAllContactsForProject(project, account);
    await this.addOwnerToProject(project, account);

    if (project.primeContract.procoreId) {
      await this.updatePrimeContract(project.primeContract, account);
    } else {
      await this.createPrimeContract(project.primeContract, account);
    }
  }

  async forceCreateProjectContacts(projectId: string, account: Account) {
    const project = await this.dataServices.projects.findOne({
      procoreId: projectId,
    });
    await this.createAllContactsForProject(project, account);
  }

  async createAllContactsForProject(project: Project, account: Account) {
    for (let c of project.contacts) {
      await this.createContact(c, account);
      await this.addContactToProject(c, project, account);
    }
  }

  async addContactToProject(
    contact: Contact,
    project: Project,
    account: Account,
  ) {
    contact = await this.dataServices.contacts.findOne(contact);
    try {
      checkWriteEnabled(project);
      if (!contact.procoreId) {
        console.log('Contact not created, skipping', contact);
        return;
      }
      let projectUrl = `${process.env.PROCORE_API_URL}rest/v1.0/projects/${project.procoreId}/users/${contact.procoreId}/actions/add?company_id=${account.activeProcoreCompanyId}`;

      console.log('Add contact to project url', projectUrl);
      const data = {
        user: { permission_template_id: 562949953523743 },
      };

      const options = {
        headers: await this.getHeaders(account),
      };

      const response = await axios.post(projectUrl, data, options);
      console.log('Response', response.data);
    } catch (err) {
      console.error('Error adding contact to project', err);
    }
  }

  async createProject(project: Project, account: Account) {
    checkWriteEnabled(project);
    if (project.procoreId) {
      console.log('Project already created, skipping', project);
      return;
    }
    let projectUrl = `${process.env.PROCORE_API_URL}rest/v1.0/projects?company_id=${account.activeProcoreCompanyId}`;

    let start_date;
    if (project.closeDate) {
      start_date = project.closeDate.toISOString().split('T')[0];
    }

    //todo - add other project stages

    let project_stage_id = 562949953426292; //stage awarded

    if (project.dealstage !== 'closedwon') {
      project_stage_id = 562949953421313; //stage bidding
    }

    let finish_date = new Date(
      new Date(project.closeDate.toISOString()).setDate(
        project.closeDate.getDate() + 30,
      ),
    );
    let finishDateString = finish_date.toISOString().split('T')[0];

    let projectNumber = project.projectNumber || '';

    let name = `${projectNumber}${project.name}`;

    const data = {
      company_id: account.activeProcoreCompanyId,
      project: {
        active: true,
        name,
        description: project.description,
        address: project.address,
        city: project.city,
        code: project.code,
        state_code: project.state,
        country_code: 'US',
        start_date,
        completion_date: finishDateString,
        projected_finish_date: finishDateString,
        estimated_value: project.amount || 0,
        phone: project.phone,
        project_number: project.projectNumber,
        time_zone: 'Mountain Time (US & Canada)',
        tz_name: 'America/Denver',
        zip: project.zip,
        office_id: null,
        project_stage_id,
        project_template_id: '562949953547512', //check syntax
        erp_integrated: true,
        //type: project.department,
        project_type_id: undefined,
        //  department_ids: null
        department_ids: undefined,
      },
    };

    if (project.types && project.types.length) {
      data.project.department_ids = [];
      for (let t of project.types) {
        let department = projectDepartments[t];
        if (department) {
          data.project.department_ids.push(department);
        }
      }
    }

    if (project.department) {
      let department = projectTypes[project.department];
      if (department) {
        data.project.project_type_id = department;
      }
    }

    if (!project.office) {
      let office = await this.lookupOffice(project.officeName, account);
      if (office) {
        project.office = office;
        await project.save();
      }
    }

    if (project.office) {
      data.project.office_id = project.office.procoreId;
    }

    console.log('Create project payload', data);

    try {
      console.log('Create project in procore', data);
      const response = await axios.post(projectUrl, data, {
        headers: await this.getHeaders(account),
      });
      console.log('Response', response);

      if (response && response.data) {
        project.procoreId = response.data.id;
        project.needsHsUpdate = true;
        console.log('Created project in procore', project);
        await project.save();
      }
    } catch (err) {
      console.error('ERROR', err);
      if (err.response && err.response.data) {
        console.log('Axios error', JSON.stringify(err.response.data, null, 2));
      }
    }
  }

  async sendToERP(project: Project, account: Account) {
    let dataUrl = `${process.env.PROCORE_API_URL}rest/v1.0/projects/${project.procoreId}/admin/send_to_erp`;
    const options = {
      headers: await this.getHeaders(account),
    };
    const response = await axios.get(dataUrl, options);
  }

  async getAllProjects(account: Account) {
    let dataUrl = `${process.env.PROCORE_API_URL}rest/v1.0/projects?company_id=${account.activeProcoreCompanyId}`;
    const options = {
      headers: await this.getHeaders(account),
    };
    const response = await axios.get(dataUrl, options);

    console.log('Get projects response', response.data);

    return response.data;
  }

  async lookupOffice(officeName: string, account: Account): Promise<Office> {
    let offices = await this.getOffices(account);

    for (let o of offices) {
      let off = await this.dataServices.offices.findOne({
        account,
        procoreId: o.id,
      });
      if (!off) {
        off = await this.dataServices.offices.create({
          account,
          name: o.name,
          procoreId: o.id,
        });
      }
    }

    let office = await this.dataServices.offices.findOne({
      account,
      name: officeName,
    });

    if (office.procoreId) {
      return office;
    }

    for (let o of offices) {
      if (o.name === officeName) {
        if (office) {
          office.procoreId = o.id;
          await office.save();
          return office;
        } else {
          office = await this.dataServices.offices.create({
            account,
            name: officeName,
            procoreId: o.id,
          });
          return office;
        }
      }
    }
  }

  async getOffices(account: Account) {
    let dataUrl = `${process.env.PROCORE_API_URL}rest/v1.0/offices?company_id=${account.activeProcoreCompanyId}`;
    const options = {
      headers: await this.getHeaders(account),
    };
    const response = await axios.get(dataUrl, options);

    console.log('Get offices response', response.data);

    return response.data;
  }

  async findProject(project: Project, account: Account) {}

  async findCompany(company: Company, account: Account): Promise<Company> {
    let findUrl = `${process.env.PROCORE_API_URL}rest/v1.0/vendors?company_id=${account.activeProcoreCompanyId}&filters[search]=${company.name}`;

    let options = {
      headers: await this.getHeaders(account),
      method: 'GET',
    };

    const response = await axios(findUrl, options);
    if (response && response.data) {
      if (response.data.length) {
        company.procoreId = response.data[0].id;
        await company.save();
        console.log('Found procore company', company);
        return company;
      }
    }

    return company;
  }

  async getProjectFiles(projectId: string, account: Account) {
    let docUrl = `${process.env.PROCORE_API_URL}rest/v1.0/projects/${projectId}/documents?company_id=${account.activeProcoreCompanyId}&view=extended&filters[document_type]=file`;
    let options = {
      headers: await this.getHeaders(account),
      method: 'GET',
    };

    const response = await axios(docUrl, options);
    if (response && response.data) {
      console.log('Got project files', response.data);
      let project = await this.dataServices.projects.findOne({
        procoreId: projectId,
        account,
      });
      await this.processProcoreProjectFiles(project, response.data, account);
      return response.data;
    }
  }

  async processProcoreProjectFiles(
    project: Project,
    fileData: any,
    account: Account,
  ) {
    for (let d of fileData) {
      if (d.document_type === 'file') {
        console.log('Processing file', d);

        let attachment = await this.dataServices.attachments.findOne({
          procoreId: d.id,
          project,
        });
        if (!attachment) {
          attachment = await this.dataServices.attachments.create({
            procoreId: d.id,
            account,
            name: d.name,
            fileOrigin: 'procore',
          });
          await this.downloadProcoreFile(d.file.url, d.id, account);
          attachment.localPath = path.resolve('./filestorage_procore/' + d.id);
          attachment.documentType = this.determineFileType(
            fileData.name_with_path,
          );
          attachment.project = project;
          await attachment.save();
        }
      }
    }
  }

  async downloadProcoreFile(
    filePath: string,
    fileId: string,
    account: Account,
  ) {
    let file = await axios.get(filePath);
    const filepath = path.resolve('./filestorage_procore/' + fileId);
    fs.writeFileSync(filepath, file.data);
  }

  async updateProject(project: Project, account: Account) {
    checkWriteEnabled(project);
    if (!project.procoreId) {
      console.error(
        'Cannot update project, Project does not have a procore id',
        project,
      );
    }
    let projectUrl = `${process.env.PROCORE_API_URL}rest/v1.0/projects/${project.procoreId}?company_id=${account.activeProcoreCompanyId}`;

    let start_date;
    if (project.startDate) {
      start_date = project.startDate.toISOString().split('T')[0];
    }

    let project_stage_id = 562949953426292; //stage awarded

    if (project.dealstage !== 'closedwon') {
      project_stage_id = 562949953421313; //stage bidding
    }

    let projectNumber = project.projectNumber || '';

    let name = `${projectNumber}${project.name}`;

    const data = {
      company_id: account.activeProcoreCompanyId,
      project: {
        active: true,
        total_value: project.amount,
        project_stage_id,
        name,
        description: project.description,
        address: project.address,
        city: project.city,
        code: project.code,
        country_code: 'US',
        start_date,
        //start_date: project.startDate.toISOString().split('T')[0],
        phone: project.phone,
        project_number: project.projectNumber,
        time_zone: project.timezone,
        zip: project.zip,
        latitude: project.latitude,
        longitude: project.longitude,
        department_ids: undefined,
        project_type_id: undefined,
      },
    };

    if (project.types && project.types.length) {
      data.project.department_ids = [];
      for (let t of project.types) {
        let department = projectDepartments[t];
        if (department) {
          data.project.department_ids.push(department);
        }
      }
    }

    if (project.department) {
      let department = projectTypes[project.department];
      if (department) {
        data.project.project_type_id = department;
      }
    }

    console.log('Update project payload', data);

    try {
      const response = await axios.patch(projectUrl, data, {
        headers: await this.getHeaders(account),
      });
      console.log('Response', response.data);
    } catch (err) {
      console.error('ERROR', err);
    }
  }

  async addDefaultWBSItemToProject(projectId: string, account: Account) {
    try {
      let actionUrl = `${process.env.PROCORE_API_URL}rest/v1.0/cost_codes/copy_from_standard_list?company_id=${account.activeProcoreCompanyId}`;
      let body = {
        project_id: projectId,
        standard_cost_code_list_id: 627995274,
      };

      let options = {
        headers: await this.getHeaders(account),
        method: 'POST',
        data: body,
      };

      const response = await axios(actionUrl, options);
      console.log('WBS CODES RESPONSE', JSON.stringify(response.data, null, 2));
    } catch (err) {
      console.error('ERROR', err);
    }
  }

  async getProjectWBSItems(projectId: string, account: Account) {
    try {
      let actionUrl = `${process.env.PROCORE_API_URL}rest/v1.0/projects/${projectId}/work_breakdown_structure/segments?company_id=${account.activeProcoreCompanyId}`;

      let options = {
        headers: await this.getHeaders(account),
        method: 'GET',
      };

      const response = await axios(actionUrl, options);
      console.log('WBS CODES RESPONSE', JSON.stringify(response.data, null, 2));

      let segmentUrl = `${process.env.PROCORE_API_URL}rest/v1.0/projects/${projectId}/work_breakdown_structure/segments/43651/segment_items?company_id=${account.activeProcoreCompanyId}`;

      const segmentResponse = await axios(segmentUrl, options);

      console.log(
        'Segment RESPONSE',
        JSON.stringify(segmentResponse.data, null, 2),
      );
    } catch (err) {
      console.error('Error getting WBS Items', err);
    }
  }

  async addVendorToProject(
    company: Company,
    project: Project,
    account: Account,
  ) {
    checkWriteEnabled(project);
    if (!project.procoreId) {
      console.error('Cannot add vendor to project without procore id', project);
      return;
    }
    try {
      let actionUrl = `${process.env.PROCORE_API_URL}rest/v1.0/projects/${project.procoreId}/vendors/${company.procoreId}/actions/add?company_id=${account.activeProcoreCompanyId}`;

      let options = {
        headers: await this.getHeaders(account),
        method: 'POST',
      };

      const response = await axios(actionUrl, options);

      if (response.data && response.data.id) {
        console.log('Add vendor to project success', response.data);
      } else {
        console.error('Failed to add vendor to project', response.data);
      }
    } catch (err) {
      console.error('Error adding vendor to project', err);
    }
  }

  async addVendorIdToProject(
    projectId: string,
    vendorId: string,
    account: Account,
  ) {
    try {
      let actionUrl = `${process.env.PROCORE_API_URL}rest/v1.0/projects/${projectId}/vendors/${vendorId}/actions/add?company_id=${account.activeProcoreCompanyId}`;

      let options = {
        headers: await this.getHeaders(account),
        method: 'POST',
      };

      const response = await axios(actionUrl, options);

      if (response.data && response.data.id) {
        console.log('Add vendor to project success', response.data);
      } else {
        console.error('Failed to add vendor to project', response.data);
      }
    } catch (err) {
      console.error('Error adding vendor to project', err);
    }
  }

  async addOwnerToProject(project: Project, account: Account) {
    checkWriteEnabled(project);
    if (!project.procoreId) {
      console.error('Cannot add owner to project without procore id', project);
      return;
    }
    try {
      let ownerContact = await this.findContactByEmail(
        project.hsOwnerEmail,
        account,
      );
      console.log('Owner contact response', ownerContact);
      if (ownerContact) {
        if (!ownerContact.contact_id && !ownerContact.id) {
          console.error(
            'Error adding owner to project, no contact id found for owner',
            ownerContact,
          );
          return;
        }

        let actionUrl = `${process.env.PROCORE_API_URL}rest/v1.0/projects/${project.procoreId}/users/${ownerContact.id}/actions/add?company_id=${account.activeProcoreCompanyId}`;

        let options = {
          headers: await this.getHeaders(account),
        };

        const data = {
          user: { permission_template_id: procoreAdminUserPermission },
        };

        const response = await axios.post(actionUrl, data, options);

        if (response.data && response.data.id) {
          console.log('Add owner to project success', response.data);
        } else {
          console.error('Failed to add owner to project', response.data);
        }
      }
    } catch (err) {
      console.error('Error adding owner to project', err);
    }
  }

  async updatePrimeContract(
    primeContract: PrimeContract,
    account: Account,
  ): Promise<PrimeContract> {
    try {
      if (!primeContract.procoreId) {
        console.error(
          'Cannot update prime contract, it doesnt exist',
          primeContract,
        );
        return primeContract;
      }

      let primeContractUrl = `${process.env.PROCORE_API_URL}rest/v1.0/prime_contract/${primeContract.procoreId}?company_id=${account.activeProcoreCompanyId}`;

      let data = {
        project_id: primeContract.project.procoreId,
        prime_contract: {
          number: `${primeContract.project.projectNumber} - 1`,
          status: 'Draft',
          contractor_id: 562949955035561,
          description: primeContract.project.description,
        },
      };

      if (primeContract.project.dealstage === 'closedwon') {
        data.prime_contract.status = 'Draft';
      }

      console.log('Update prime contract data', data);

      const options = {
        headers: await this.getHeaders(account),
        data,
        method: 'PATCH',
      };
      const response = await axios(primeContractUrl, options);
      console.log('Create prime contract response', response.data);
      return primeContract;
    } catch (err) {
      console.error('Error updating prime contract', err.response.data);
    }
  }

  async createPrimeContract(
    primeContract: PrimeContract,
    account: Account,
  ): Promise<PrimeContract> {
    await checkWriteEnabled(primeContract.project);
    try {
      if (primeContract.procoreId) {
        console.log('Prime contract already exists', primeContract);
        return primeContract;
      }
      if (!primeContract.project.procoreId) {
        console.error(
          'Cannot create prime contract, project does not have procore id',
          primeContract.project,
        );
        return;
      }

      let primeContractUrl = `${process.env.PROCORE_API_URL}rest/v1.0/prime_contract?company_id=${account.activeProcoreCompanyId}`;

      let data = {
        project_id: primeContract.project.procoreId,
        attachments: [],
        prime_contract: {
          //    actual_completion_date: formatDate(primeContract.contractDate),
          //     approval_letter_date: formatDate(primeContract.contractDate),
          architect_id: null,
          contractor_id: 562949955035561,
          contract_date: formatDate(primeContract.contractDate),
          //    contract_estimated_completion_date: formatDate(primeContract.contractDate),
          contract_start_date: formatDate(primeContract.contractDate),
          description: primeContract.project.description,
          //exclusions: primeContract.exclusions,
          executed: false,
          //    issued_on_date: formatDate(primeContract.contractDate),
          //   letter_of_intent_date: formatDate(primeContract.contractDate),
          number: `${primeContract.project.projectNumber} - 1`,
          //  signed_contract_received_date: formatDate(primeContract.contractDate),
          status: 'Out For Bid',
          title: primeContract.title,
          vendor_id: parseInt(primeContract.company.procoreId),
          accounting_method: 'amount',
        },
      };

      if (primeContract.hsStatus === 'closedwon') {
        data.prime_contract.status = 'Draft';
      }

      console.log('Create prime contract data', data);

      const options = {
        headers: await this.getHeaders(account),
        data,
        method: 'POST',
      };
      const response = await axios(primeContractUrl, options);

      console.log('Create prime contract response', response.data);

      if (response.data && response.data.id) {
        primeContract.procoreId = response.data.id;
        await primeContract.save();
        return primeContract;
      }
    } catch (err) {
      console.error('Error creating prime contract', err.response.data);
      //console.error("Error", err.response.data);
    }
  }

  async setPermissionsForContact(
    contactId: string,
    projectId: string,
    account: Account,
  ) {
    try {
      let actionUrl = `${process.env.PROCORE_API_URL}rest/v1.0/companies/{company_id}/permission_templates?company_id=${account.activeProcoreCompanyId}`;

      let options = {
        headers: await this.getHeaders(account),
        method: 'GET',
      };

      let response = await axios(actionUrl, options);

      if (response.data && response.data.length > 0) {
        console.log('Permission templates', response.data);
      }
    } catch (err) {
      console.error('Error getting permission templates', err);
    }
  }

  async updateVendorInCompanyDirectory(
    company: Company,
    account: Account,
  ): Promise<Company> {
    try {
      if (!company.procoreId) {
        company = await this.findCompany(company, account);
      }

      if (!company.procoreId) {
        //todo - create company without project association
      } else {
        let vendorUrl = `${process.env.PROCORE_API_URL}rest/v1.0/vendors/${company.procoreId}?company_id=${account.activeProcoreCompanyId}`;
        let data = {
          company_id: account.activeProcoreCompanyId,
          vendor: {
            name: company.name,
            address: company.address,
            city: company.city,
            zip: company.zip,
            business_phone: company.businessPhone,
            // "mobile_phone": company.mobilePhone,
            fax_number: company.faxNumber,
            email_address: company.emailAddress,
            is_active: true,
            state_code: company.stateCode,
            authorized_bidder: true,
            prequalified: true,
            country_code: company.countryCode,
            vendor_group_id: null,
            parent_id: null,
            primary_contact_id: company.primaryContact.procoreId,
            trade_name: company.name,
          },
        };

        console.log('Update company (directory) data', JSON.stringify(data));

        const options = {
          headers: await this.getHeaders(account),
          data,
          method: 'PATCH',
        };
        const response = await axios(vendorUrl, options);

        console.log(
          'Update procore company (directory) response',
          response.data,
        );

        if (response && response.data) {
          company.procoreId = response.data.id;
          await company.save();
          return company;
        }
      }
    } catch (err) {
      console.error('Error updating vendor (company)', err);
    }
  }

  async createCompany(
    company: Company,
    project: Project,
    account: Account,
  ): Promise<Company> {
    console.log('create company', company, project, account);
    await checkWriteEnabled(project);
    try {
      if (!company.procoreId) {
        company = await this.findCompany(company, account);
      }

      if (company.procoreId) {
        console.log('Company already exists', company.procoreId);
        return company;
      }

      let vendorUrl = project
        ? `${process.env.PROCORE_API_URL}rest/v1.0/projects/${project.procoreId}/vendors?company_id=${account.activeProcoreCompanyId}`
        : `${process.env.PROCORE_API_URL}rest/v1.0/vendors?company_id=${account.activeProcoreCompanyId}`;

      //let abbreviatedName = company.name.substring(0, 2).toUpperCase();

      let data = {
        company_id: account.activeProcoreCompanyId,
        vendor: {
          name: company.name,
          address: company.address,
          city: company.city,
          zip: company.zip,
          business_phone: company.businessPhone,
          // "mobile_phone": company.mobilePhone,
          fax_number: company.faxNumber,
          email_address: company.emailAddress,
          is_active: true,
          //  "state_code": company.stateCode,
          authorized_bidder: true,
          prequalified: true,
          country_code: 'US',
          //  "abbreviated_name": abbreviatedName,
          vendor_group_id: null,
          parent_id: null,
          // primary_contact: null,
          //primary_contact_id: null,
          //  "primary_contact_id": company.primaryContact.procoreId,
          trade_name: company.name,
        },
      };

      /*if (company && company.primaryContact){
                data.vendor.primary_contact = {
                    first_name: company.primaryContact.firstName,
                    last_name: company.primaryContact.lastName,
                    business_phone: company.primaryContact.phone,
                    email_address: company.primaryContact.email
                }
            }*/

      /* if (company && company.primaryContact){
                data.vendor.primary_contact_id = company.primaryContact.procoreId;
            }*/
      console.log('Create company data', JSON.stringify(data));

      const options = {
        headers: await this.getHeaders(account),
        data,
        method: 'POST',
      };
      const response = await axios(vendorUrl, options);

      console.log('Create procore company response', response.data);

      if (response && response.data) {
        company.procoreId = response.data.id;
        await company.save();
        return company;
      }
    } catch (err) {
      if (err && err.response && err.response.data) {
        console.error('Error creating company - response:', err.response.data);
      } else {
        console.error('Err creating company - no response', err);
      }
    }
  }

  async update_company(company: Company, account: Account) {
    console.log('update company', company);
    try {
      if (!company.procoreId) {
        console.error('Cannot update company, no procore id', company);
        return;
      }

      let companyUrl = `${process.env.PROCORE_API_URL}rest/v1.0/vendors/${company.procoreId}?company_id=${account.activeProcoreCompanyId}`;
      console.log('companyUrl', companyUrl);
      let data = {
        company_id: account.activeProcoreCompanyId,
      };

      let primary_contact = company.primaryContact
        ? await this.dataServices.contacts.findOne(company.primaryContact)
        : null;
      let billing_contacts = [];
      for (let c of company.billingContacts) {
        let contact = await this.dataServices.contacts.findOne(c);
        if (contact) {
          billing_contacts.push(contact);
        }
      }

      console.log('primary_contact', primary_contact);
      data['vendor'] = {
        name: company.name,
        address: company.address,
        address2: company.address2,
        city: company.city,
        zip: company.zip,
        business_phone: company.businessPhone,
        mobile_phone: company.mobilePhone,
        fax_number: company.faxNumber,
        email_address: company.emailAddress,
        is_active: true,

        vendor_group_id: null,
        parent_id: null,
        primary_contact_id:
          primary_contact && primary_contact.procoreId
            ? parseInt(primary_contact.procoreId)
            : null,
        // invoice_contacts_ids: billing_contacts.filter(c => c.procoreId).map(c => parseInt(c.procoreId)),
        trade_name: company.name,
      };

      data['vendor']['country_code'] = company.countryCode
        ? company.countryCode
        : 'US';
      company.stateCode
        ? (data['vendor']['state_code'] = company.stateCode)
        : null;

      console.log('Update company data', data);

      const options = {
        headers: await this.getHeaders(account),
        data,
        method: 'PATCH',
      };
      const response = await axios(companyUrl, options);
      console.log('Update procore company response', response.data);
    } catch (err) {
      console.error('Error updating company', err);
    }
  }

  async getProjectById(projectId: string, account: Account) {
    try {
      let projectUrl = `${process.env.PROCORE_API_URL}rest/v1.0/projects/${projectId}?company_id=${account.activeProcoreCompanyId}`;

      let options = {
        headers: await this.getHeaders(account),
        method: 'GET',
      };

      const response = await axios(projectUrl, options);

      if (response && response.data) {
        console.log('Get procore project by id response', response.data);
        return response.data;
      }
    } catch (err) {
      console.error('Error getting project by id', err.response.data);
    }
  }

  async getContactById(contactId: string, account: Account) {
    try {
      let contactUrl = `${process.env.PROCORE_API_URL}rest/v1.0/companies/${account.activeProcoreCompanyId}/users/${contactId}?company_id=${account.activeProcoreCompanyId}`;

      let options = {
        headers: await this.getHeaders(account),
        method: 'GET',
      };

      const response = await axios(contactUrl, options);

      if (response && response.data) {
        console.log('Get procore contact by id response', response.data);
        console.log('Find contact by id', response.data.id);
        let contact = await this.dataServices.contacts.findOne({
          procoreId: response.data.id,
        });
        if (!contact) return response.data;
        let company = await this.dataServices.companies.findOne(
          contact.company,
        );
        console.log('Existing contact', contact);
        console.log('Existing company', company);
        return response.data;
      }
    } catch (err) {
      console.error('Error getting contact by id', err);
    }
  }

  async get_company_by_id(company_id: string, account: Account) {
    try {
      let company_url = `${process.env.PROCORE_API_URL}rest/v1.0/vendors/${company_id}?company_id=${account.activeProcoreCompanyId}`;

      let options = {
        headers: await this.getHeaders(account),
        method: 'GET',
      };

      const response = await axios(company_url, options);

      if (response && response.data) {
        console.log('Get procore company by id response', response.data);
        let company = await this.dataServices.companies.findOne({
          procoreId: response.data.id,
        });
        return response.data;
      }
    } catch (err) {
      console.error('Error getting contact by id', err);
    }
  }

  async findContact(contact: Contact, account: Account): Promise<Contact> {
    console.log('Find contact', contact);
    let findUrl = `${process.env.PROCORE_API_URL}rest/v1.0/companies/${account.activeProcoreCompanyId}/users?filters[search]=${contact.email}&company_id=${account.activeProcoreCompanyId}`;

    let options = {
      headers: await this.getHeaders(account),
      method: 'GET',
    };

    const response = await axios(findUrl, options);
    if (response && response.data) {
      if (response.data.length) {
        contact.procoreId = response.data[0].id;
        await contact.save();
        console.log('Found procore contact', contact);
      }
    }
    return contact;
  }

  async findContactByEmail(email: string, account: Account): Promise<any> {
    let findUrl = `${process.env.PROCORE_API_URL}rest/v1.0/companies/${account.activeProcoreCompanyId}/users?filters[search]=${email}&company_id=${account.activeProcoreCompanyId}`;

    let options = {
      headers: await this.getHeaders(account),
      method: 'GET',
    };

    const response = await axios(findUrl, options);
    if (response && response.data) {
      if (response.data.length) {
        return response.data[0];
      }
    }
  }

  async create_or_update_contact(contact: Contact, account: Account) {
    if (contact.procoreId) {
      return await this.updateContact(contact, account);
    } else {
      let procore_contact = await this.findContactByEmail(
        contact.email,
        account,
      );
      if (procore_contact) {
        contact.procoreId = procore_contact.id;
        return await this.updateContact(contact, account);
      } else return await this.createContact(contact, account);
    }
  }

  async updateContact(contact: Contact, account: Account): Promise<Contact> {
    console.log('Update contact', contact);
    if (!contact.procoreId) {
      contact = await this.findContact(contact, account);
    }

    if (!contact.procoreId) {
      console.log('No Procore ID found for contact, cannot update.');
      return;
    }

    let contactUrl = `${process.env.PROCORE_API_URL}rest/v1.3/companies/${account.activeProcoreCompanyId}/users/${contact.procoreId}`;
    // let company = await this.dataServices.companies.findById();
    console.log("Contact's company", contact.company);

    const data = {
      first_name: contact.firstName,
      last_name: contact.lastName,
      job_title: contact.jobTitle,
      address: contact.address,
      city: contact.city,
      zip: contact.zip,
      // business_phone: contact.phone,
      mobile_phone: contact.phone,
      fax_number: contact.fax,
      email_address: contact.email,
      is_active: true,
      country_code: contact.countryCode ? contact.countryCode : 'US',
      initials: contact.firstName.charAt(0) + contact.lastName.charAt(0),
      vendor_id: contact.company.procoreId,
      is_employee: contact.company.procoreId === '562949955035561',
    };

    contact.stateCode ? (data['state_code'] = contact.stateCode) : null;

    const options = {
      method: 'PATCH',
      url: contactUrl,
      headers: {
        Authorization: `Bearer ${account.procoreToken}`,
        'Procore-Company-Id': account.activeProcoreCompanyId.toString(),
        'Content-Type': 'application/json',
      },
      data: JSON.stringify({ user: data }),
    };

    try {
      const response = await axios(options);
      console.log('Update contact response', response.data);
    } catch (error) {
      console.error(
        'Failed to update contact',
        error.response ? error.response.data : error,
      );
    }

    return contact;
  }

  async createContact(
    contact: Contact | mongoose.Types.ObjectId,
    account: Account,
  ): Promise<Contact> {
    console.log('Create contact', contact);

    if (contact instanceof mongoose.Types.ObjectId) {
      contact = await this.dataServices.contacts.findById(contact);
    }

    if (!contact) {
      return;
    }
    try {
      if (!contact.procoreId) {
        contact = await this.findContact(contact, account);
      }

      if (contact.procoreId) {
        console.log('Contact already exists', contact);
        return contact;
      }

      let contactUrl = `${process.env.PROCORE_API_URL}rest/v1.0/users?company_id=${account.activeProcoreCompanyId}`;

      // let initials = contact.firstName.charAt(0) + contact.lastName.charAt(0);

      let data = {
        company_id: account.activeProcoreCompanyId,
        user: {
          login: contact.email,
          first_name: contact.firstName,
          last_name: contact.lastName,
          job_title: contact.jobTitle,
          address: contact.address,
          city: contact.city,
          zip: contact.zip,
          business_phone: contact.phone,
          mobile_phone: contact.mobilePhone,
          fax_number: contact.fax,
          email_address: contact.email,
          is_active: true,
          is_employee: contact.company.procoreId === '562949955035561',
          // initials,
          vendor_id: contact.company.procoreId,
          country_code: contact.countryCode ? contact.countryCode : 'US',
        },
      };

      contact.stateCode ? (data.user['state_code'] = contact.stateCode) : null;

      contact.countryCode
        ? (data.user['country_code'] = contact.countryCode)
        : 'US';
      contact.stateCode ? (data.user['state_code'] = contact.stateCode) : null;

      console.log('Create contact data', data);

      const options = {
        headers: await this.getHeaders(account),
        data,
        method: 'POST',
      };
      const response = await axios(contactUrl, options);

      if (response && response.data && response.data.id) {
        console.log('Create contact response', response.data);
        contact.procoreId = response.data.id;
        await contact.save();
        return contact;
      }
    } catch (err) {
      if (err.response && err.response.data) {
        console.log('Error creating contact', err.response.data);
      } else {
        console.error('Error creating contact', err);
      }
    }
  }

  async verifyWebhook(req): Promise<Account> {
    return this.dataServices.accounts.findOne({});

    let apiKey = req.headers.apiKey;

    //in lieu of any real validation
    if (apiKey === 'how secure does it really need to be?') {
    }
  }

  async processProjectUpdate(
    projectData: any,
    account: Account,
  ): Promise<Project> {
    console.log('Process project update', projectData);
    if (projectData.id == '116773') {
      return;
    }
    let project = await this.dataServices.projects.findOne({
      procoreId: projectData.id,
    });

    project.procoreStage = projectData.project_stage.name;
    project.procoreTotalValue = projectData.total_value;
    project.procoreEstimatedStartDate = dateToMillis(
      projectData.estimated_start_date,
    );
    project.procoreEstimatedCompletionDate = dateToMillis(
      projectData.estimated_completion_date,
    );
    project.procoreEstimatedValue = projectData.estimated_value;
    project.procoreProjectedFinishDate = dateToMillis(
      projectData.projected_finish_date,
    );
    project.procoreActualStartDate = dateToMillis(
      projectData.actual_start_date,
    );
    project.needsHsUpdate = true;
    await project.save();
    //await this.hubspotService.writeDealUpdate(project, account);
    return project;
  }

  async registerProjectUpdateWebhook(account: Account) {
    let data = {
      company_id: account.activeProcoreCompanyId,
      hook: {
        api_version: 'v2',
        namespace: 'procore',
        destination_url: 'https://procore.hubwidget.com/procore/webhook',
        destination_headers: {
          apiKey: account._id,
        },
      },
    };

    let webhookUrl = `${process.env.PROCORE_API_URL}rest/v1.0/webhooks/hooks?company_id=${account.activeProcoreCompanyId}`;

    const options = {
      headers: await this.getHeaders(account),
      data,
      method: 'POST',
    };

    const response = await axios(webhookUrl, options);

    console.log('Register webhook response', response.data);
  }

  async processProjectFiles(project: Project, account: Account) {
    let attachments = await this.dataServices.attachments.find({
      project: project.id,
    });
    for (let attachment of attachments) {
      if (!attachment.procoreId) {
        await this.createProjectFile(project, attachment, account);
      }
    }
  }

  async createProjectFile(
    project: Project,
    attachment: Attachment,
    account: Account,
  ) {
    try {
      console.log('Create project file', attachment);
      checkWriteEnabled(project);
      let folderId = project.procoreFolderId;

      if (!folderId) {
        folderId = await this.createProjectFolder(project, account);
      }

      console.log('Create project file', attachment);
      //  let filePath = path.resolve('./filestorage/' + attachment.hsId);
      //  let fileData = fs.readFileSync(filePath);
      // let fileBlob = new Blob([fileData]);
      /* const form = new FormData();
           form.append('data', fileBlob, attachment.filename + attachment.extension);
           form.append('parent_id', getParentDirectoryForDocumentType(attachment.documentType));*/
      // form.append('file.parent_id', getParentDirectoryForDocumentType(attachment.documentType));
      //form.append('file.name', attachment.filename + attachment.extension);
      const filePath = path.resolve('./filestorage/' + attachment.hsId);

      const fileName = attachment.filename + '.' + attachment.extension;

      const formData = new FormData();
      formData.append('file[data]', fs.createReadStream(filePath), fileName);
      formData.append('file[parent_id]', folderId);
      formData.append('file[name]', fileName);

      /* let postFileResponse = await axios.postForm(`${process.env.PROCORE_API_URL}rest/v1.0/files?company_id=${account.activeProcoreCompanyId}&project_id=${project.procoreId}`, {
              file: {
                  data: fileData,
                  name: attachment.filename + '.' + attachment.extension,
                  // parent_id: getParentDirectoryForDocumentType(attachment.documentType)
                  parent_id: folderId
              }
          }, {
              headers: await this.getHeaders(account),
          });*/

      const config = {
        method: 'post',
        url: `${process.env.PROCORE_API_URL}rest/v1.0/files?company_id=${account.activeProcoreCompanyId}&project_id=${project.procoreId}`,
        headers: {
          Authorization: `Bearer ${account.procoreToken}`,
          ...formData.getHeaders(),
        },
        data: formData,
      };

      let postFileResponse = await axios(config);
      console.log('Post file response', postFileResponse);

      if (
        postFileResponse &&
        postFileResponse.data &&
        postFileResponse.data.id
      ) {
        attachment.procoreId = postFileResponse.data.id;
        await attachment.save();
      }
    } catch (err) {
      console.error('Error creating project file', err);
      if (err.response && err.response.data) {
        console.error('Error response', err.response.data);
      }
    }
  }

  async createProjectFolder(
    project: Project,
    account: Account,
  ): Promise<string> {
    console.log('Create project folder', project);
    try {
      checkWriteEnabled(project);
      console.log('Create project folder', project);

      const options = {
        headers: await this.getHeaders(account),
        data: {
          folder: {
            name: 'HubSpot Documents',
            explicit_permissions: true,
          },
        },
        method: 'POST',
      };

      const createFolderUrl = `${process.env.PROCORE_API_URL}rest/v1.0/folders?company_id=${account.activeProcoreCompanyId}&project_id=${project.procoreId}`;

      const createFolderResponse = await axios(createFolderUrl, options);

      if (createFolderResponse && createFolderResponse.data) {
        console.log('Created folder with ID', createFolderResponse.data.id);
        project.procoreFolderId = createFolderResponse.data.id;
        await project.save();
        return createFolderResponse.data.id;
      }
    } catch (err) {
      console.error('Error creating project folder', err.response.data);
    }
  }

  async getAccessToken(): Promise<string> {
    let account = await this.dataServices.accounts.findOne({});
    // if (!account.procoreToken || account.procoreTokenExpiry < new Date()){
    await this.refreshToken(account);
    // }
    return account.procoreToken;
  }

  determineFileType(filepath: string): string {
    let pathComponents = filepath.split('/');

    let baseDocType = pathComponents[1];

    if (baseDocType.includes('1.0_')) {
      //public project data
      return '1.0_Public Project Data';
    } else if (baseDocType.includes('2.2_')) {
      //quotes
      return '2.2_Quotes';
    } else if (baseDocType.includes('2.4_')) {
      //material tracking
      return '2.4_Material Tracking';
    } else if (baseDocType.includes('3.0_')) {
      //maintenance documents
      return '3.0_Maintenance Documents';
    } else if (baseDocType.includes('4.2_')) {
      //deliverables
      if (pathComponents[2].includes('10%')) {
        return '4.2_Deliverables_10%';
      } else if (pathComponents[2].includes('30%')) {
        return '4.2_Deliverables_30%';
      } else if (pathComponents[3].includes('Concept')) {
        return '4.2_Deliverables_Concept';
      } else if (pathComponents[4].includes('Exhibits')) {
        return '4.2_Deliverables_Exhibits';
      }
    } else if (baseDocType.includes('5.1_')) {
      //bid package
      return '5.1_Bid Package';
    } else if (baseDocType.includes('6.1_')) {
      return '6.1_Invoices';
    } else if (baseDocType.includes('Proposal')) {
      return 'Proposal';
    } else if (baseDocType.includes('External Documents')) {
      return 'External Documents';
    }
    console.error('Unable to determine file type from path', filepath);
  }

  // ------- From here down is Lachy's code ------|
  async handleWebhook(req: any, body: any) {
    console.log(req.user);
    let account = await this.verifyWebhook(req);
    if (!account) {
      throw new UnauthorizedException();
    }
    console.log('Procore webhook', body);
    await sleep(2000);

    if (body.resource_name === 'Company Users') {
      let procore_contact = await this.getContactById(
        body.resource_id,
        account,
      );
      if (procore_contact) {
        await this.process_contact_webhook(procore_contact, account);
      } else {
        console.error('No contact found for id', body.user_id);
      }
    } else if (body.resource_name === 'Company Vendors') {
      let procore_company = await this.get_company_by_id(
        body.resource_id,
        account,
      );
      if (procore_company) {
        await this.process_company_webhook(procore_company, account);
      } else {
        console.error('No contact found for id', body.user_id);
      }
    }

    if (body.project_id === body.resource_id && body.event_type === 'update') {
      let projectData = await this.getProject(body.project_id, account);
      let project = await this.processProjectUpdate(projectData, account);
    }
  }

  async process_contact_webhook(procore_contact: any, account: Account) {
    console.log('Procore contact raw', procore_contact);
    // first, try find the contact
    let contact = await this.dataServices.contacts.findOne({
      procoreId: procore_contact.id,
    });
    let company_procore_id =
      contact && contact.company ? contact.company.procoreId : null;
    if (!company_procore_id)
      company_procore_id = procore_contact.customer
        ? procore_contact.customer.id
        : null;
    if (!company_procore_id)
      company_procore_id = procore_contact.vendor
        ? procore_contact.vendor.id
        : null;
    let company: Company = await this.dataServices.companies.findOne({
      procoreId: company_procore_id,
    });
    let properties = {
      firstName: procore_contact.first_name,
      lastName: procore_contact.last_name,
      email: procore_contact.email_address,
      address: procore_contact.address,
      zip: procore_contact.zip,
      phone: procore_contact.mobile_phone,
      // phone: procore_contact.business_phone,
      // mobilePhone: procore_contact.mobile_phone,
      stateCode: procore_contact.state_code,
      countryCode: procore_contact.country_code,
      procoreId: procore_contact.id,
      jobTitle: procore_contact.job_title,
      city: procore_contact.city,
      company,
    };
    console.log('updating contact properties from procore: ', properties);
    if (!contact) {
      contact = await this.dataServices.contacts.create(properties);
    } else {
      contact = await this.dataServices.contacts.update(contact.id, properties);
    }
    console.log('Contact', contact);

    fetch(
      'http://localhost:7000/hubspot/procore_sync_contact?procoreId=' +
        contact.procoreId,
    );
  }

  async process_company_webhook(procore_company: any, account: Account) {
    // first, try find the company
    let company = await this.dataServices.companies.findOne({
      procoreId: procore_company.id,
    });
    let properties = {
      name: procore_company.name,
      address: procore_company.address,
      city: procore_company.city,
      state: procore_company.state,
      country: procore_company.country,
      procoreId: procore_company.id,
      zip: procore_company.zip,
      businessPhone: procore_company.business_phone,
      emailAddress: procore_company.email_address,
      countryCode: procore_company.country_code,
      stateCode: procore_company.state_code,
      account,
    };
    console.log('updating properties from procore: ', properties);
    if (!company) {
      company = await this.dataServices.companies.create(properties);
    } else {
      company = await this.dataServices.companies.update(
        company.id,
        properties,
      );
    }

    await sleep(1000);
    fetch(
      'http://localhost:7000/hubspot/procore_sync_company?procoreId=' +
        company.procoreId,
    );
  }

  async create_or_update_company(company_id: string, account: Account) {
    let company = await this.dataServices.companies.findOne({
      _id: company_id,
    });
    console.log('create or update in procore: ', company);
    if (!company) return console.error('No company found for id', company_id);
    if (!company.procoreId) {
      company = await this.find_procore_company(company, account);
    }

    if (company && company.procoreId)
      await this.update_company(company, account);
    else await this.create_company(company_id, account);
  }

  async create_company(company_id: string, account: Account) {
    try {
      // in this situation the company will likely be null so we want to get it from DB
      let company = await this.dataServices.companies.findOne({
        _id: company_id,
      });

      if (company.procoreId) {
        console.log(
          'Company already exists. This is a fatal error and should instead be updating',
          company.procoreId,
        );
        return company;
      }

      let vendorUrl = `${process.env.PROCORE_API_URL}rest/v1.0/vendors?company_id=${account.activeProcoreCompanyId}`;

      //let abbreviatedName = company.name.substring(0, 2).toUpperCase();

      let data = {
        company_id: account.activeProcoreCompanyId,
        vendor: {
          name: company.name,
          address: company.address,
          address2: company.address2,
          city: company.city,
          zip: company.zip,
          business_phone: company.businessPhone,
          // "mobile_phone": company.mobilePhone,
          fax_number: company.faxNumber,
          email_address: company.emailAddress,
          is_active: true,
          //  "state_code": company.stateCode,
          authorized_bidder: true,
          prequalified: true,
          //  "abbreviated_name": abbreviatedName,
          vendor_group_id: null,
          parent_id: null,
          // primary_contact: null,
          //primary_contact_id: null,
          //  "primary_contact_id": company.primaryContact.procoreId,
          trade_name: company.name,
        },
      };

      data['vendor']['country_code'] = company.countryCode
        ? company.countryCode
        : 'US';
      company.stateCode
        ? (data['vendor']['state_code'] = company.stateCode)
        : null;

      /*if (company && company.primaryContact){
                data.vendor.primary_contact = {
                    first_name: company.primaryContact.firstName,
                    last_name: company.primaryContact.lastName,
                    business_phone: company.primaryContact.phone,
                    email_address: company.primaryContact.email
                }
            }*/

      /* if (company && company.primaryContact){
                data.vendor.primary_contact_id = company.primaryContact.procoreId;
            }*/
      console.log('Create company data', JSON.stringify(data));

      const options = {
        headers: await this.getHeaders(account),
        data,
        method: 'POST',
      };
      const response = await axios(vendorUrl, options);

      console.log('Create procore company response', response.data);

      if (response && response.data) {
        company.procoreId = response.data.id;
        await company.save();
        return company;
      }
    } catch (err) {
      if (err && err.response && err.response.data) {
        console.error('Error creating company - response:', err.response.data);
      } else {
        console.error('Err creating company - no response', err);
      }
    }
  }

  // wanted to recreate this so it worked a bit better and more precisely without interfering with the existing code base
  async find_procore_company(
    company: Company,
    account: Account,
  ): Promise<Company | null> {
    // Encode the company name to handle spaces and special characters in the URL
    const encoded_company_name = encodeURIComponent(company.name);

    // URLs for both customers and vendors
    const url = `${process.env.PROCORE_API_URL}rest/v1.0/vendors?filters[search]=${encoded_company_name}&company_id=${account.activeProcoreCompanyId}`;
    console.log('customer_url', url);

    const options = {
      headers: await this.getHeaders(account),
      method: 'GET',
    };

    try {
      // Perform searches
      const company_response = await axios(url, options);

      // Combine results if both responses are successful
      if (company_response.status === 200) {
        const results = company_response.data;

        // Check if exactly one unique company is found
        if (results.length > 0) {
          console.log('procore company search results: ', results);
          console.log('results[0] ', results[0]);
          company.procoreId = results[0].id;
          await company.save();
          console.log('Found procore company', company);
          return company;
        } else {
          console.log('No unique company found, count:', results.length);
          return null; // Return null prompting the creation of a company
        }
      } else {
        console.log(`Error retrieving data: ${company_response.status}`);
        return null; // Return null due to errors in API responses
      }
    } catch (error) {
      console.error('Error in find_procore_company:', error);
      return null; // Return null in case of error
    }
  }

  async search_companies(name: string) {
    let account = await this.dataServices.accounts.findOne({});
    // Encode the company name to handle spaces and special characters in the URL
    const encoded_company_name = encodeURIComponent(name);
    const vendor_url = `${process.env.PROCORE_API_URL}rest/v1.0/vendors?filters[search]=${encoded_company_name}&company_id=${account.activeProcoreCompanyId}`;

    const options = {
      headers: await this.getHeaders(account),
      method: 'GET',
    };

    try {
      // Perform searches
      const vendor_response = await axios(vendor_url, options);

      // Combine results if both responses are successful
      if (vendor_response.status === 200) {
        const results = vendor_response.data;
        console.log('procore company search results: ', results);
        return results;
      } else {
        console.log(`Error retrieving data: ${vendor_response.status}`);
        return null; // Return null due to errors in API responses
      }
    } catch (error) {
      console.error('Error in search_companies:', error);
      return null; // Return null in case of error
    }
  }

  async data_cleanup() {
    let companies_with_wrong_procore_id =
      await this.dataServices.companies.find({ procoreId: '562949953435990' });
    console.log(
      'companies_with_wrong_procore_id',
      companies_with_wrong_procore_id,
      companies_with_wrong_procore_id.length,
    );
    for (let company of companies_with_wrong_procore_id) {
      company.procoreId = null;
      await company.save();
    }
  }
}

async function formatDate(dateNum: number) {
  if (!dateNum) return;
  console.log('Date num', dateNum);
  return DateTime.fromMillis(dateNum).toISODate();
}

function dateToMillis(dateStr: string): number {
  if (!dateStr) return;
  return DateTime.fromISO(dateStr, { zone: 'UTC' });
}

function checkWriteEnabled(project: Project | null) {
  if (!project) return true;
  if (project.hsId === '13984100966') {
    return true;
  }
  if (!enableWrites) {
    throw new Error('Writes are disabled');
  }
}

function getParentDirectoryForDocumentType(fileType) {
  if (fileType === '1.0_Public Project Data') {
    return '562950024748605';
  } else if (fileType === '2.2_Quotes') {
    return '562950024748598';
  } else if (fileType === '2.4_Material Tracking') {
    return '562950024748602';
  } else if (fileType === '3.0_Maintenance Documents') {
    return '562950024748593';
  } else if (fileType === '4.2_Deliverables_10%') {
    return '562950024748578';
  } else if (fileType === '4.2_Deliverables_30%') {
    return '562950024748586';
  } else if (fileType === '4.2_Deliverables_Concept') {
    return '562950024748579';
  } else if (fileType === '4.2_Deliverables_Exhibits') {
    return '562950024748581';
  } else if (fileType === '5.1_Bid Package') {
    return '562950024748575';
  } else if (fileType === 'Proposal') {
    return '562950024748574';
  } else if (fileType === '6.1_Invoices') {
    return '562950024748610';
  } else if (fileType === 'External Documents') {
    return '562950024748590';
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function convert_state_or_code(input) {
  const state_map = {
    Alabama: 'AL',
    Alaska: 'AK',
    Arizona: 'AZ',
    Arkansas: 'AR',
    California: 'CA',
    Colorado: 'CO',
    Connecticut: 'CT',
    Delaware: 'DE',
    Florida: 'FL',
    Georgia: 'GA',
    Hawaii: 'HI',
    Idaho: 'ID',
    Illinois: 'IL',
    Indiana: 'IN',
    Iowa: 'IA',
    Kansas: 'KS',
    Kentucky: 'KY',
    Louisiana: 'LA',
    Maine: 'ME',
    Maryland: 'MD',
    Massachusetts: 'MA',
    Michigan: 'MI',
    Minnesota: 'MN',
    Mississippi: 'MS',
    Missouri: 'MO',
    Montana: 'MT',
    Nebraska: 'NE',
    Nevada: 'NV',
    'New Hampshire': 'NH',
    'New Jersey': 'NJ',
    'New Mexico': 'NM',
    'New York': 'NY',
    'North Carolina': 'NC',
    'North Dakota': 'ND',
    Ohio: 'OH',
    Oklahoma: 'OK',
    Oregon: 'OR',
    Pennsylvania: 'PA',
    'Rhode Island': 'RI',
    'South Carolina': 'SC',
    'South Dakota': 'SD',
    Tennessee: 'TN',
    Texas: 'TX',
    Utah: 'UT',
    Vermont: 'VT',
    Virginia: 'VA',
    Washington: 'WA',
    'West Virginia': 'WV',
    Wisconsin: 'WI',
    Wyoming: 'WY',
  };

  input = input.trim().toUpperCase();
  if (input.length === 2) {
    // Assuming it's a state code and finding the state name
    for (const [state, code] of Object.entries(state_map)) {
      if (code === input) {
        return state;
      }
    }
  } else {
    // Assuming it's a state name and finding the state code
    return state_map[input] || 'Invalid state name';
  }

  return 'Invalid state code';
}
