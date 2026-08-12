import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { UploadFileDto } from './dto/upload-file.dto';
import { FileEntity } from './entities/file.entity';
import { MAX_FILE_SIZE, UploadsService } from './uploads.service';

@ApiTags('Uploads')
@ApiBearerAuth('access-token')
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload a file',
    description:
      'Uploads a file and returns its id + public URL. Reference the file id from other endpoints (e.g. medical reports later). Allowed: jpeg, png, webp, pdf — max 10 MB.',
  })
  @ApiResponse({ status: 201, type: FileEntity })
  @ApiResponse({ status: 400, description: 'Missing file, bad type, or too large.' })
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadFileDto,
  ) {
    return this.uploadsService.upload(file, user.id, dto.purpose);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get metadata of one of your uploaded files' })
  @ApiResponse({ status: 200, type: FileEntity })
  @ApiResponse({ status: 403, description: 'File belongs to another user.' })
  @ApiResponse({ status: 404, description: 'File not found.' })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.uploadsService.findOwned(id, user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete one of your uploaded files',
    description: 'Removes the object from storage and its database record.',
  })
  @ApiResponse({ status: 204, description: 'Deleted.' })
  @ApiResponse({ status: 403, description: 'File belongs to another user.' })
  @ApiResponse({ status: 404, description: 'File not found.' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.uploadsService.remove(id, user.id);
  }
}
