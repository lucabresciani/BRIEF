import type { Config, Data, Layout } from 'plotly.js'
import { dataUrlToBlob } from '@/platform/download'

/** PNG/SVG of the EXPORT figure (built with mode 'export'), never a screenshot of the screen state. */
export async function exportFigure(
  figure: { data: Data[]; layout: Partial<Layout>; config: Partial<Config> },
  opts: { format: 'png' | 'svg'; width: number; height: number; scale: number },
): Promise<Blob> {
  const { figureToImage } = await import('./renderImage')
  const url = await figureToImage(figure, { ...opts, scale: opts.format === 'svg' ? 1 : opts.scale })
  return dataUrlToBlob(url)
}
