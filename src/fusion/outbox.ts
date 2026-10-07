import { assertCommand, canonicalJson, commandDigest, CommandError } from './protocol.ts'
import type { Command, Receipt } from './protocol.ts'
export type PendingStatus = 'prepared' | 'result_unknown' | 'conflict' | 'forbidden' | 'failed'
export interface Pending { command: Command; status: PendingStatus; sequence?: number }
export interface DraftArchive { id: string; projectId: string; savedAt: string; drafts: Pending[] }
export interface ConfirmedCopy { projectId: string; capturedAt: string; snapshot: import('./repository.ts').ProjectSnapshot }
export interface OutboxStorage {
  archiveBatch?(projectId: string, expected: Pending[]): Promise<void>
  listArchives?(projectId: string): Promise<DraftArchive[]>
  /** Cached comparison baseline, never authorization or a substitute for a live read. */
  saveConfirmed?(value: ConfirmedCopy): Promise<void>
  readDraftBaseline?(projectId: string): Promise<ConfirmedCopy | undefined>
  readConfirmed?(projectId: string): Promise<ConfirmedCopy | undefined>
  clearConfirmed?(projectId: string): Promise<void>
  insert(value: Pending): Promise<void>
  /** Durable insertion order; legacy entries without an order must not be auto-replayed. */
  list(projectId: string, epoch?: string): Promise<Pending[]>
  get(projectId: string, epoch: string, operationId: string): Promise<Pending | undefined>
  setStatus(projectId: string, epoch: string, operationId: string, status: PendingStatus): Promise<void>
  removeBatch(projectId: string, expected: Pending[]): Promise<void>
  remove(projectId: string, epoch: string, operationId: string): Promise<void>
}
export interface CommandTransport {
  queryReceipt(command: Command): Promise<Receipt | null>
  execute(command: Command): Promise<Receipt>
}
export type SendResult = { status: 'synced'; receipt: Receipt } | { status: PendingStatus }

/** UI owns reopen confirmation and project queue ordering; this module never auto-resumes. */
export function durableOutbox(storage: OutboxStorage, transport: CommandTransport) {
  async function confirm(projectId: string, epoch: string, operationId: string): Promise<Receipt | null> {
    const saved = await storage.get(projectId, epoch, operationId)
    if (!saved) return null
    const c = saved.command
    if (c.projectId !== projectId || c.dataEpoch !== epoch || c.operationId !== operationId) throw Error('OUTBOX_SCOPE_MISMATCH')
    const receipt = await transport.queryReceipt(structuredClone(c))
    if (!receipt) return null
    if (receipt.projectId !== projectId || receipt.dataEpoch !== epoch || receipt.operationId !== operationId || receipt.requestDigest !== await commandDigest(c)) throw new CommandError('OPERATION_ID_REUSED')
    await storage.remove(projectId, epoch, operationId)
    return receipt
  }
  return {
    confirm,
    async prepare(input: Command) {
      assertCommand(input)
      const command = structuredClone(input)
      await storage.insert({ command, status: 'prepared' })
    },
    async send(projectId: string, epoch: string, operationId: string): Promise<SendResult> {
      const saved = await storage.get(projectId, epoch, operationId)
      if (!saved) throw new Error('OUTBOX_ENTRY_MISSING')
      const command = saved.command
      if (command.projectId !== projectId || command.dataEpoch !== epoch || command.operationId !== operationId) throw new Error('OUTBOX_SCOPE_MISMATCH')
      if (saved.status !== 'prepared' && saved.status !== 'result_unknown') return { status: saved.status }
      // A crash after this transaction is indistinguishable from a lost response.
      await storage.setStatus(projectId, epoch, operationId, 'result_unknown')
      let receipt: Receipt
      try {
        const existing = await transport.queryReceipt(structuredClone(command))
        receipt = existing ?? await transport.execute(structuredClone(command))
        if (receipt.projectId !== projectId || receipt.dataEpoch !== epoch || receipt.operationId !== operationId) throw new Error('RECEIPT_SCOPE_MISMATCH')
        if (receipt.requestDigest !== await commandDigest(command)) throw new CommandError('OPERATION_ID_REUSED')
      } catch (error) {
        const status: PendingStatus = error instanceof CommandError
          ? error.code === 'FORBIDDEN' ? 'forbidden'
            : error.code === 'CONFLICT' || error.code === 'PROJECT_REPLACED' || error.code === 'SEAT_OCCUPIED' ? 'conflict' : 'failed'
          : 'result_unknown'
        await storage.setStatus(projectId, epoch, operationId, status)
        return { status }
      }
      // Failed cleanup propagates as local persistence failure. Reopening queries the same receipt.
      await storage.remove(projectId, epoch, operationId)
      return { status: 'synced', receipt }
    },
  }
}
export function assertSameRequest(a: Command, b: Command) {
  if (canonicalJson(a) !== canonicalJson(b)) throw new CommandError('OPERATION_ID_REUSED')
}
