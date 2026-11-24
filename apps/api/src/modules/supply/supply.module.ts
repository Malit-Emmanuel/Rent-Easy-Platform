import { Module } from '@nestjs/common';
import { FilesController } from './files/files.controller';
import { FilesService } from './files/files.service';
import { STORAGE_PORT } from './files/storage.port';
import { buildStorage } from './files/storage.provider';
import { ImportController } from './import/import.controller';
import { ImportService } from './import/import.service';
import { ListingsController } from './listings.controller';
import { ListingsService } from './listings.service';
import { SupplyController } from './supply.controller';
import { SupplyService } from './supply.service';

@Module({
  controllers: [SupplyController, ListingsController, FilesController, ImportController],
  providers: [SupplyService, ListingsService, FilesService, ImportService, { provide: STORAGE_PORT, useFactory: () => buildStorage() }],
  exports: [SupplyService, FilesService, STORAGE_PORT],
})
export class SupplyModule {}
