import { Injectable } from '@nestjs/common'
import * as fs from 'fs'
import * as path from 'path'

@Injectable()
export class UploadsService {
  private readonly uploadDir = path.join(process.cwd(), 'data', 'uploads')

  constructor() {
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true })
    }
  }

  getUploadDir(): string {
    return this.uploadDir
  }
}
