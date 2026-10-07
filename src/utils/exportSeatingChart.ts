// 合成导出座位图：主图 + 左侧信息面板（标题 / 统计 / 图例）

const COLORS = {
  primary: '#d4728a',
  primaryDark: '#b85a72',
  panelBg: '#ffffff',
  canvasBg: '#faf9f7',
  textDark: '#4a3728',
  textGray: '#6b7280',
  textLight: '#9ca3af',
  border: '#f0e6e9',
  confirmedFill: '#d4728a',
  confirmedStroke: '#b85a72',
  assignedFill: '#fdf5f7',
  assignedStroke: '#f0c4d0',
  emptyFill: '#f7f6f5',
  emptyStroke: '#ddd9d5',
}

interface ExportStats {
  tables: number
  seats: number
  seated: number
  confirmed: number
}

interface Options {
  stageDataUrl: string
  chartWidth: number // 舞台 CSS 像素宽
  chartHeight: number
  pixelRatio: number
  title: string
  stats: ExportStats
  filename: string
  provenance?: string
  capturedAt?: string
  canDownload?: () => boolean
  download?: boolean
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

export async function exportSeatingChart(opts: Options) {
  const { stageDataUrl, chartWidth, chartHeight, pixelRatio, title, stats, filename } = opts
  const chart = await loadImage(stageDataUrl)

  const s = pixelRatio
  // 面板宽度（CSS px）按画布高度比例，保证协调
  const panelCssW = Math.max(240, Math.round(chartHeight * 0.32))
  const panelW = panelCssW * s
  const chartW = chartWidth * s
  const chartH = chartHeight * s

  const canvas = document.createElement('canvas')
  canvas.width = panelW + chartW
  canvas.height = chartH
  const ctx = canvas.getContext('2d')!

  // 1. 主图（座位画布，已含底色）
  ctx.drawImage(chart, panelW, 0, chartW, chartH)

  // 2. 左侧面板背景
  ctx.fillStyle = COLORS.panelBg
  ctx.fillRect(0, 0, panelW, chartH)
  // 面板右侧分隔线
  ctx.strokeStyle = COLORS.border
  ctx.lineWidth = 1 * s
  ctx.beginPath()
  ctx.moveTo(panelW - 0.5 * s, 0)
  ctx.lineTo(panelW - 0.5 * s, chartH)
  ctx.stroke()

  const pad = 28 * s
  let y = 40 * s

  // 3. 标题
  ctx.fillStyle = COLORS.primary
  ctx.font = `bold ${26 * s}px "PingFang SC", "Microsoft YaHei", sans-serif`
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(title, pad, y + 26 * s, panelW - pad * 2)
  y += 26 * s
  ctx.fillStyle = COLORS.textLight
  ctx.font = `${14 * s}px "PingFang SC", "Microsoft YaHei", sans-serif`
  ctx.fillText('婚礼座位安排图', pad, y + 22 * s)
  y += 22 * s + 28 * s

  if (opts.provenance) {
    ctx.font = `${12 * s}px sans-serif`
    ctx.fillText(opts.provenance, pad, y, panelW - pad * 2)
    y += 20 * s
  }

  // 分隔线
  ctx.strokeStyle = COLORS.border
  ctx.lineWidth = 1 * s
  ctx.beginPath()
  ctx.moveTo(pad, y)
  ctx.lineTo(panelW - pad, y)
  ctx.stroke()
  y += 28 * s

  // 4. 统计
  ctx.fillStyle = COLORS.textDark
  ctx.font = `bold ${16 * s}px "PingFang SC", "Microsoft YaHei", sans-serif`
  ctx.fillText('统计', pad, y + 16 * s)
  y += 16 * s + 22 * s

  const statRows: [string, string][] = [
    ['桌数', `${stats.tables} 桌`],
    ['总座位', `${stats.seats} 个`],
    ['已入座', `${stats.seated} 人`],
    ['已确认', `${stats.confirmed} 人`],
  ]
  ctx.font = `${14 * s}px "PingFang SC", "Microsoft YaHei", sans-serif`
  statRows.forEach(([label, value]) => {
    ctx.fillStyle = COLORS.textGray
    ctx.fillText(label, pad, y + 14 * s)
    ctx.fillStyle = COLORS.textDark
    ctx.font = `bold ${14 * s}px "PingFang SC", "Microsoft YaHei", sans-serif`
    ctx.fillText(value, pad + 90 * s, y + 14 * s)
    ctx.font = `${14 * s}px "PingFang SC", "Microsoft YaHei", sans-serif`
    y += 30 * s
  })
  y += 16 * s

  // 分隔线
  ctx.strokeStyle = COLORS.border
  ctx.beginPath()
  ctx.moveTo(pad, y)
  ctx.lineTo(panelW - pad, y)
  ctx.stroke()
  y += 28 * s

  // 5. 图例
  ctx.fillStyle = COLORS.textDark
  ctx.font = `bold ${16 * s}px "PingFang SC", "Microsoft YaHei", sans-serif`
  ctx.fillText('图例', pad, y + 16 * s)
  y += 16 * s + 24 * s

  const legend: [string, string, string, string][] = [
    ['空位', COLORS.emptyFill, COLORS.emptyStroke, COLORS.textLight],
    ['已分配待确认', COLORS.assignedFill, COLORS.assignedStroke, COLORS.assignedStroke],
    ['确认出席', COLORS.confirmedFill, COLORS.confirmedStroke, '#ffffff'],
  ]
  const swatchR = 13 * s
  legend.forEach(([label, fill, stroke]) => {
    // 圆形色块
    ctx.beginPath()
    ctx.arc(pad + swatchR, y + swatchR, swatchR, 0, Math.PI * 2)
    ctx.fillStyle = fill
    ctx.fill()
    ctx.strokeStyle = stroke
    ctx.lineWidth = 1.5 * s
    ctx.stroke()
    // 文字
    ctx.fillStyle = COLORS.textGray
    ctx.font = `${14 * s}px "PingFang SC", "Microsoft YaHei", sans-serif`
    ctx.fillText(label, pad + swatchR * 2 + 14 * s, y + swatchR + 5 * s)
    y += 38 * s
  })

  // 6. 底部日期
  const dateStr = new Date(opts.capturedAt ?? Date.now()).toLocaleString('zh-CN')
  ctx.fillStyle = COLORS.textLight
  ctx.font = `${12 * s}px "PingFang SC", "Microsoft YaHei", sans-serif`
  ctx.fillText(`${opts.capturedAt ? '取样时间' : '导出时间'}：${dateStr}`, pad, chartH - 30 * s, panelW - pad * 2)

  // 触发下载
  const link = document.createElement('a')
  link.download = filename
  link.href = canvas.toDataURL('image/png')
  if (opts.canDownload && !opts.canDownload()) return
  if (opts.download !== false) link.click()
  return link.href
}
