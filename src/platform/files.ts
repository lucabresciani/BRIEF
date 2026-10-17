export const DATA_FILE_ACCEPT =
  '.csv,.tsv,.txt,.dat,.xlsx,.ods,.xls,text/csv,text/tab-separated-values,text/plain'
export const PROJECT_FILE_ACCEPT = '.sciplot,application/json'

/** Opens the native file picker; resolves with the chosen file or null when cancelled. */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.style.display = 'none'
    let settled = false
    const done = (f: File | null) => {
      if (settled) return
      settled = true
      input.remove()
      resolve(f)
    }
    input.addEventListener('change', () => done(input.files?.[0] ?? null))
    input.addEventListener('cancel', () => done(null))
    document.body.appendChild(input)
    input.click()
  })
}

export function isProjectFileName(name: string): boolean {
  return /\.sciplot$/i.test(name)
}

/** Window-level drag & drop of files. Calls onDragState(true/false) for the overlay. */
export function listenForFileDrop(
  onFile: (file: File) => void,
  onDragState: (dragging: boolean) => void,
): () => void {
  let depth = 0
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
  const enter = (e: DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    depth++
    onDragState(true)
  }
  const over = (e: DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  }
  const leave = (e: DragEvent) => {
    if (!hasFiles(e)) return
    depth = Math.max(0, depth - 1)
    if (depth === 0) onDragState(false)
  }
  const drop = (e: DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    depth = 0
    onDragState(false)
    const f = e.dataTransfer?.files?.[0]
    if (f) onFile(f)
  }
  window.addEventListener('dragenter', enter)
  window.addEventListener('dragover', over)
  window.addEventListener('dragleave', leave)
  window.addEventListener('drop', drop)
  return () => {
    window.removeEventListener('dragenter', enter)
    window.removeEventListener('dragover', over)
    window.removeEventListener('dragleave', leave)
    window.removeEventListener('drop', drop)
  }
}
