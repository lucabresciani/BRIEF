import { Copy } from 'lucide-react'
import type { FitOk, FitResult, FitParameter } from '@/domain/derive/types'
import type { DerivedSeries } from '@/domain/derive/pipeline'
import { formatNumber, formatR2, type NumberFormatLocale } from '@/domain/format/number'
import { derivedParameter } from '@/domain/fit/derived'
import { IssueList, IssueNote, InfoTip } from '@/components/app/Feedback'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { useT } from '@/i18n/I18nProvider'
import { issueTitle, type Translator } from '@/i18n/translate'
import { useNumberLocale } from '@/state/derived'
import { useUiStore } from '@/state/uiStore'
import { writeClipboardText } from '@/platform/clipboard'
import { centredVariable } from '@/domain/figure/caption'
import { equationText } from './equationText'
import { fullPrecisionText } from './fullPrecision'
import { parameterCells } from './parameterCells'
import { viewRowLabel } from '@/lib/rowLabel'

/**
 * Equation, parameters with SE and CI, goodness of fit and diagnostics of one fit. `group`: the group
 * of a per-group fit, named in the full-precision copy (pasted elsewhere, it must say whose fit it is).
 */
export function FitResultView({
  series,
  result,
  group,
}: {
  series: DerivedSeries
  result: FitResult
  group?: string
}) {
  const t = useT()
  if (result.status === 'error')
    return <IssueNote issue={result.error} rowLabel={viewRowLabel(series.view)} />
  return <FitOkView series={series} fit={result} t={t} group={group} />
}

function FitOkView({
  series,
  fit,
  t,
  group,
}: {
  series: DerivedSeries
  fit: FitOk
  t: Translator
  group?: string
}) {
  const loc = useNumberLocale()
  const advanced = useUiStore((s) => s.level === 'advanced')
  const xName = series.xColumn.name
  const yName = series.yColumn.name
  const level = Math.round(fit.provenance.confidence * 100)
  const isLog = fit.model.type === 'exponential' || fit.model.type === 'power'
  const sTip = isLog ? t('fit.tips.sLog') : t('fit.tips.s')
  const prov = fit.provenance
  const excluded = prov.inactive.excluded + prov.inactive.filtered
  const g =
    fit.model.type === 'polynomial' &&
    fit.model.degree === 2 &&
    series.view &&
    series.yColumn.unit === 'm' &&
    series.xColumn.unit === 's'
      ? derivedParameter(fit, [0, 0, 2], { symbol: 'g', unit: 'm/s²' })
      : null
  const centredX =
    !isLog && fit.equation.form === 'centred' && fit.equation.x0 !== null
      ? centredVariable(xName, fit.equation.x0, loc)
      : null

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{t('fit.equation')}</span>
          <Button
            size="xs"
            variant="ghost"
            onClick={async () => {
              const ok = await writeClipboardText(fullPrecisionText(fit, xName, yName, group))
              if (ok) toast.add({ title: t('common.copied'), type: 'success' })
              else toast.add({ title: issueTitle(t, { code: 'E_CLIPBOARD_DENIED' }), type: 'error' })
            }}
          >
            <Copy aria-hidden />
            {t('fit.copyFull')}
          </Button>
        </div>
        {/* The equation is the result that changes when the data or the model change: announce it politely. */}
        <p
          className="rounded-md border border-border bg-background px-2.5 py-2 font-mono text-sm leading-relaxed break-words"
          data-testid="fit-equation"
          aria-live="polite"
          aria-atomic="true"
          translate="no"
        >
          {equationText(fit, xName, yName, loc)}
        </p>
      </div>

      {/* A value never breaks inside "(x ± u) unit"; very long ×10ⁿ values scroll instead of overflowing. */}
      <div className="overflow-x-auto overscroll-x-contain">
        <table className="w-full text-sm" data-testid="fit-parameters">
          <caption className="sr-only">{t('fit.parameters')}</caption>
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th scope="col" className="pr-2 pb-1 font-normal">
                {t('fit.parameter')}
              </th>
              <th scope="col" className="pr-2 pb-1 font-normal">
                {t('fit.estimate')} ± {t('fit.se')}
              </th>
              <th scope="col" className="pb-1 text-right font-normal">
                {t('fit.ci', { level })}
              </th>
            </tr>
          </thead>
          <tbody>
            {fit.params.map((p) => (
              <ParamRow key={p.symbol} p={p} loc={loc} t={t} />
            ))}
            {g ? <ParamRow p={g} label={t('fit.derivedG')} loc={loc} t={t} /> : null}
          </tbody>
        </table>
      </div>
      {/* A centred equation shows other numbers than a₀, a₁…: say which form the table is in. */}
      {centredX !== null ? (
        <p className="-mt-2 text-xs break-words text-muted-foreground" data-testid="fit-params-form">
          {t('fit.paramsOriginalForm', { x: xName, centred: centredX })}
        </p>
      ) : null}

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">{isLog ? t('fit.r2LnY') : t('fit.r2')}</dt>
        <dd className="num font-mono" data-testid="fit-r2">
          {fit.r2 === null ? t('common.notAvailable') : formatR2(fit.r2, loc, advanced)}
        </dd>
        <dt className="text-muted-foreground">{t('fit.adjR2')}</dt>
        <dd className="num font-mono">
          {fit.adjR2 === null ? t('common.notAvailable') : formatR2(fit.adjR2, loc, advanced)}
        </dd>
        <dt className="text-muted-foreground">{t('fit.n')}</dt>
        <dd className="num font-mono" data-testid="fit-n">
          {t('fit.nOf', { n: prov.nUsed, total: prov.nTotal })}
        </dd>
        <dt className="text-muted-foreground">{t('fit.df')}</dt>
        <dd className="num font-mono">{fit.df}</dd>
        <dt className="flex items-center gap-1 text-muted-foreground">
          {t('fit.s')}
          {/* On a log model s is measured on ln y, so it has no unit and reads as a relative scatter. */}
          <InfoTip text={sTip} label={`${t('fit.s')}: ${sTip}`} />
        </dt>
        <dd className="num font-mono">
          {fit.exactFit ? t('common.notAvailable') : formatNumber(fit.s, { sig: 2, loc })}
          {!fit.exactFit && !isLog && series.yColumn.unit ? `\u00a0${series.yColumn.unit}` : null}
        </dd>
      </dl>

      <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
        <p>{t('fit.seSource')}</p>
        {fit.uComparison ? (
          <p>
            {t('fit.uCompare', {
              s: formatNumber(fit.uComparison.s, { sig: 2, loc }),
              u: formatNumber(fit.uComparison.medianU, { sig: 2, loc }),
            })}
          </p>
        ) : null}
        <p>{t('fit.unweighted')}</p>
        {isLog ? <p>{t('fit.logNote')}</p> : null}
        {excluded > 0 ? (
          <p>
            {t('stats.sampleText', {
              n: prov.nUsed,
              total: prov.nTotal,
              excluded: prov.inactive.excluded,
              filtered: prov.inactive.filtered,
              missing: prov.inactive.missing + prov.inactive.invalid,
            })}
          </p>
        ) : null}
      </div>

      <div className="rounded-md border border-border bg-info-surface px-2.5 py-2 text-xs leading-snug text-foreground">
        {t('fit.r2Caveat')}
      </div>

      {fit.residualSignRuns ? (
        <div>
          <p className="mb-1 text-xs text-muted-foreground">{t('fit.residualRuns')}</p>
          <p
            className="font-mono text-sm tracking-wider break-all"
            data-testid="fit-sign-runs"
            translate="no"
          >
            {fit.residualSignRuns}
          </p>
        </div>
      ) : null}

      <IssueList issues={fit.warnings} compact rowLabel={viewRowLabel(series.view)} />
    </div>
  )
}

function ParamRow({
  p,
  label,
  loc,
  t,
}: {
  p: FitParameter
  /** Row header text (e.g. "g = 2·a₂"); the parameter symbol when omitted. */
  label?: string
  loc: NumberFormatLocale
  t: Translator
}) {
  // The same test for the bracket and for the unit itself: an empty unit gets neither.
  const unit = p.unit ? p.unit : null
  const cells = parameterCells(p, loc, { withUnit: unit !== null })
  return (
    <tr className="border-t border-border align-top">
      {label === undefined ? (
        <th scope="row" className="py-1 pr-2 text-left font-mono font-normal" translate="no">
          {p.symbol}
        </th>
      ) : (
        <th scope="row" className="py-1 pr-2 text-left font-normal">
          {label}
        </th>
      )}
      <td className="num py-1 pr-2 font-mono whitespace-nowrap">
        {cells.value}
        {unit !== null ? <span className="text-xs text-muted-foreground">{`\u00a0${unit}`}</span> : null}
        {/* Only about an interval that is shown: an exact fit has none ("n/a"). */}
        {p.note === 'asymmetric-ci' && cells.ci !== null ? (
          <p className="font-sans text-xs whitespace-normal text-muted-foreground">{t('fit.aAsym')}</p>
        ) : null}
      </td>
      <td className="num py-1 text-right font-mono text-xs">{cells.ci ?? t('common.notAvailable')}</td>
    </tr>
  )
}
