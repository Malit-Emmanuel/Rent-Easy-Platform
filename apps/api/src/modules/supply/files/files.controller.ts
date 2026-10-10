import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { Roles } from '../../../common/rbac';
import { ARCHIVE, READ, WRITE } from '../supply.roles';
import { checkFileRequest } from './files.rules';
import { FilesService } from './files.service';

const uuid = () => new ParseUUIDPipe();
const P = 'orgs/:orgId/properties/:propertyId/files';

@Controller()
export class FilesController {
  constructor(@Inject(FilesService) private svc: FilesService) {}

  @Get('document-types') documentTypes() { return this.svc.documentTypes(); }

  @Post(P) @Roles(...WRITE)
  request(@Req() req: any, @Param('orgId', uuid()) o: string, @Param('propertyId', uuid()) p: string, @Body() b: any) {
    const c = checkFileRequest(b); if (c.errors.length) throw new BadRequestException(c.errors.join('; '));
    return this.svc.requestUpload(o, p, req.user.id, c.value);
  }

  @Post(`${P}/:fileId/complete`) @HttpCode(200) @Roles(...WRITE)
  complete(@Req() req: any, @Param('orgId', uuid()) o: string, @Param('propertyId', uuid()) p: string, @Param('fileId', uuid()) f: string) { return this.svc.complete(o, p, f, req.user.id); }

  @Get(P) @Roles(...READ)
  list(@Param('orgId', uuid()) o: string, @Param('propertyId', uuid()) p: string, @Query('unitId') unitId?: string) {
    if (unitId && unitId !== 'none' && !/^[0-9a-f-]{36}$/i.test(unitId)) throw new BadRequestException('unitId must be an id or none');
    return this.svc.list(o, p, unitId);
  }

  @Get(`${P}/:fileId/link`) @Roles(...READ)
  link(@Req() req: any, @Param('orgId', uuid()) o: string, @Param('propertyId', uuid()) p: string, @Param('fileId', uuid()) f: string) { return this.svc.link(o, p, f, req.user.id); }

  @Delete(`${P}/:fileId`) @HttpCode(204) @Roles(...ARCHIVE)
  async remove(@Req() req: any, @Param('orgId', uuid()) o: string, @Param('propertyId', uuid()) p: string, @Param('fileId', uuid()) f: string) { await this.svc.remove(o, p, f, req.user.id); }
}
