import { useState } from 'react'
import type { ColumnId, DatasetId } from '@/domain/model'
import type { ColumnSummary } from '@/domain/derive/types'
import { decimalsOfText, formatStat, type NumberFormatLocale } from '@/domain/format/number'
import { groupSummaries, zeroSpreadIssue } from '@/domain/stats/groups'
import { CELL, type AnalysisSample, type DatasetView } from '@/domain/derive/types'
import { INACTIVE, effectiveSettings, type ColumnMeta } from '@/domain/model'
import { Choice } from '@/components/app/Choice'
import { Section } from '@/components/app/Section'
import { InfoTip, IssueList } from '@/components/app/Feedback'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/I18nProvider'
import type { Translator } from '@/i18n/translate'
import { useDerived, useNumberLocale } from '@/state/derived'
import { ui, useUiStore } from '@/state/uiStore'
import { columnLabel } from './columnOptions'

export function StatsPanel() {
  const t = useT()
  const loc = useNumberLocale()
  const derived = useDerived()
  const level = useUiStore((s) => s.level)
  const datasets = derived.doc.datasets
  const firstSeries = derived.series[0]
  const [datasetId, setDatasetId] = useState<DatasetId | null>(null)
  const ds =
    datasets.find((d) => d.id === datasetId) ??
    datasets.find((d) => d.id === firstSeries?.spec.datasetId) ??
    datasets[0]
  // Numeric columns only: dates and times have no descriptive statistics here (columnSummary is null),
  // and listing them would show an empty "0 of n rows" sample.
  const numericCols = ds
    ? ds.columns.filter((c) => effectiveSettings(c).kind === 'numeric' && c.role !== 'ignore')
    : []
  const [columnId, setColumnId] = useState<ColumnId | null>(null)
  const plot = derived.plot
  const plotted = firstSeries?.spec.y ?? plot?.box.value ?? plot?.histogram.value ?? plot?.bar.value ?? null
  const col =
    numericCols.find((c) => c.id === columnId) ??
    numericCols.find((c) => c.id === plotted) ??
    numericCols.find((c) => c.role === 'measurement') ??
    numericCols[0]
  if (!ds || !col) return <p className="p-3 text-sm text-muted-foreground">{t('stats.pickColumn')}</p>
  const summary = derived.columnSummary(ds.id, col.id)
  const sample = derived.columnSample(ds.id, [col.id])
  const view = derived.views.get(ds.id)
  const parsed = view?.columns.get(col.id)
  const valueOf = (rowId: number) => {
    const i = view?.rowIndex.get(rowId)
    return i === undefined || !parsed ? null : parsed.values[i]
  }
  const advanced = level !== 'beginner'
  // Display precision of quartiles and range follows the recorded data (decimals of the original text).
  let dataDecimals: number | null = null
  if (parsed) {
    for (let i = 0; i < parsed.text.length; i++)
      if (parsed.status[i] === CELL.ok)
        dataDecimals = Math.max(dataDecimals ?? 0, Math.min(10, decimalsOfText(parsed.text[i])))
  }
  const groupCol = ds.columns.find((c) => c.role === 'group' && c.id !== col.id)

  return (
    <div>
      <Section title={t('stats.title')}>
        {datasets.length > 1 ? (
          <Choice<DatasetId>
            label={t('common.dataset')}
            value={ds.id}
            onChange={(v) => {
              setDatasetId(v)
              setColumnId(null)
            }}
            items={datasets.map((d) => ({ value: d.id, label: d.name }))}
          />
        ) : null}
        <Choice<ColumnId>
          label={t('stats.column')}
          value={col.id}
          onChange={setColumnId}
          items={numericCols.map((c) => ({ value: c.id, label: columnLabel(c) }))}
        />
        {sample && summary ? (
          <p className="text-xs text-muted-foreground" data-testid="stats-sample">
            <span className="font-medium text-foreground">{t('stats.sample')}:</span>{' '}
            {t('stats.sampleText', {
              n: summary.n,
              total: sample.nTotal,
              excluded: sample.counts.excluded,
              filtered: sample.counts.filtered,
              missing: sample.counts.missing + sample.counts.invalid,
            })}
          </p>
        ) : null}
      </Section>
      {summary ? (
        <Section title={columnLabel(col)}>
          <StatsTable
            s={summary}
            loc={loc}
            t={t}
            advanced={advanced}
            unit={col.unit}
            valueOf={valueOf}
            dataDecimals={dataDecimals}
          />
          {advanced && summary.outlierCandidates.length ? (
            <Button
              size="sm"
              variant="outline"
              className="self-start bg-background"
              onClick={() =>
                ui.set({
                  selection: {
                    datasetId: ds.id,
                    rowIds: new Set(summary.outlierCandidates),
                    origin: 'table',
                    anchor: null,
                  },
                  tableOpen: true,
                })
              }
            >
              {t('stats.outliersShow', { n: summary.outlierCandidates.length })}
            </Button>
          ) : null}
          {/* Every warning the summary carries, with its hint: the hint says what to do about it. */}
          <IssueList issues={summary.warnings} />
        </Section>
      ) : null}
      {summary && groupCol && view && sample && advanced ? (
        <GroupStats
          view={view}
          valueCol={col}
          groupCol={groupCol}
          sample={derived.columnSample(ds.id, [col.id, groupCol.id]) ?? sample}
          loc={loc}
          t={t}
        />
      ) : null}
    </div>
  )
}

/** Per-group summary (e.g. pendulum timings per observer), on the active sample. */
function GroupStats({
  view,
  valueCol,
  groupCol,
  sample,
  loc,
  t,
}: {
  view: DatasetView
  valueCol: ColumnMeta
  groupCol: ColumnMeta
  sample: AnalysisSample
  loc: NumberFormatLocale
  t: Translator
}) {
  const values = view.columns.get(valueCol.id)?.values
  const g = view.columns.get(groupCol.id)
  if (!values || !g) return null
  const keys = Array.from({ length: view.rowIds.length }, (_, i) =>
    g.categories ? (g.categories.labels[g.categories.codes[i]] ?? '') : g.text[i],
  )
  const groups = groupSummaries(keys, values, view.rowIds, (i) => sample.reason[i] === INACTIVE.active, {
    level: 0.95,
    numericKey: false,
  })
  if (groups.length < 2) return null
  // A group of identical values has SD = SEM = 0: not an uncertainty of zero, so it is always explained.
  const zero = zeroSpreadIssue(groups)
  const title = `${t('stats.groupsTitle')}: ${groupCol.name}`
  return (
    <Section title={title}>
      <table className="w-full text-sm" data-testid="stats-groups">
        <caption className="sr-only">{title}</caption>
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th scope="col" className="pb-1 font-normal">
              {t('stats.group')}
            </th>
            <th scope="col" className="pb-1 text-right font-normal">
              <abbr title={t('stats.n')}>n</abbr>
            </th>
            <th scope="col" className="pb-1 text-right font-normal">
              {t('stats.mean')}
            </th>
            <th scope="col" className="pb-1 text-right font-normal">
              <abbr title={t('stats.sd')}>SD</abbr>
            </th>
            <th scope="col" className="pb-1 text-right font-normal">
              <abbr title={t('stats.sem')}>SEM</abbr>
            </th>
          </tr>
        </thead>
        <tbody>
          {groups.map((gr) => (
            <tr key={gr.key} className="border-t border-border">
              <th scope="row" className="py-1 pr-2 text-left font-normal">
                {gr.key}
              </th>
              <td className="num py-1 text-right font-mono">{gr.n}</td>
              <td className="num py-1 text-right font-mono">
                {formatStat('mean', gr.mean, { sem: gr.sem, loc })}
              </td>
              <td className="num py-1 text-right font-mono">
                {gr.sd === null ? t('common.notAvailable') : formatStat('sd', gr.sd, { loc })}
              </td>
              <td className="num py-1 text-right font-mono">
                {gr.sem === null ? t('common.notAvailable') : formatStat('sem', gr.sem, { loc })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {zero ? (
        <IssueList
          issues={[zero]}
          onShowRows={(rows) =>
            ui.set({
              selection: { datasetId: view.datasetId, rowIds: new Set(rows), origin: 'table', anchor: null },
              tableOpen: true,
            })
          }
        />
      ) : null}
    </Section>
  )
}

function StatsTable({
  s,
  loc,
  t,
  advanced,
  unit,
  valueOf,
  dataDecimals,
}: {
  s: ColumnSummary
  loc: NumberFormatLocale
  t: Translator
  advanced: boolean
  unit: string | null
  valueOf: (rowId: number) => number | null
  dataDecimals: number | null
}) {
  const na = t('common.notAvailable')
  const f = (kind: Parameters<typeof formatStat>[0], v: number | null, extra: { rawText?: string } = {}) =>
    v === null || Number.isNaN(v) ? na : formatStat(kind, v, { sem: s.sem, loc, dataDecimals, ...extra })
  const rows: { key: string; label: string; value: string; tip: string; show: boolean }[] = [
    { key: 'n', label: t('stats.n'), value: String(s.n), tip: t('stats.tips.n'), show: true },
    {
      key: 'missing',
      label: t('stats.missing'),
      value: String(s.nMissing + s.nInvalid),
      tip: t('stats.tips.missing'),
      show: true,
    },
    { key: 'mean', label: t('stats.mean'), value: f('mean', s.mean), tip: t('stats.tips.mean'), show: true },
    {
      key: 'median',
      label: t('stats.median'),
      value: f('median', s.median),
      tip: t('stats.tips.median'),
      show: true,
    },
    { key: 'sd', label: t('stats.sd'), value: f('sd', s.sd), tip: t('stats.tips.sd'), show: true },
    { key: 'sem', label: t('stats.sem'), value: f('sem', s.sem), tip: t('stats.tips.sem'), show: advanced },
    {
      key: 'ci',
      label: t('stats.ci'),
      value: s.ci ? `[${f('ci', s.ci[0])}; ${f('ci', s.ci[1])}]` : na,
      tip: t('stats.tips.ci'),
      show: advanced,
    },
    {
      key: 'min',
      label: t('stats.min'),
      value: f('min', s.min, { rawText: undefined }),
      tip: t('stats.tips.min'),
      show: true,
    },
    { key: 'max', label: t('stats.max'), value: f('max', s.max), tip: t('stats.tips.max'), show: true },
    {
      key: 'range',
      label: t('stats.range'),
      value: f('range', s.range),
      tip: t('stats.tips.range'),
      show: true,
    },
    { key: 'q1', label: t('stats.q1'), value: f('quartile', s.q1), tip: t('stats.tips.q1'), show: advanced },
    { key: 'q3', label: t('stats.q3'), value: f('quartile', s.q3), tip: t('stats.tips.q3'), show: advanced },
    {
      key: 'iqr',
      label: t('stats.iqr'),
      value: f('quartile', s.iqr),
      tip: t('stats.tips.iqr'),
      show: advanced,
    },
    {
      key: 'fences',
      label: t('stats.fences'),
      value: s.fences ? `[${f('quartile', s.fences[0])}; ${f('quartile', s.fences[1])}]` : na,
      tip: t('stats.tips.fences'),
      show: advanced,
    },
    {
      key: 'outliers',
      label: t('stats.outliers'),
      value:
        s.q1 === null
          ? na
          : s.outlierCandidates.length
            ? // Formatted like the maximum, so they read the same in either language; "; " because a
              // decimal comma would make ", " ambiguous.
              s.outlierCandidates.map((r) => f('max', valueOf(r))).join('; ')
            : t('stats.outliersNone'),
      tip: t('stats.tips.outliers'),
      show: advanced,
    },
  ]
  return (
    <table className="w-full text-sm" data-testid="stats-table">
      <caption className="sr-only">{t('stats.title')}</caption>
      <tbody>
        {rows
          .filter((r) => r.show)
          .map((r) => (
            <tr key={r.key} className="border-b border-border last:border-b-0" data-stat={r.key}>
              <th scope="row" className="py-1 pr-2 text-left align-top font-normal text-muted-foreground">
                <span className="inline-flex items-center gap-0.5">
                  {r.label}
                  <InfoTip text={r.tip} label={`${r.label}: ${r.tip}`} />
                </span>
              </th>
              <td className="num py-1 text-right align-top font-mono">
                {r.value}
                {unit &&
                !['n', 'missing'].includes(r.key) &&
                (r.key !== 'outliers' || s.outlierCandidates.length > 0) &&
                r.value !== na ? (
                  <span className="ml-1 font-sans text-xs text-muted-foreground">{unit}</span>
                ) : null}
              </td>
            </tr>
          ))}
      </tbody>
    </table>
  )
}
