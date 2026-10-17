import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ColumnId, ColumnMeta } from '@/domain/model'
import { I18nProvider } from '@/i18n/I18nProvider'
import { makeTranslator } from '@/i18n/translate'
import { useUiStore } from '@/state/uiStore'
import { column, notebook } from '@/features/inspector/testFixtures'
import { ColumnEditor } from './ColumnEditor'

const t = makeTranslator('en')

const V: ColumnMeta = { ...column('V', { unit: 'V' }), source: { type: 'raw', index: 1 } }
const uV = column('uV', { role: 'uncertainty' })
const lnV = column('lnV', { derived: { op: 'ln', input: 'V' as ColumnId } })
const dataset = notebook({ V: ['1', '2'], uV: ['0.1', '0.1'] }, [V, uV], [lnV])

function renderEditor(target: ColumnMeta) {
  useUiStore.setState({ hints: true })
  return render(
    <I18nProvider lang="en">
      <ColumnEditor dataset={dataset} column={target} />
    </I18nProvider>,
  )
}

describe('ColumnEditor', () => {
  it('says that editing the unit of an imported column neither converts nor re-checks the cells', () => {
    renderEditor(V)
    expect(screen.getByText(t('data.unitLabelOnly'))).toBeInTheDocument()
  })

  it('makes no such claim for a typed (notebook) column, whose cells are checked against its unit', () => {
    renderEditor(uV)
    expect(screen.queryByText(t('data.unitLabelOnly'))).not.toBeInTheDocument()
  })

  it('does not offer a derived column as the quantity an uncertainty column belongs to', async () => {
    renderEditor(uV)
    await userEvent.click(screen.getByRole('combobox', { name: t('data.uncertaintyOf') }))
    const derived = await screen.findByRole('option', { name: /^lnV/ })
    expect(derived).toHaveAttribute('aria-disabled', 'true')
    expect(derived).toHaveTextContent(t('derived.noUncertainty'))
    expect(await screen.findByRole('option', { name: /^V/ })).not.toHaveAttribute('aria-disabled', 'true')
  })
})
