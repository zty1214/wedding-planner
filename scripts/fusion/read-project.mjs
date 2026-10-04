import { TABLES, readAllPages } from './inventory.mjs'
export async function readPlannerProject(client, projectId) {
  const bundle = {}
  for (const table of TABLES) {
    bundle[table] = await readAllPages(async (offset, size) => {
      const { data, count, error } = await client.from(table).select('*', { count: 'exact' })
        .eq('project_id', projectId).order(table === 'project_config' ? 'project_id' : 'id')
        .range(offset, offset + size - 1).abortSignal(AbortSignal.timeout(20_000))
      if (error) throw Error(`READ_FAILED:${table}:${error.code || 'TRANSPORT_ERROR'}`)
      return { rows: data, count }
    })
  }
  return bundle
}
