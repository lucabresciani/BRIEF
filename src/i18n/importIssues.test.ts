import { describe, expect, it } from 'vitest'
import { issue } from '@/domain/model'
import { issueHint, issueTitle, makeTranslator } from './translate'

const en = makeTranslator('en')
const itT = makeTranslator('it')

describe('import messages say what was actually done', () => {
  it('the import notice counts its notes in the singular too', () => {
    expect(en('import.reviewBanner', { name: 'a', count: 1 })).toBe('Imported a: 1 note.')
    expect(en('import.reviewBanner', { name: 'a', count: 3 })).toBe('Imported a: 3 notes.')
    expect(itT('import.reviewBanner', { name: 'a', count: 1 })).toBe('Importato a: 1 nota.')
    expect(itT('import.reviewBanner', { name: 'a', count: 2 })).toBe('Importato a: 2 note.')
  })

  it('W_MERGED_CELLS claims repeated header text only when a header merge was copied', () => {
    const dataOnly = issue('W_MERGED_CELLS', { count: 7, header: 0, data: 7 })
    const header = issue('W_MERGED_CELLS', { count: 2, header: 1, data: 1 })
    expect(issueTitle(en, dataOnly)).toBe('Merged cells: only the first cell of each keeps its value.')
    expect(issueTitle(en, header)).toBe('Merged cells: the header text was repeated across them.')
    expect(issueTitle(itT, dataOnly)).toBe('Celle unite: solo la prima cella di ciascuna conserva il valore.')
    expect(issueTitle(itT, header)).toBe('Celle unite: il testo dell’intestazione è stato ripetuto.')
  })

  it('I_STACKED_BLOCKS mentions label columns only when some were added', () => {
    const none = issue('I_STACKED_BLOCKS', { count: 3, labels: 0 })
    const two = issue('I_STACKED_BLOCKS', { count: 3, labels: 2 })
    expect(issueTitle(en, two)).toBe('3 tables were stacked into one dataset.')
    expect(issueHint(en, two)).toBe('Label columns record which table each row came from.')
    expect(issueHint(en, none)).toBe('No label column was added; each row keeps its position in the sheet.')
    expect(issueHint(itT, none)).toBe(
      'Nessuna colonna di etichetta aggiunta; ogni riga conserva la sua posizione nel foglio.',
    )
  })

  it('I_BLOCK_TRANSPOSED speaks of one table, or of the stacked tables', () => {
    const one = issue('I_BLOCK_TRANSPOSED', { range: 'B3:F6', count: 1 })
    const three = issue('I_BLOCK_TRANSPOSED', { range: 'B3:F6, B9:F12, B15:F18', count: 3 })
    expect(issueTitle(en, one)).toBe(
      'The table B3:F6 has its variables in rows: rows and columns were swapped.',
    )
    expect(issueTitle(en, three)).toBe(
      'The tables B3:F6, B9:F12, B15:F18 have their variables in rows: rows and columns were swapped.',
    )
    expect(issueTitle(itT, three)).toBe(
      'Le tabelle B3:F6, B9:F12, B15:F18 hanno le variabili in riga: righe e colonne sono state scambiate.',
    )
  })

  it('positions of a transposed table are sheet columns: "Column B", never a fake row', () => {
    const units = issue('I_UNITS_ROW', { row: 'B', axis: 'column' })
    expect(issueTitle(en, units)).toBe('Column B was read as units.')
    expect(issueTitle(itT, units)).toBe('La colonna B è stata letta come unità di misura.')
    expect(issueTitle(en, issue('I_UNITS_ROW', { row: 2 }))).toBe('Row 2 was read as units.')
    const header = issue('W_HEADER_UNCERTAIN', { row: 'C', axis: 'column' })
    expect(issueHint(en, header)).toBe('Choose whether column C contains the names of the variables.')
    expect(issueHint(itT, issue('W_HEADER_UNCERTAIN', { row: 4 }))).toBe(
      'Indica se la riga 4 contiene i nomi delle colonne.',
    )
  })

  it('{rows} listed by a row labeler follow its axis (fit warnings on a transposed table)', () => {
    const lev = { ...issue('W_HIGH_LEVERAGE', { count: 2 }), rows: [3, 5] as never }
    const letters = Object.assign((r: number) => ['A', 'B', 'C', 'D', 'E', 'F'][r]!, {
      axis: 'column' as const,
    })
    expect(issueTitle(en, lev, letters)).toBe('The fit depends almost entirely on columns D, F.')
    expect(issueTitle(itT, lev, letters)).toBe('Il fit dipende quasi interamente dalle colonne D, F.')
    // Without a labeler (or a row labeler): rows, as before.
    expect(issueTitle(en, lev)).toBe('The fit depends almost entirely on rows 4, 6.')
    const domain = { ...issue('E_LOG_DOMAIN_FIT', { model: 'exponential', count: 1 }), rows: [0] as never }
    expect(issueTitle(en, domain, letters)).toBe(
      'The exponential model needs positive values; columns A are not.',
    )
  })

  it('E_UNSUPPORTED_FORMAT lists .xls among the readable formats', () => {
    expect(issueHint(en, issue('E_UNSUPPORTED_FORMAT'))).toContain(', XLS ')
    expect(issueHint(itT, issue('E_UNSUPPORTED_FORMAT'))).toContain(', XLS ')
  })
})
