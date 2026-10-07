// No connection or default environment here. Caller must supply the isolated target DB.
import { documentKey } from '../../server/fusion/cloudBaseTransactionStore.ts'
/** Explicit target collection names, compatible with the existing gateway document schema. */
export function cloudBaseMigrationStore(db, collections) {
  const environmentId = db?.config?.envName
  if (typeof environmentId !== 'string' || !environmentId) throw Error('EXPLICIT_DATABASE_ENVIRONMENT_REQUIRED')
  if (!collections || ['access', 'current'].some(k => typeof collections[k] !== 'string' || !collections[k])
    || collections.access === collections.current) throw Error('EXPLICIT_COLLECTIONS_REQUIRED')
  return { environmentId, async run(projectId, epoch, body) {
    return db.runTransaction(async tx => {
      const ref = (kind, parts) => tx.collection(collections[kind]).doc(documentKey(projectId, ...parts))
      function checked(result) { if (!result || result.code) throw Error('MIGRATION_DATABASE_FAILED'); return result }
      async function read(kind, parts) {
        const doc = checked(await ref(kind, parts).get()).data
        if (doc === null) return null
        if (doc.projectId !== projectId || !Object.hasOwn(doc, 'payload')) throw Error('MIGRATION_DOCUMENT_SCOPE_MISMATCH')
        return doc.payload
      }
      const put = async (kind, parts, payload) => { checked(await ref(kind, parts).set({ projectId, payload })) }
      return body({
        metadata: () => read('current', ['migration-batch']),
        putMetadata: v => put('current', ['migration-batch'], v),
        unit: key => read('current', key === 'core' ? ['migration-core', epoch] : ['note', epoch, key]),
        putUnit: (key, value) => put('current', key === 'core' ? ['migration-core', epoch] : ['note', epoch, key], value),
        published: async () => {
          const access = await read('access', []), current = await read('current', [])
          if (!access && !current) return null
          if (!access || !current) return { incompletePublication: true }
          const index = await read('current', ['notes', current.dataEpoch])
          return { ...current, access, notesOrder: index?.order ?? [] }
        },
        publish: async value => {
          // All note payloads already exist under the new epoch; access is installed last.
          await put('current', [], { dataEpoch: value.dataEpoch, snapshotRevision: value.snapshotRevision, data: value.data })
          await put('current', ['notes', value.dataEpoch], { revision: 0, order: value.notesOrder })
          await put('access', [], value.access)
        },
      })
    })
  } }
}
