import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Render,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { LocalAuthGuard } from '../auth/local-auth.guard';
import { AuthenticatedGuard } from '../auth/authenticated.guard';
import { ProcoreService } from './procore.service';
import { async } from 'rxjs';

@Controller('procore')
export class ProcoreController {
  constructor(private procoreService: ProcoreService) {}

  @UseGuards(AuthenticatedGuard)
  @Get('redirect')
  async authorize(@Request() req, @Res() res, @Query('code') code: string) {
    console.log('Procore Redirect', code);
    const authResponse = await this.procoreService.authorize(code, req.user);
    if (authResponse) {
      const message = encodeURIComponent('ProCore Connected');
      res.redirect(`/dashboard?message=${message}`);
    }
  }

  @UseGuards(AuthenticatedGuard)
  @Get('connect')
  async connect(@Request() req, @Res() res) {
    console.log('Procore connect', req);
    res.redirect(process.env.PROCORE_AUTH_URL);
  }

  @UseGuards(AuthenticatedGuard)
  @Get('projects')
  async getProjects(@Request() req) {
    return await this.procoreService.getProjects(req.user);
  }

  @UseGuards(AuthenticatedGuard)
  @Get('companies')
  async getCompanies(@Request() req) {
    return await this.procoreService.getCompanies(req.user);
  }

  @UseGuards(AuthenticatedGuard)
  @Get('offices')
  async getOffices(@Request() req) {
    return await this.procoreService.getOffices(req.user);
  }

  @UseGuards(AuthenticatedGuard)
  @Get('offices/build')
  async buildOfficeCollection(@Request() req) {
    let officeName = 'Colorado Office';
    return await this.procoreService.lookupOffice(officeName, req.user);
  }

  /*  @UseGuards(AuthenticatedGuard)
    @Get('projects/all/deactivate')
    async deactivateProjects(@Request() req) {
        return await this.procoreService.deactivateAllProjects(req.user);
    }*/

  @UseGuards(AuthenticatedGuard)
  @Get('projects/:projectId')
  async getProject(@Param('projectId') projectId: string, @Request() req) {
    return await this.procoreService.getProject(projectId, req.user);
  }

  @Post('webhook')
  async handleWebhook(@Request() req, @Res() res) {
    console.log('Procore webhook received');
    res.status(200).send();
    try {
      return await this.procoreService.handleWebhook(req, req.body);
    } catch (err) {
      console.error('Handle webhook error', err);
    }
  }

  @Get('projects/webhook/install')
  async installProjectWebhook(@Request() req) {
    return await this.procoreService.registerProjectUpdateWebhook(req.user);
  }

  @Get('projects/:projectId')
  async getProjectById(@Param('projectId') projectId: string, @Request() req) {
    return await this.procoreService.getProjectById(projectId, req.user);
  }

  @Get('projects/:projectId/documents')
  async getProjectDocuments(
    @Param('projectId') projectId: string,
    @Request() req,
  ) {
    return await this.procoreService.getProjectFiles(projectId, req.user);
  }

  @Get('projects/:projectId/vendors/:vendorId/add')
  async addVendorToProject(
    @Param('projectId') projectId: string,
    @Param('vendorId') vendorId: string,
    @Request() req,
  ) {
    return await this.procoreService.addVendorIdToProject(
      projectId,
      vendorId,
      req.user,
    );
  }

  @Get('projects/:projectId/wbscodes/add')
  async createProjectWbsCodes(
    @Param('projectId') projectId: string,
    @Request() req,
  ) {
    return await this.procoreService.addDefaultWBSItemToProject(
      projectId,
      req.user,
    );
  }

  @Get('projects/:projectId/wbscodes/list')
  async getProjectWbsCodesList(
    @Param('projectId') projectId: string,
    @Request() req,
  ) {
    return await this.procoreService.getProjectWBSItems(projectId, req.user);
  }

  @Get('projects/:projectId/contact/:contactId/permissions')
  async getProjectPermissions(
    @Param('projectId') projectId: string,
    @Param('contactId') contactId,
    @Request() req,
  ) {
    return await this.procoreService.setPermissionsForContact(
      projectId,
      contactId,
      req.user,
    );
  }

  @Get('projects/:projectId/contacts')
  async forceCreateProjectContacts(
    @Param('projectId') projectId: string,
    @Request() req,
  ) {
    return await this.procoreService.forceCreateProjectContacts(
      projectId,
      req.user,
    );
  }

  @Get('contacts/:contactId')
  async getContactById(@Param('contactId') contactId: string, @Request() req) {
    return await this.procoreService.getContactById(contactId, req.user);
  }

  @Get('access_token')
  async give_access_token(@Query('password') password: string) {
    if (password !== process.env.ADMIN_PASSWORD) return;
    return await this.procoreService.getAccessToken();
  }

  @Get('search_companies')
  async find_companies(@Query('name') name: string, @Request() req) {
    return await this.procoreService.search_companies(name);
  }
}
