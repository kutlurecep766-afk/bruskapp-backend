import { Controller, Get, Param, Res } from '@nestjs/common'
import { Public } from '../auth/public.decorator'
import { Response } from 'express'
import * as path from 'path'
import * as fs from 'fs'

const ICONS: Record<string, string> = {
  whatsapp: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 39 39"><defs><linearGradient id="wa" x1="0.5" y1="0" x2="0.5" y2="1"><stop offset="0" stop-color="#25D366"/><stop offset="1" stop-color="#128C7E"/></linearGradient></defs><circle cx="19.5" cy="19.5" r="19.5" fill="url(#wa)"/><path fill="#fff" d="M10.3 28.7l1.9-7c-.9-1.6-1.4-3.4-1.4-5.2C10.8 11.2 15 7 20.2 7c2.5 0 4.8.9 6.6 2.7 1.8 1.8 2.7 4.1 2.7 6.6 0 5.2-4.2 9.4-9.4 9.4-1.8 0-3.5-.5-5-1.4l-7 1.9zm4.7-2.9l.4.3c1.4.9 3.1 1.4 4.8 1.4 4.3 0 7.8-3.5 7.8-7.8 0-2.1-.8-4-2.3-5.5s-3.4-2.3-5.5-2.3c-4.3 0-7.8 3.5-7.8 7.8 0 1.7.5 3.3 1.5 4.6l.3.4-.9 3.4 3.4-.9z"/></svg>`,
  instagram: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 39 39"><defs><radialGradient id="ig" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#F58529"/><stop offset="0.25" stop-color="#FEDA77"/><stop offset="0.4" stop-color="#DD2A7B"/><stop offset="0.6" stop-color="#8134AF"/><stop offset="0.85" stop-color="#515BD4"/></radialGradient></defs><circle cx="19.5" cy="19.5" r="19.5" fill="url(#ig)"/><rect x="8" y="8" width="23" height="23" rx="5.5" fill="none" stroke="#fff" stroke-width="2.2"/><circle cx="19.5" cy="19.5" r="5.5" fill="none" stroke="#fff" stroke-width="2.2"/><circle cx="26" cy="13" r="1.8" fill="#fff"/></svg>`,
  facebook: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 39 39"><circle cx="19.5" cy="19.5" r="19.5" fill="#1877F2"/><path fill="#fff" d="M24.5 7v6H22c-1 0-1.8.8-1.8 1.8v3.6h4.2l-.6 4.4H20v11h-4.6v-11h-3.4v-4.4h3.4V14c0-3.8 3-6.8 6.8-6.8h3.3z"/></svg>`,
  telegram: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 39 39"><circle cx="19.5" cy="19.5" r="19.5" fill="#0088CC"/><path fill="#fff" d="M14.6 27c-.5 0-.5-.2-.4-.7l1.8-8.2s.1-.4.5-.2l5.2 3.2c.3.2.5.1.5-.1l5.2-6.1c.3-.3.6-.2.4 0L14.8 27.8c-.1.1-.2.2-.2.2z"/></svg>`,
}

@Controller('push')
export class PushController {
  @Public()
  @Get('icons/:name')
  getIcon(@Param('name') name: string, @Res() res: Response) {
    const svg = ICONS[name.toLowerCase()]
    if (!svg) { res.status(404).send('Not found'); return }
    res.setHeader('Content-Type', 'image/svg+xml')
    res.setHeader('Cache-Control', 'public, max-age=31536000')
    res.send(svg)
  }
}
