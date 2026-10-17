import { useState } from 'react'
import { Copy, TriangleAlert } from 'lucide-react'
import type { DerivedGroup, DerivedSeries } from '@/domain/derive/pipeline'
import type { FitOk } from '@/domain/derive/types'
import { groupLabel } from '@/domain/figure/groups'
import { formatR2 } from '@/domain/format/number'
import type { MarkerSymbol } from '@/domain/model'
import { Choice } from '@/components/app/Choice'
import { IconButton } from '@/components/app/IconButton'
import { toast } from '@/components/ui/toast'
import { useT } from '@/i18n/I18nProvider'
import { issueTitle } from '@/i18n/translate'
import { viewRowLabel } from '@/lib/rowLabel'
import { writeClipboardText } from '@/platform/clipboard'
import { useNumberLocale } from '@/state/derived'
import { useUiStore } from '@/state/uiStore'
import { MarkerSwatch } from '@/features/inspector/Swatch'
import { FitResultView } from './FitResultView'
import { fullPrecisionText } from './fullPrecision'
import { parameterCells } from './parameterCells'

const okFit = (g: DerivedGroup): FitOk | null => (g.fit?.status === 'ok' ? g.fit : null)

/**
 * "1.726 ± 0.018" with the ± SE under the value, as tables in papers print it, so a row of several
 * parameters fits the panel. A value sharing a power of ten, "(… ± …)×10ⁿ", stays on one line.
 */
function ValueAndSe({ text }: { text: string }) {
  const m = /^([^()]+) ± ([^()]+)$/.exec(text)
  if (!m) return <>{text}</>
  return (
    <>
      {m[1]} <span className="block text-muted-foreground">± {m[2]}</span>
    </>
  )
}

/**
 * The fits of a series fitted group by group (FitSpec.perGroup): one compact row per group with the
 * parameters ± SE, R² and n, a full-precision copy per group, the groups' warnings named by group, and
 * the complete view (equation, intervals, residual signs) of the group chosen below the table.
 */
export function GroupFitTable({
  series,
  lookOf,
}: {
  series: DerivedSeries
  /** The group's colour and marker in the figure (its swatch). */
  lookOf?: (key: string) => { color: string; symbol: MarkerSymbol; open: boolean }
}) {
  const t = useT()
  const loc = useNumberLocale()
  const advanced = useUiStore((s) => s.level === 'advanced')
  const [detail, setDetail] = useState<string | null>(null)
  const groups = series.split?.groups ?? []
  const rowLabel = viewRowLabel(series.view)
  // One model for every group (one FitSpec): the parameters line up by position.
  const reference = groups.map(okFit).find((f) => f !== null) ?? null
  const params = reference?.params ?? []
  const isLog = reference?.r2Of === 'lnY'
  const xName = series.xColumn.name
  const yName = series.yColumn.name
  // By uid: the key of the no-value group is the empty string, not a usable select value.
  const chosen = groups.find((g) => g.uid === detail && okFit(g))
  const copy = async (fit: FitOk, group: string) => {
    const ok = await writeClipboardText(fullPrecisionText(fit, xName, yName, group))
    if (ok) toast.add({ title: t('common.copied'), type: 'success' })
    else toast.add({ title: issueTitle(t, { code: 'E_CLIPBOARD_DENIED' }), type: 'error' })
  }
  const warnings = groups.flatMap((g) => (okFit(g)?.warnings ?? []).map((w) => ({ g, w })))
  if (!groups.length) return <p className="text-xs text-muted-foreground">{t('fit.noGroups')}</p>

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto overscroll-x-contain">
        <table className="w-full text-xs" data-testid="fit-group-table">
          <caption className="sr-only">{t('fit.groupTable')}</caption>
          <thead>
            <tr className="text-left text-muted-foreground">
              <th scope="col" className="pr-2 pb-1 font-normal">
                {t('fit.group')}
              </th>
              {params.map((p) => (
                <th key={p.symbol} scope="col" className="pr-2 pb-1 font-normal whitespace-nowrap">
                  <span className="font-mono" translate="no">
                    {p.symbol}
                  </span>
                  {p.unit ? ` (${p.unit})` : null}
                </th>
              ))}
              <th scope="col" className="pr-2 pb-1 font-normal whitespace-nowrap">
                {isLog ? t('fit.r2LnY') : t('fit.r2')}
              </th>
              <th scope="col" className="pr-1 pb-1 text-right font-normal">
                n
              </th>
              <th scope="col" className="pb-1">
                <span className="sr-only">{t('fit.copyFull')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const name = groupLabel(g, t)
              const fit = okFit(g)
              const look = lookOf?.(g.key)
              return (
                <tr key={g.key} className="border-t border-border align-top" data-group-key={g.key}>
                  <th scope="row" className="py-1 pr-2 text-left font-medium">
                    <span className="flex min-w-0 items-center gap-1.5">
                      {look ? (
                        <MarkerSwatch color={look.color} symbol={look.symbol} open={look.open} />
                      ) : null}
                      <span className="max-w-24 truncate" title={name}>
                        {name}
                      </span>
                    </span>
                  </th>
                  {fit ? (
                    <>
                      {params.map((ref, k) => {
                        const p = fit.params[k] ?? ref
                        return (
                          <td key={ref.symbol} className="num py-1 pr-2 font-mono whitespace-nowrap">
                            <ValueAndSe text={parameterCells(p, loc, { withUnit: false }).value} />
                          </td>
                        )
                      })}
                      <td className="num py-1 pr-2 font-mono whitespace-nowrap">
                        {fit.r2 === null ? t('common.notAvailable') : formatR2(fit.r2, loc, advanced)}
                      </td>
                    </>
                  ) : (
                    <td colSpan={params.length + 1} className="py-1 pr-2 text-destructive">
                      {g.fit?.status === 'error'
                        ? t('fit.groupFailed', { reason: issueTitle(t, g.fit.error, rowLabel) })
                        : t('common.notAvailable')}
                    </td>
                  )}
                  <td className="num py-1 pr-1 text-right font-mono">
                    {fit ? fit.provenance.nUsed : g.sample.nActive}
                  </td>
                  <td className="py-0.5 text-right">
                    {fit ? (
                      <IconButton
                        size="icon-xs"
                        label={t('fit.copyGroup', { group: name })}
                        onClick={() => void copy(fit, name)}
                      >
                        <Copy aria-hidden />
                      </IconButton>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
        <p>{t('fit.perGroupNote')}</p>
        <p>{t('fit.unweighted')}</p>
        {isLog ? <p>{t('fit.logNote')}</p> : null}
      </div>

      {warnings.length ? (
        <ul className="flex flex-col gap-1.5" data-testid="fit-group-warnings">
          {warnings.map(({ g, w }, k) => (
            <li
              key={`${g.key}-${w.code}-${k}`}
              className="flex gap-2 rounded-md border border-warning/30 bg-warning-surface px-2.5 py-2 text-xs"
            >
              <TriangleAlert className="mt-px size-3.5 shrink-0 text-warning" aria-hidden />
              <span className="min-w-0 font-medium wrap-break-word text-foreground">
                {t('figure.groupIssue', { group: groupLabel(g, t), text: issueTitle(t, w, rowLabel) })}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="rounded-md border border-border bg-info-surface px-2.5 py-2 text-xs leading-snug text-foreground">
        {t('fit.r2Caveat')}
      </div>

      {reference ? (
        <div className="flex flex-col gap-3">
          <Choice<string>
            label={t('fit.groupDetails')}
            value={chosen ? chosen.uid : null}
            placeholder={t('fit.chooseGroup')}
            onChange={setDetail}
            items={groups.filter((g) => okFit(g)).map((g) => ({ value: g.uid, label: groupLabel(g, t) }))}
          />
          {chosen?.fit ? (
            <FitResultView series={series} result={chosen.fit} group={groupLabel(chosen, t)} />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
