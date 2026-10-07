import { useEffect, useMemo, useRef } from 'react'
import type Konva from 'konva'
import SeatingCanvas from '../components/seating/SeatingCanvas'
import { exportSeatingChart } from '../utils/exportSeatingChart'
import { seatingExportModel } from './seatingExport'
import type { ExportSnapshot, projectRepository } from './repository'

/** A separate canvas never changes the live viewport or reads its later edits. */
export default function SeatingExport({ value, repo, onDone }: { value: ExportSnapshot; repo: ReturnType<typeof projectRepository>; onDone(error?: string, image?: string): void }) {
  const model = useMemo(() => seatingExportModel(value), [value])
  const stage = useRef<Konva.Stage | null>(null)
  useEffect(() => {
    let cancelled = false
    const allowed = () => !cancelled && !!repo.getSnapshot().snapshot && repo.getSnapshot().status !== 'forbidden'
    void (async () => {
      await document.fonts.ready
      if (!allowed()) return
      if (!stage.current) throw Error('CANVAS_NOT_READY')
      stage.current.draw()
      const image = await exportSeatingChart({ stageDataUrl: stage.current.toDataURL({ pixelRatio: 3 }), chartWidth: model.viewport.width, chartHeight: model.viewport.height,
        pixelRatio: 3, title: model.title, stats: model.stats, filename: model.filename, provenance: model.provenance, capturedAt: model.capturedAt, canDownload: allowed, download: false })
      if (allowed()) onDone(undefined, image)
    })().catch(() => { if (!cancelled) onDone('座位图生成失败，请重试。') })
    return () => { cancelled = true }
  }, [model, repo, onDone])
  return <div aria-hidden="true" style={{ position: 'fixed', left: -10000, top: 0, width: model.viewport.width, height: model.viewport.height, pointerEvents: 'none', display: 'flex' }}>
    <SeatingCanvas fixedData={model.data} selectedTableId={null} onSelectTable={() => {}} stageRef={stage} viewport={model.viewport} onViewportChange={() => {}} />
  </div>
}
