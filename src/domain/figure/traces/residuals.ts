/**
 * Residuals of a fit in the residual panel (xaxis2 matches x, yaxis2): observed − predicted for every
 * row USED by the fit (aligned with provenance.rowIdsUsed); log-linear models show ln y − ln ŷ.
 * A residual whose x cannot be drawn on a log x axis is counted as hidden, like its point.
 */
import type { FitOk } from '@/domain/derive/types'
import type { MarkerSymbol } from '@/domain/model'
import { escapePlotText } from '../escape'
import { cleanNumber, recordField, valueText } from '../labels'
import { drawableOn } from '../logDomain'
import {
  type BuiltTrace,
  type ScatterTrace,
  recordTemplate,
  selectionStyle,
  seriesMarker,
  unitSuffix,
} from './common'
import { type SeriesEnv, envTitle, envUid } from './scatter'

/**
 * `lookOf` (pooled fit of a split series): the colour and symbol of each row's group, so the residuals
 * keep telling the groups apart; rows it does not know keep the env's.
 */
export function residualTrace(
  env: SeriesEnv,
  fit: FitOk,
  lookOf?: (rowId: number) => { color: string; symbol: MarkerSymbol } | undefined,
): BuiltTrace {
  const { s, ctx } = env
  const { t, loc } = ctx
  const xCol = s.view.columns.get(s.spec.x)
  const rows = fit.provenance.rowIdsUsed
  const log = fit.r2Of === 'lnY'
  const x: number[] = []
  const y: number[] = []
  const rowIds: number[] = []
  const customdata: (string | number)[][] = []
  for (let j = 0; j < fit.residuals.length; j++) {
    const xv = fit.residualX[j]
    const row = rows[j]
    if (!drawableOn(xv, env.scales.x)) {
      env.tally?.hide(row)
      continue
    }
    const vi = s.view.rowIndex.get(row)
    x.push(xv)
    y.push(fit.residuals[j])
    rowIds.push(row)
    customdata.push([
      row,
      recordField(s.view, row, t),
      escapePlotText(vi === undefined ? cleanNumber(xv, loc) : valueText(xCol, vi, loc)),
      escapePlotText(cleanNumber(fit.residuals[j], loc, 6)),
    ])
  }
  const size = Math.max(3, s.spec.style.markerSize - 1)
  const uid = envUid(env, 'residuals')
  const residualName = log ? t('figure.residualLn') : t('figure.residual')
  const marker = seriesMarker(env.color, env.symbol, size, s.spec.style.open)
  if (lookOf) {
    const looks = rowIds.map((r) => lookOf(r) ?? { color: env.color, symbol: env.symbol })
    const open = s.spec.style.open
    marker.color = looks.map((l) => l.color)
    marker.symbol = looks.map((l) => (open ? (`${l.symbol}-open` as const) : l.symbol))
    if (open) marker.line = { color: looks.map((l) => l.color), width: 1.5 }
  }
  const trace: ScatterTrace = {
    type: 'scatter',
    uid,
    name: escapePlotText(`${envTitle(env)}: ${residualName}`),
    legendgroup: s.spec.id,
    showlegend: false,
    visible: env.visible,
    mode: 'markers',
    xaxis: 'x2',
    yaxis: 'y2',
    x,
    y,
    customdata,
    marker,
    hovertemplate:
      `<b>${escapePlotText(envTitle(env))}</b><br>${escapePlotText(s.xColumn.name)} = %{customdata[2]}${unitSuffix(s.xColumn.unit)}<br>` +
      `${escapePlotText(residualName)} = %{customdata[3]}${log ? '' : unitSuffix(s.yColumn.unit)}` +
      `<br>${recordTemplate(t, '%{customdata[1]}', s.view)}<extra></extra>`,
    ...selectionStyle(size),
  }
  return { trace, uid, rowIds, datasetId: s.spec.datasetId, markers: env.visible === true ? x.length : 0 }
}
