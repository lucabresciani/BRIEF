/**
 * TEST HELPER (palette.test.ts): WCAG contrast, colour-vision-deficiency simulation and CIEDE2000 colour
 * difference.
 *
 * Simulation: Machado, Oliveira & Fernandes (2009), "A physiologically-based model for simulation of
 * color vision deficiency", the matrices for severity 1.0 (dichromacy), applied to linear sRGB and
 * clipped to the gamut. ΔE2000: Sharma, Wu & Dalal (2005), "The CIEDE2000 color-difference formula",
 * on CIELAB from sRGB with the D65 white.
 */

export type Deficiency = 'protanopia' | 'deuteranopia' | 'tritanopia'
type Matrix = readonly [readonly number[], readonly number[], readonly number[]]
export type Lab = readonly [number, number, number]

const MACHADO: Record<Deficiency, Matrix> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

/** '#rrggbb' → linear sRGB in [0, 1]. */
export function linearRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [toLinear((n >> 16) / 255), toLinear(((n >> 8) & 255) / 255), toLinear((n & 255) / 255)]
}

/** WCAG 2 contrast ratio of two '#rrggbb' colours (relative luminance from linear sRGB). */
export function contrastRatio(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = linearRgb(hex)
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Linear sRGB as a dichromat sees it (Machado 2009, severity 1), clipped to [0, 1]. */
export function simulate(rgb: readonly number[], deficiency: Deficiency): [number, number, number] {
  const m = MACHADO[deficiency]
  const row = (r: readonly number[]) =>
    Math.min(1, Math.max(0, r[0] * rgb[0] + r[1] * rgb[1] + r[2] * rgb[2]))
  return [row(m[0]), row(m[1]), row(m[2])]
}

/** Linear sRGB → CIELAB (D65). */
export function labOf(rgb: readonly number[]): Lab {
  const [r, g, b] = rgb
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116)
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]
}

/** CIELAB of '#rrggbb', seen with normal vision or with a deficiency. */
export function labSeen(hex: string, deficiency?: Deficiency): Lab {
  const rgb = linearRgb(hex)
  return labOf(deficiency ? simulate(rgb, deficiency) : rgb)
}

const DEG = Math.PI / 180

/** CIEDE2000 colour difference (kL = kC = kH = 1). */
export function deltaE2000(a: Lab, b: Lab): number {
  const [L1, a1, b1] = a
  const [L2, a2, b2] = b
  const c7 = (c: number) => Math.sqrt(c ** 7 / (c ** 7 + 25 ** 7))
  const G = 0.5 * (1 - c7((Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2))
  const a1p = (1 + G) * a1
  const a2p = (1 + G) * a2
  const C1 = Math.hypot(a1p, b1)
  const C2 = Math.hypot(a2p, b2)
  const hue = (bb: number, aa: number) => (bb === 0 && aa === 0 ? 0 : (Math.atan2(bb, aa) / DEG + 360) % 360)
  const h1 = hue(b1, a1p)
  const h2 = hue(b2, a2p)
  const chromatic = C1 * C2 !== 0
  let dh = 0
  if (chromatic) {
    dh = h2 - h1
    if (dh > 180) dh -= 360
    else if (dh < -180) dh += 360
  }
  const dL = L2 - L1
  const dC = C2 - C1
  const dH = 2 * Math.sqrt(C1 * C2) * Math.sin((dh / 2) * DEG)
  const L = (L1 + L2) / 2
  const C = (C1 + C2) / 2
  let h = h1 + h2
  if (chromatic) {
    if (Math.abs(h1 - h2) <= 180) h = (h1 + h2) / 2
    else h = h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2
  }
  const T =
    1 -
    0.17 * Math.cos((h - 30) * DEG) +
    0.24 * Math.cos(2 * h * DEG) +
    0.32 * Math.cos((3 * h + 6) * DEG) -
    0.2 * Math.cos((4 * h - 63) * DEG)
  const SL = 1 + (0.015 * (L - 50) ** 2) / Math.sqrt(20 + (L - 50) ** 2)
  const SC = 1 + 0.045 * C
  const SH = 1 + 0.015 * C * T
  const RT = -Math.sin(2 * 30 * Math.exp(-(((h - 275) / 25) ** 2)) * DEG) * 2 * c7(C)
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH))
}
