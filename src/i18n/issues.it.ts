import type { ReasonCode } from '@/domain/model'

/** Testi italiani per ogni ReasonCode (stessi segnaposto {param} della versione inglese). */
export const issuesIt: Record<ReasonCode, { title: string; hint: string }> = {
  // Import
  E_EMPTY_INPUT: {
    title: 'Non c’è nulla da importare.',
    hint: 'Incolla una tabella copiata da un foglio di calcolo o scegli un file.',
  },
  E_NO_DATA_ROWS: {
    title: 'Nessuna riga di dati trovata.',
    hint: 'Controlla la riga di intestazione e dove iniziano i dati.',
  },
  E_FILE_TOO_LARGE: {
    title: 'File troppo grande ({size} MB, limite {limit} MB).',
    hint: 'Dividi il file o togli le colonne che non servono. Nulla è stato troncato.',
  },
  W_FILE_LARGE: {
    title: 'File grande: l’import può richiedere qualche secondo.',
    hint: 'Puoi annullare in qualsiasi momento.',
  },
  E_TOO_MANY_CELLS: {
    title: 'Troppe celle ({cells}; limite {limit}).',
    hint: 'Togli righe o colonne inutilizzate e riprova.',
  },
  E_UNSUPPORTED_FORMAT: {
    title: 'Tipo di file non supportato.',
    hint: 'Usa CSV, TSV, TXT, XLSX, XLS oppure ODS.',
  },
  E_XLS_LEGACY: {
    title: 'Impossibile leggere questa cartella .xls.',
    hint: 'Apri il file nel tuo foglio di calcolo e salvalo come .xlsx.',
  },
  E_SPREADSHEET_UNREADABLE: {
    title: 'Impossibile leggere la cartella di lavoro (danneggiata o protetta).',
    hint: 'Esporta il foglio in CSV e importa quel file.',
  },
  W_ENCODING_FALLBACK: {
    title: 'Letto come testo Windows-1252 (Europa occidentale).',
    hint: 'Se le lettere accentate sono sbagliate, scegli un’altra codifica.',
  },
  I_SEP_LINE: {
    title: 'La prima riga "sep={d}" indica il separatore.',
    hint: 'La riga resta nei dati originali.',
  },
  W_DELIMITER_AMBIGUOUS: {
    title: 'Il separatore potrebbe essere {a} o {b}; è stato usato {a}.',
    hint: 'Scegli il separatore se le colonne non sembrano giuste.',
  },
  W_SINGLE_COLUMN: {
    title: 'Nessun separatore trovato: letto come colonna unica.',
    hint: 'Se i valori usano la virgola decimale potrebbero essere due colonne. Scegli il separatore.',
  },
  W_RAGGED_ROWS: {
    title:
      '{count} {count|riga ha|righe hanno} meno campi (per esempio la riga {row}); completate con celle vuote.',
    hint: 'Le celle vuote sono trattate come mancanti, mai come zero.',
  },
  W_EXTRA_FIELDS: {
    title: '{count} {count|riga ha|righe hanno} campi in più; conservati come colonne aggiuntive.',
    hint: 'Controlla il separatore se non te lo aspettavi.',
  },
  E_QUOTES_UNCLOSED: {
    title:
      '{kind|unclosed=Virgolette non chiuse dalla riga {row}.|malformed=Nella riga {row} un campo tra virgolette continua dopo la virgoletta di chiusura.}',
    hint: 'Correggi il file oppure scegli "Ignora virgolette" per leggerle come testo.',
  },
  I_PREAMBLE_KEPT: {
    title: '{count} {count|riga|righe} prima della tabella {count|conservata|conservate} come note.',
    hint: 'Le trovi in "Note dal file".',
  },
  I_BLANK_ROWS: {
    title: '{count} {count|riga vuota saltata|righe vuote saltate}.',
    hint: 'Restano nei dati originali.',
  },
  W_HEADER_UNCERTAIN: {
    title:
      '{axis|column=Non è certo che la prima colonna contenga i nomi delle variabili.|other=Non è certo che la prima riga sia un’intestazione.}',
    hint: '{axis|column=Indica se la colonna {row} contiene i nomi delle variabili.|other=Indica se la riga {row} contiene i nomi delle colonne.}',
  },
  I_UNITS_ROW: {
    title:
      '{axis|column=La colonna {row} è stata letta come unità di misura.|other=La riga {row} è stata letta come unità di misura.}',
    hint: '{axis|column=Cambiala se quella colonna contiene dati.|other=Cambiala se quella riga contiene dati.}',
  },
  W_DECIMAL_AMBIGUOUS: {
    title:
      '“{example}” potrebbe essere {a} o {b}; {mode|mixed={count} {count|valore ambiguo non è stato letto|valori ambigui non sono stati letti}|other=letto come {chosen}}.',
    hint: 'Cambia il separatore decimale della colonna se è sbagliato.',
  },
  W_DECIMAL_MIXED: {
    title: 'Sono usati sia "." sia "," come separatore decimale ({n} e {m} valori).',
    hint: 'I valori ambigui di questa colonna non sono stati letti. Controlla la colonna.',
  },
  W_SEPARATOR_CONFLICT: {
    title: '{count} {count|cella|celle} in conflitto con il separatore decimale.',
    hint: 'Sono segnate come non valide ed elencate con le righe.',
  },
  I_UNIT_FROM_CELLS: { title: 'Unità “{unit}” ricavata dalle celle.', hint: 'Modificala se è sbagliata.' },
  W_UNEXPECTED_UNIT: {
    title: '{count} {count|cella ha|celle hanno} un’unità diversa; nulla è stato convertito.',
    hint: 'Le unità non vengono mai convertite in automatico. Controlla quelle righe.',
  },
  I_PERCENT: {
    title: 'Percentuale da foglio di calcolo: 0,12 è mostrato come 12 %.',
    hint: 'Passa a "frazione" per lavorare con 0,12.',
  },
  W_COLUMN_PARTLY_NUMERIC: {
    title: '{count} {count|valore|valori} in “{column}” non {count|è un numero|sono numeri}.',
    hint: 'Sono segnati come non validi. Tratta la colonna come testo se non è numerica.',
  },
  W_MERGED_CELLS: {
    title:
      '{header|0=Celle unite: solo la prima cella di ciascuna conserva il valore.|other=Celle unite: il testo dell’intestazione è stato ripetuto.}',
    hint: 'Le celle di dati non vengono mai riempite.',
  },
  W_FORMULA_NO_VALUE: {
    title:
      '{count} {count|formula|formule} senza risultato salvato: {count|trattata|trattate} come {count|mancante|mancanti}.',
    hint: 'Apri il file nel foglio di calcolo, ricalcola e salva.',
  },
  I_TRIMMED_EMPTY: { title: 'Righe e colonne vuote ai bordi ignorate.', hint: '' },
  E_SHEET_EMPTY: { title: 'Il foglio “{sheet}” è vuoto.', hint: 'Scegli un altro foglio.' },
  W_WORKER_FALLBACK: {
    title: 'Import sul thread principale.',
    hint: 'Con file grandi la pagina può fermarsi per qualche istante.',
  },
  E_CLIPBOARD_DENIED: {
    title: 'Accesso agli appunti negato.',
    hint: 'Fai clic nel riquadro e premi Ctrl+V (Cmd+V su Mac).',
  },
  E_CLIPBOARD_EMPTY: {
    title: 'Gli appunti non contengono una tabella.',
    hint: 'Copia prima delle celle da un foglio di calcolo.',
  },
  I_CLIPBOARD_PRECISION: {
    title: 'I valori incollati hanno la precisione mostrata nel foglio.',
    hint: 'Importa il file se ti servono tutte le cifre salvate.',
  },
  I_DUPLICATE_HEADER_RENAMED: {
    title: 'I nomi di colonna ripetuti sono stati numerati.',
    hint: 'Rinomina le colonne se vuoi.',
  },
  I_EMPTY_HEADER_NAMED: {
    title: 'Le colonne senza nome sono state chiamate "Colonna n".',
    hint: 'Rinominale con la grandezza che rappresentano.',
  },
  I_MULTIPLE_TABLES: {
    title: 'Questo foglio contiene {count} tabelle separate.',
    hint: 'Per importarne solo alcune usa “Scegli le tabelle”; oppure tieni tutto il foglio come una sola tabella.',
  },
  I_BLOCK_TRANSPOSED: {
    title:
      '{count|La tabella {range} ha|Le tabelle {range} hanno} le variabili in riga: righe e colonne sono state scambiate.',
    hint: 'Ogni record è indicato con la sua colonna del foglio (per esempio “Colonna D”).',
  },
  I_STACKED_BLOCKS: {
    title: '{count} tabelle sono state unite in un solo dataset.',
    hint: '{labels|0=Nessuna colonna di etichetta aggiunta; ogni riga conserva la sua posizione nel foglio.|other=Le colonne di etichetta indicano da quale tabella viene ogni riga.}',
  },
  // Dati mancanti
  I_MISSING_VALUES: {
    title:
      '{count} {count|valore mancante|valori mancanti} ({tokens}); non {count|convertito|convertiti} in zero.',
    hint: 'Le celle mancanti restano fuori da statistiche e fit, e sono contate.',
  },
  I_SHEET_ERRORS: {
    title:
      '{count} {count|errore|errori} del foglio (per esempio {example}) {count|trattato|trattati} come {count|mancante|mancanti}.',
    hint: 'Il testo originale resta visibile nella tabella.',
  },
  W_ALL_MISSING: {
    title: 'La colonna “{column}” non ha valori validi.',
    hint: 'Non può essere usata come asse.',
  },
  I_ROWS_INACTIVE: {
    title: 'n = {n} su {total} ({missing} mancanti, {excluded} esclusi, {filtered} filtrati).',
    hint: 'Statistiche e fit usano solo le righe attive.',
  },
  I_SAMPLE_DIFFERS: {
    title: '{column}: n = {nCol}; fit: n = {nFit} coppie.',
    hint: 'Il fit richiede x e y nella stessa riga.',
  },
  I_SPLIT_NO_VALUE: {
    title:
      '{count} {count|riga non ha|righe non hanno} un valore in {column}: {count|compare|compaiono} nel gruppo “(nessun valore)”.',
    hint: 'Queste righe restano nel grafico: non vengono mai scartate.',
  },
  // Input
  E_NOT_A_NUMBER: { title: 'Inserisci un numero (per esempio {example}).', hint: '' },
  E_RANGE_INVERTED: { title: 'Il minimo deve essere minore del massimo.', hint: '' },
  E_LOG_RANGE_NONPOSITIVE: { title: 'Un asse logaritmico richiede limiti positivi.', hint: '' },
  E_UNCERTAINTY_NEGATIVE: { title: 'Un’incertezza non può essere negativa.', hint: '' },
  W_PERCENT_OVER_100: { title: 'Incertezza oltre il 100 % del valore.', hint: 'Verifica che sia voluto.' },
  W_UNCERTAINTY_ROWS_INVALID: {
    title:
      '{count} {count|riga ha|righe hanno} un’incertezza negativa, non numerica o da un solo lato: nessuna barra.',
    hint: 'I valori non vengono mai resi positivi in automatico. Le righe sono evidenziate.',
  },
  W_UNCERTAINTY_UNIT_MISMATCH: {
    title: 'L’unità di “{u}” ({uu}) è diversa da quella di “{col}” ({cu}); nulla è stato convertito.',
    hint: 'Assicurati che le due colonne usino la stessa unità.',
  },
  E_DERIVED_UNCERTAINTY: {
    title: 'Le colonne di incertezza non sono disponibili per le colonne derivate.',
    hint: 'La propagazione delle incertezze non è implementata.',
  },
  I_UNCERTAINTY_ROWS_MISSING: {
    title: '{count} {count|riga non ha|righe non hanno} un valore di incertezza.',
    hint: 'Sono mostrate senza barra.',
  },
  I_ZERO_VALUE_PERCENT: {
    title: '{count} {count|valore è|valori sono} zero: la barra percentuale ha lunghezza nulla.',
    hint: '',
  },
  E_COLUMN_NOT_NUMERIC: {
    title: '“{column}” non è numerica.',
    hint: 'Scegli una colonna numerica o cambia come viene letta la colonna.',
  },
  E_DUPLICATE_CATEGORY: {
    title: 'Alcune categorie si ripetono.',
    hint: 'Usa "media per categoria" per riassumerle.',
  },
  I_BAR_LINEAR_ONLY: { title: 'Le barre partono da zero: la scala logaritmica non è disponibile.', hint: '' },
  E_DUPLICATE_COLUMN_NAME: { title: 'Un’altra colonna ha già questo nome. Scegline un altro.', hint: '' },
  E_EMPTY_NAME: { title: 'Il nome non può essere vuoto.', hint: '' },
  E_EXCLUSION_NOTE_REQUIRED: {
    title: 'Indica perché escludi questo candidato outlier.',
    hint: 'Un’esclusione dovrebbe avere una ragione fisica o sperimentale.',
  },
  // Errori numerici
  E_TOO_FEW_POINTS: {
    title: 'Un fit {model} richiede almeno {needed} punti; il campione attivo ne ha {n}.',
    hint: 'Aggiungi misure o ripristina le righe escluse.',
  },
  E_TOO_FEW_DISTINCT_X: {
    title: 'Il grado {k} richiede almeno {p} valori di x distinti; ce ne sono {d}.',
    hint: 'Abbassa il grado o misura in più punti di x.',
  },
  E_CONSTANT_X: {
    title: 'Tutti i valori di x sono uguali.',
    hint: 'Senza variazione di x non si può stimare una pendenza.',
  },
  E_X_EFFECTIVELY_CONSTANT: {
    title: 'I valori di x differiscono solo nelle ultime cifre.',
    hint: 'Cambia unità o sottrai un valore di riferimento a x.',
  },
  E_ILL_CONDITIONED: {
    title: 'Il fit è numericamente instabile.',
    hint: 'Abbassa il grado del polinomio o riscala x.',
  },
  W_ILL_CONDITIONED: {
    title: 'I risultati possono perdere diverse cifre significative.',
    hint: 'Valuta un grado più basso o di centrare x.',
  },
  W_FEW_DOF: {
    title: 'Solo {df} gradi di libertà (t = {t}): gli intervalli sono ampi.',
    hint: 'Più misure danno incertezze più affidabili.',
  },
  W_HIGH_LEVERAGE: {
    title: 'Il fit dipende quasi interamente dalle {axis|column=colonne|other=righe} {rows}.',
    hint: 'Controlla quei punti: un solo punto non dovrebbe decidere il modello.',
  },
  I_EQUATION_CENTRED: {
    title: 'L’equazione è mostrata in forma centrata.',
    hint: '{reason|rounding=I coefficienti arrotondati nella forma originale non riprodurrebbero la curva.|offset=I valori di x sono lontani da 0 rispetto al loro intervallo: nella forma originale i coefficienti sarebbero fortemente correlati e il termine noto sarebbe un’estrapolazione fino a x = 0.} Copia i valori a piena precisione se servono.',
  },
  I_EXACT_FIT: {
    title: 'I residui sono nulli alla precisione di macchina.',
    hint: 'Le incertezze dei parametri non si possono stimare.',
  },
  I_R2_UNDEFINED: { title: 'R² non è definito: tutti i valori di y sono uguali.', hint: '' },
  E_LOG_DOMAIN_FIT: {
    title:
      'Il modello {model} richiede valori positivi; le {axis|column=colonne|other=righe} {rows} non lo sono.',
    hint: 'Escludi quelle righe consapevolmente o scegli un altro modello. Nulla viene rimosso di nascosto.',
  },
  W_LOG_AXIS_HIDDEN: {
    title:
      '{count} {count|punto|punti} ≤ 0 non {count|è rappresentabile|sono rappresentabili} su un asse logaritmico.',
    hint: 'Cambia solo il disegno: fit e statistiche li usano ancora.',
  },
  W_LOG_AXIS_BARS_CLIPPED: {
    title:
      '{count} {count|estremo inferiore di una barra|estremi inferiori delle barre} ≤ 0 non {count|è rappresentabile|sono rappresentabili} su un asse logaritmico.',
    hint: 'Quelle barre arrivano fino al bordo dell’asse.',
  },
  I_DATE_AXIS_LINEAR: {
    title: 'L’asse {axis} mostra date e resta lineare: la scala logaritmica non è disponibile per le date.',
    hint: 'Le date non hanno uno zero naturale. Per una scala logaritmica usa una colonna numerica del tempo (per esempio i secondi trascorsi).',
  },
  E_OVERFLOW: {
    title: 'Valori troppo grandi o troppo piccoli per la doppia precisione.',
    hint: 'Cambia unità (per esempio mV invece di V).',
  },
  W_CURVE_TRUNCATED: { title: 'La curva si interrompe dove esce dall’intervallo rappresentabile.', hint: '' },
  W_SMALL_SAMPLE: {
    title: 'Campione piccolo: la SD stessa è incerta di circa ±{pct} %.',
    hint: 'Stima basata su 1/√(2(n − 1)) con ipotesi normale.',
  },
  I_ZERO_SPREAD: {
    title:
      '{scope|column=I {n} valori sono tutti identici|groups={count} {count|gruppo ha|gruppi hanno} valori identici}: la dispersione è nulla.',
    hint: 'SD, SEM e intervallo di confidenza valgono quindi 0, che non è un’incertezza reale: i valori potrebbero essere arrotondati alla risoluzione dello strumento. Registra più cifre oppure indica la risoluzione come incertezza di misura.',
  },
  I_SINGLE_OBSERVATION: { title: 'Una sola osservazione: la dispersione non si può calcolare.', hint: '' },
  I_QUARTILES_NEED_4: { title: 'I quartili richiedono almeno 4 valori.', hint: '' },
  W_GROUP_SINGLE: {
    title: '{count} {count|gruppo ha|gruppi hanno} una sola osservazione: nessuna barra.',
    hint: '',
  },
  W_GROUP_PAIR_CI: {
    title:
      '{count} {count|gruppo ha|gruppi hanno} solo 2 osservazioni: l’intervallo al {level} % usa t = {t} ed è molto ampio.',
    hint: 'Con 1 grado di libertà il fattore t è grande. Più repliche per gruppo danno un intervallo più stretto.',
  },
  W_GROUP_X_VARIES: {
    title:
      '{count} {count|gruppo mescola|gruppi mescolano} valori di x diversi: {count|la sua media è disegnata|le loro medie sono disegnate} alla x media.',
    hint: 'Raggruppa per x identica oppure per una colonna i cui gruppi hanno un solo valore di x.',
  },
  W_SPLIT_TOO_MANY_GROUPS: {
    title: '{column} ha {count} valori diversi (limite {limit}): i dati sono disegnati senza gruppi.',
    hint: 'Scegli una colonna con meno valori, oppure filtra prima i dati.',
  },
  I_SEM_COVERAGE: {
    title: '±1 SEM copre circa il {coverage} % per n = {n}.',
    hint: 'Valuta di mostrare invece l’intervallo di confidenza al 95 %.',
  },
  W_EXTRAPOLATION: {
    title:
      '{series}: la parte {pattern|dot=punteggiata|dashdot=tratto-punto|longdashdot=tratto lungo-punto|longdash=a tratto lungo|dash=tratteggiata} del fit è un’estrapolazione oltre i dati.',
    hint: 'Il modello non è stato verificato in quella zona.',
  },
  W_MANY_POINTS: {
    title: '{count} punti: l’interazione può rallentare.',
    hint: 'Tutti i punti sono disegnati; nulla viene campionato.',
  },
  E_TRANSFORM_DOMAIN: {
    title:
      '{count} {count|riga è|righe sono} fuori dal dominio di {op}: {count|segnata come non valida|segnate come non valide}.',
    hint: 'Restano fuori da statistiche e fit, e sono elencate.',
  },
  I_SELECTION_ONE_DATASET: {
    title: 'Una selezione vale per un dataset alla volta: tenuto “{name}”.',
    hint: '',
  },
  E_PLOT_RENDER: {
    title: 'Il grafico non può essere disegnato: {reason}.',
    hint: 'Prova a ricaricare quest’area.',
  },
  E_INTERNAL_GUARD: {
    title: 'Errore interno.',
    hint: 'Per favore segnalalo. I tuoi dati non sono cambiati.',
  },
  E_HISTOGRAM_NO_DATA: {
    title: 'Non ci sono valori validi da contare.',
    hint: 'Scegli una colonna numerica con dei valori.',
  },
  E_PLOT_NOT_CONFIGURED: { title: 'Scegli le colonne da rappresentare.', hint: '' },
  // Storage
  E_STORAGE_UNAVAILABLE: {
    title: 'Lo storage del browser non è disponibile (finestra privata o dati bloccati).',
    hint: 'Usa "Salva progetto" per conservare il lavoro in un file.',
  },
  E_STORAGE_QUOTA: {
    title: 'Lo storage del browser è pieno.',
    hint: 'Scarica il progetto, elimina progetti vecchi o continua senza salvataggio automatico.',
  },
  W_STORAGE_RETRY: {
    title: 'Salvataggio automatico non riuscito; nuovo tentativo alla prossima modifica.',
    hint: 'Il lavoro in questa scheda è intatto.',
  },
  I_PROJECT_READ_ONLY: {
    title: 'Il progetto è aperto in un’altra scheda: questa è in sola lettura.',
    hint: 'Aprilo come copia per modificarlo qui.',
  },
  // File di progetto
  E_PROJECT_TOO_LARGE: {
    title: 'Il file di progetto è troppo grande ({size} MB, limite {limit} MB).',
    hint: '',
  },
  E_PROJECT_NOT_JSON: {
    title: 'Il file non è un JSON valido.',
    hint: 'Scegli un file .sciplot salvato da questa app.',
  },
  E_PROJECT_NOT_SCIPLOT: {
    title: 'Il file non è un progetto .sciplot.',
    hint: 'Per importare dati usa Importa.',
  },
  E_PROJECT_NEWER_VERSION: {
    title: 'Il progetto è stato creato con una versione più recente (schema {v}).',
    hint: 'Aggiorna l’app per aprirlo.',
  },
  E_PROJECT_INVALID: {
    title: 'Il file di progetto è danneggiato: {summary}.',
    hint: 'Il lavoro corrente non è stato modificato.',
  },
  W_PROJECT_REPAIRED: {
    title:
      '{count} {count|riferimento non valido è stato riportato|riferimenti non validi sono stati riportati} ai valori predefiniti.',
    hint: 'Controlla il grafico e le impostazioni di analisi.',
  },
  I_PROJECT_MIGRATED: {
    title: 'Progetto aggiornato dallo schema {from} allo schema {to}.',
    hint: 'Dati e impostazioni di analisi sono stati mantenuti; le nuove opzioni partono dai valori predefiniti. Il file originale non è cambiato; i file salvati da ora in poi richiedono questa versione dell’app o successive.',
  },
  W_PROJECT_TOO_LARGE_TO_REOPEN: {
    title: 'Il progetto ({size} MB) supera il limite di riapertura ({limit} MB).',
    hint: '',
  },
  // Export
  E_EXPORT_FAILED: { title: 'Export non riuscito: {reason}.', hint: '' },
}
