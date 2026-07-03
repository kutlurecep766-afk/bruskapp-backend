import { Controller, Post, Get, Param, Res, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { diskStorage } from 'multer'
import { extname, join } from 'path'
import { Response } from 'express'
import * as fs from 'fs'
import { UploadsService } from './uploads.service'
import { Public } from '../auth/public.decorator'

@Controller()
export class UploadsController {
  constructor(private uploadsService: UploadsService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: (_req: any, _file: any, cb: any) => {
        const dir = join(process.cwd(), 'data', 'uploads')
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        cb(null, dir)
      },
      filename: (_req: any, file: any, cb: any) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1e9)
        cb(null, unique + extname(file.originalname))
      },
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
  }))
  uploadFile(@UploadedFile() file: any) {
    if (!file) throw new BadRequestException('Dosya gerekli')
    return { url: '/api/uploads/' + file.filename }
  }

  @Public()
  @Get('health')
  health() {
    return { ok: true }
  }

  @Public()
  @Get('uploads/:filename')
  getFile(@Param('filename') filename: string, @Res() res: Response) {
    const filePath = join(process.cwd(), 'data', 'uploads', filename)
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Dosya bulunamadı' })
      return
    }
    res.sendFile(filePath)
  }
}
