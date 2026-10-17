"""
Independent oracle for the test reference values (Python standard library only).

Run from the repository root (isolated mode, no site packages):

    python -I scripts/oracle/reference_values.py

It reads the bundled example datasets (src/examples/*.csv) and writes
tests/fixtures/reference/*.json. Nothing here shares code or numerical method with the
TypeScript implementation:

* least squares use exact rational arithmetic (fractions.Fraction) on the decimal data,
  so there is no rounding at all until the final square roots;
* square roots, logarithms and the Student-t distribution use 60-digit decimal.Decimal;
* the t quantile inverts the regularised incomplete beta function (continued fraction),
  whereas the app uses the trigonometric finite series of Abramowitz & Stegun 26.7.3/4.

Values are written as strings with 20 significant digits.
"""
from __future__ import annotations

import csv
import json
import os
from decimal import Decimal, getcontext
from fractions import Fraction

getcontext().prec = 60
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
EXAMPLES = os.path.join(ROOT, 'src', 'examples')
OUT = os.path.join(ROOT, 'tests', 'fixtures', 'reference')
PI = Decimal('3.14159265358979323846264338327950288419716939937510582097494459')


def dec(x) -> Decimal:
    if isinstance(x, Fraction):
        return Decimal(x.numerator) / Decimal(x.denominator)
    return Decimal(x)


def s(x) -> str:
    """20 significant digits, plain or scientific notation as Python chooses."""
    d = dec(x)
    if d == 0:
        return '0'
    return format(d, '.20g') if abs(d) >= Decimal('1e-6') else format(d, '.19e')


def sqrt(x) -> Decimal:
    return dec(x).sqrt()


# --------------------------------------------------------------------------------------------
# Student t via the regularised incomplete beta function
# --------------------------------------------------------------------------------------------
def gamma_half_int(twice: int) -> Decimal:
    """Gamma(twice/2) for positive integers twice (exact up to sqrt(pi))."""
    if twice % 2 == 0:
        n = twice // 2
        r = Decimal(1)
        for k in range(2, n):
            r *= k
        return r
    n = (twice - 1) // 2  # Gamma(n + 1/2) = (2n)! / (4^n n!) sqrt(pi)
    num = Decimal(1)
    for k in range(1, 2 * n + 1):
        num *= k
    den = Decimal(4) ** n
    for k in range(1, n + 1):
        den *= k
    return num / den * PI.sqrt()


def betacf(a: Decimal, b: Decimal, x: Decimal) -> Decimal:
    tiny = Decimal('1e-300')
    eps = Decimal('1e-55')
    qab, qap, qam = a + b, a + 1, a - 1
    c, d = Decimal(1), 1 - qab * x / qap
    if abs(d) < tiny:
        d = tiny
    d = 1 / d
    h = d
    for m in range(1, 200000):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1 + aa * d
        if abs(d) < tiny:
            d = tiny
        c = 1 + aa / c
        if abs(c) < tiny:
            c = tiny
        d = 1 / d
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1 + aa * d
        if abs(d) < tiny:
            d = tiny
        c = 1 + aa / c
        if abs(c) < tiny:
            c = tiny
        d = 1 / d
        de = d * c
        h *= de
        if abs(de - 1) < eps:
            return h
    raise RuntimeError('betacf did not converge')


def reg_inc_beta(twice_a: int, twice_b: int, x: Decimal) -> Decimal:
    a, b = Decimal(twice_a) / 2, Decimal(twice_b) / 2
    if x <= 0:
        return Decimal(0)
    if x >= 1:
        return Decimal(1)
    lbeta = gamma_half_int(twice_a) * gamma_half_int(twice_b) / gamma_half_int(twice_a + twice_b)
    front = (x ** a) * ((1 - x) ** b) / lbeta
    if x < (a + 1) / (a + b + 2):
        return front * betacf(a, b, x) / a
    return 1 - front * betacf(b, a, 1 - x) / b


def t_two_sided(t: Decimal, df: int) -> Decimal:
    """P(|T| < t) = 1 - I_{df/(df+t^2)}(df/2, 1/2)."""
    x = Decimal(df) / (Decimal(df) + t * t)
    return 1 - reg_inc_beta(df, 1, x)


def t_critical(confidence: Decimal, df: int) -> Decimal:
    lo, hi = Decimal(0), Decimal(1)
    while t_two_sided(hi, df) < confidence:
        hi *= 2
    for _ in range(190):
        mid = (lo + hi) / 2
        if t_two_sided(mid, df) < confidence:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


# --------------------------------------------------------------------------------------------
# Exact least squares
# --------------------------------------------------------------------------------------------
def solve(M: list[list[Fraction]], v: list[Fraction]) -> list[Fraction]:
    n = len(v)
    A = [row[:] + [v[i]] for i, row in enumerate(M)]
    for c in range(n):
        p = next(r for r in range(c, n) if A[r][c] != 0)
        A[c], A[p] = A[p], A[c]
        for r in range(n):
            if r != c and A[r][c] != 0:
                f = A[r][c] / A[c][c]
                A[r] = [a - f * b for a, b in zip(A[r], A[c])]
    return [A[i][n] / A[i][i] for i in range(n)]


def invert(M: list[list[Fraction]]) -> list[list[Fraction]]:
    n = len(M)
    cols = [solve(M, [Fraction(int(i == j)) for i in range(n)]) for j in range(n)]
    return [[cols[j][i] for j in range(n)] for i in range(n)]


def poly_fit(x: list[Fraction], y: list[Fraction], degree: int, confidence=Decimal('0.95'), band_at=()):
    n, p = len(x), degree + 1
    X = [[xi ** j for j in range(p)] for xi in x]
    XtX = [[sum(r[i] * r[j] for r in X) for j in range(p)] for i in range(p)]
    Xty = [sum(r[i] * yi for r, yi in zip(X, y)) for i in range(p)]
    b = solve(XtX, Xty)
    fitted = [sum(bj * xj for bj, xj in zip(b, r)) for r in X]
    resid = [yi - fi for yi, fi in zip(y, fitted)]
    rss = sum(r * r for r in resid)
    df = n - p
    s2 = rss / df
    ybar = sum(y) / n
    tss = sum((yi - ybar) ** 2 for yi in y)
    inv = invert(XtX)
    se = [sqrt(s2 * inv[k][k]) for k in range(p)]
    t = t_critical(confidence, df)
    out = {
        'n': n, 'df': df, 'degree': degree,
        'coefficients': [s(v) for v in b],
        'se': [s(v) for v in se],
        'ci95': [[s(dec(bk) - t * sk), s(dec(bk) + t * sk)] for bk, sk in zip(b, se)],
        's': s(sqrt(s2)), 'rss': s(rss),
        'r2': s(1 - rss / tss) if tss != 0 else None,
        'adjR2': s(1 - (rss / df) / (tss / (n - 1))) if tss != 0 else None,
        'tCritical': s(t),
        'residuals': [s(r) for r in resid],
        'residualSigns': ''.join('+' if r > 0 else ('-' if r < 0 else '0') for r in resid),
    }
    bands = []
    for x0 in band_at:
        x0 = Fraction(x0)
        v0 = [x0 ** j for j in range(p)]
        q = sum(v0[i] * inv[i][j] * v0[j] for i in range(p) for j in range(p))
        bands.append({
            'x': s(x0),
            'yhat': s(sum(bj * vj for bj, vj in zip(b, v0))),
            'confidenceHalfWidth': s(t * sqrt(s2 * q)),
            'predictionHalfWidth': s(t * sqrt(s2 * (1 + q))),
        })
    if bands:
        out['bands'] = bands
    return out


def loglinear_fit(x: list[Fraction], y: list[Fraction], power: bool):
    """OLS of ln y on x (exponential) or on ln x (power), in 60-digit decimal."""
    ly = [dec(v).ln() for v in y]
    lx = [dec(v).ln() for v in x] if power else [dec(v) for v in x]
    n = len(lx)
    mx, my = sum(lx) / n, sum(ly) / n
    sxx = sum((a - mx) ** 2 for a in lx)
    sxy = sum((a - mx) * (b - my) for a, b in zip(lx, ly))
    b = sxy / sxx
    lna = my - b * mx
    resid = [b_ - (lna + b * a) for a, b_ in zip(lx, ly)]
    rss = sum(r * r for r in resid)
    df = n - 2
    s2 = rss / df
    tss = sum((v - my) ** 2 for v in ly)
    se_b = (s2 / sxx).sqrt()
    se_lna = (s2 * (Decimal(1) / n + mx * mx / sxx)).sqrt()
    t = t_critical(Decimal('0.95'), df)
    return {
        'n': n, 'df': df,
        'lnA': s(lna), 'seLnA': s(se_lna), 'a': s(lna.exp()),
        'aCI95': [s((lna - t * se_lna).exp()), s((lna + t * se_lna).exp())],
        'b': s(b), 'seB': s(se_b), 'bCI95': [s(b - t * se_b), s(b + t * se_b)],
        's': s(s2.sqrt()), 'r2LnY': s(1 - rss / tss), 'tCritical': s(t),
    }


# --------------------------------------------------------------------------------------------
# Descriptive statistics (exact)
# --------------------------------------------------------------------------------------------
def quantile7(sorted_vals: list[Fraction], p: Fraction) -> Fraction:
    n = len(sorted_vals)
    h = (n - 1) * p
    lo = int(h)  # floor for non-negative h
    frac = h - lo
    if lo + 1 >= n:
        return sorted_vals[lo]
    return sorted_vals[lo] + frac * (sorted_vals[lo + 1] - sorted_vals[lo])


def describe(vals: list[Fraction]):
    n = len(vals)
    srt = sorted(vals)
    mean = sum(vals) / n
    var = sum((v - mean) ** 2 for v in vals) / (n - 1)
    sd = sqrt(var)
    sem = sd / dec(n).sqrt()
    t = t_critical(Decimal('0.95'), n - 1)
    q1, med, q3 = (quantile7(srt, Fraction(k, 4)) for k in (1, 2, 3))
    iqr = q3 - q1
    lo_f, hi_f = q1 - Fraction(3, 2) * iqr, q3 + Fraction(3, 2) * iqr
    inside = [v for v in srt if lo_f <= v <= hi_f]
    return {
        'n': n, 'mean': s(mean), 'sd': s(sd), 'sem': s(sem), 'tCritical': s(t),
        'ci95': [s(dec(mean) - t * sem), s(dec(mean) + t * sem)],
        'median': s(med), 'q1': s(q1), 'q3': s(q3), 'iqr': s(iqr),
        'min': s(srt[0]), 'max': s(srt[-1]), 'range': s(srt[-1] - srt[0]),
        'fences': [s(lo_f), s(hi_f)], 'whiskers': [s(inside[0]), s(inside[-1])],
        'outliers': [s(v) for v in srt if v < lo_f or v > hi_f],
    }


def read_csv(name: str):
    with open(os.path.join(EXAMPLES, name), encoding='utf-8', newline='') as f:
        rows = list(csv.reader(f))
    return rows[0], rows[1:]


def col(rows, i):
    return [Fraction(r[i]) for r in rows]


def write(name: str, obj) -> None:
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, name), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(obj, f, indent=1, ensure_ascii=False)
        f.write('\n')
    print('wrote', name)


def main() -> None:
    method = 'scripts/oracle/reference_values.py (exact rationals + 60-digit Decimal)'

    _, rows = read_csv('ohm.csv')
    I, V = col(rows, 0), col(rows, 1)
    write('ohm.json', {'source': 'src/examples/ohm.csv', 'method': method,
                       'linear': poly_fit(I, V, 1, band_at=['0', '0.055', '0.1', '0.15'])})

    _, rows = read_csv('freeFall.csv')
    t, y = col(rows, 0), col(rows, 1)
    write('freeFall.json', {'source': 'src/examples/freeFall.csv', 'method': method,
                            'linear': poly_fit(t, y, 1), 'quadratic': poly_fit(t, y, 2)})

    _, rows = read_csv('cooling.csv')
    tt, T, dT = col(rows, 0), col(rows, 1), col(rows, 2)
    write('cooling.json', {'source': 'src/examples/cooling.csv', 'method': method,
                           'linearTvsT': poly_fit(tt, T, 1),
                           'exponentialDeltaT': loglinear_fit(tt, dT, power=False)})

    _, rows = read_csv('beerLambert.csv')
    c, A = col(rows, 0), col(rows, 1)
    groups = []
    for cv in sorted(set(c)):
        vals = [a for ci, a in zip(c, A) if ci == cv]
        d = describe(vals)
        groups.append({'c': s(cv), 'n': d['n'], 'mean': d['mean'], 'sd': d['sd'], 'sem': d['sem'],
                       'ci95HalfWidth': s(Decimal(d['sem']) * Decimal(d['tCritical'])), 'tCritical': d['tCritical']})
    write('beerLambert.json', {'source': 'src/examples/beerLambert.csv', 'method': method,
                               'linear': poly_fit(c, A, 1), 'groups': groups})

    _, rows = read_csv('pendulum.csv')
    allT = [Fraction(r[2]) for r in rows]
    a = [Fraction(r[2]) for r in rows if r[1] == 'A']
    b = [Fraction(r[2]) for r in rows if r[1] == 'B']
    write('pendulum.json', {'source': 'src/examples/pendulum.csv', 'method': method,
                            'observerA': describe(a), 'observerB': describe(b), 'all': describe(allT)})

    x123 = [Fraction(v) for v in [10, 8, 13, 9, 11, 14, 6, 4, 12, 7, 5]]
    ys = {
        'I': '8.04 6.95 7.58 8.81 8.33 9.96 7.24 4.26 10.84 4.82 5.68',
        'II': '9.14 8.14 8.74 8.77 9.26 8.10 6.13 3.10 9.13 7.26 4.74',
        'III': '7.46 6.77 12.74 7.11 7.81 8.84 6.08 5.39 8.15 6.42 5.73',
        'IV': '6.58 5.76 7.71 8.84 8.47 7.04 5.25 12.50 5.56 7.91 6.89',
    }
    x4 = [Fraction(v) for v in [8, 8, 8, 8, 8, 8, 8, 19, 8, 8, 8]]
    ans = {}
    for k, ystr in ys.items():
        yv = [Fraction(v) for v in ystr.split()]
        xv = x4 if k == 'IV' else x123
        ans[k] = {'x': [s(v) for v in xv], 'y': [s(v) for v in yv], 'linear': poly_fit(xv, yv, 1)}
    write('anscombe.json', {'source': 'Anscombe (1973), The American Statistician 27(1)', 'method': method,
                            'sets': ans})

    dfs = list(range(1, 61)) + [70, 80, 90, 100, 120, 150, 200, 250, 300, 400, 500, 750, 1000]
    entries = []
    for conf in ('0.90', '0.95', '0.99'):
        for df in dfs:
            entries.append({'confidence': float(conf), 'df': df, 't': s(t_critical(Decimal(conf), df))})
    write('t-table.json', {'method': 'regularised incomplete beta (continued fraction), 60-digit Decimal, bisection',
                           'note': 'two-sided: P(|T| < t) = confidence', 'entries': entries})


if __name__ == '__main__':
    main()
