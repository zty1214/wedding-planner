import { monthDays } from '../../src/fusion/activity.ts'
import type { ActivityMonth, SnapshotState } from '../../src/fusion/activity.ts'
import { authorize } from './commandService.ts'
import type { TransactionStore } from './commandService.ts'
import { businessDay } from './businessTime.ts'

/** Read only the selected month's small daily documents; never load snapshot bodies. */
export function activityService(store: TransactionStore, now = () => new Date()) {
  return {
    async month(projectId: string, secret: string, month: string): Promise<ActivityMonth> {
      const dates = monthDays(month)
      return store.run(projectId, async tx => {
        authorize(await tx.access(), secret)
        const date = now(), today = businessDay(date), history = await tx.historyIndex()
        const state = await tx.dailyState()
        const days: ActivityMonth['days'] = []
        for (const day of dates) {
          const activity = await tx.activity(day), version = history.find(v => v.kind === 'daily' && v.businessDate === day)
          const snapshot: SnapshotState = version ? version.expiresAt && Date.parse(version.expiresAt) <= date.getTime() ? 'expired' : 'ready'
            : day === today ? 'today' : state?.businessDate === day && state.failedAt && !state.sealed ? 'failed' : activity.count ? 'pending' : 'none'
          days.push({ activity, snapshot })
        }
        return { month, today, days }
      })
    },
  }
}
