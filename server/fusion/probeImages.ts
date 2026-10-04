import type cloudbase from '@cloudbase/node-sdk'
import { CommandError } from '../../src/fusion/protocol.ts'

// Fixed synthetic one-pixel PNG only. This is a platform probe, NOT the production upload API.
export const PROBE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII='
export const PROBE_BUCKET = '6465-dev-d1gh3jw1gdf06af22-1456231968'
export const imagePath = (projectId: string) => `planner_fusion_probe_images/${projectId}/pixel.png`
export const imageFileId = (projectId: string) => `cloud://dev-d1gh3jw1gdf06af22.${PROBE_BUCKET}/${imagePath(projectId)}`
type Storage = Pick<ReturnType<typeof cloudbase.init>, 'uploadFile' | 'downloadFile' | 'deleteFile'>

export function probeImages(storage: Storage) {
  return async (action: string, projectId: string, input: Record<string, unknown>) => {
    if (!/^fusion-gateway-[a-f0-9-]{36}$/.test(projectId)) throw new CommandError('FORBIDDEN')
    const fileID = imageFileId(projectId)
    if (input.fileID !== fileID) throw new CommandError('FORBIDDEN')
    if (action === 'image.upload') {
      if (input.base64 !== PROBE_PNG) throw new CommandError('INVALID_INPUT')
      const r = await storage.uploadFile({ cloudPath: imagePath(projectId), fileContent: Buffer.from(PROBE_PNG, 'base64') })
      if (('code' in r && r.code) || r.fileID !== fileID) throw Error('PROBE_UPLOAD_FAILED')
      return { fileID, bytes: Buffer.from(PROBE_PNG, 'base64').length }
    }
    if (action === 'image.read') {
      const r = await storage.downloadFile({ fileID })
      if (('code' in r && r.code) || !Buffer.isBuffer(r.fileContent)) throw Error('PROBE_DOWNLOAD_FAILED')
      return { base64: r.fileContent.toString('base64') }
    }
    if (action === 'image.delete') {
      // Exact fixed fixture only, never caller-supplied arbitrary paths or a prefix delete.
      const r = await storage.deleteFile({ fileList: [fileID] })
      if (('code' in r && r.code) || r.fileList?.length !== 1 || r.fileList[0].code !== 'SUCCESS') throw Error('PROBE_DELETE_FAILED')
      return { deleted: true }
    }
    throw new CommandError('INVALID_INPUT')
  }
}
export type ProbeImages = ReturnType<typeof probeImages>
