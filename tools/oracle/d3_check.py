"""Phase D3 checks of the oracle: sensitivity, yield, corners, Wilson interval and correlated draws.

Imported by check.py, which supplies the scikit-rf evaluation of a ladder for the derivative
check; everything else here needs numpy only.

1. Derivatives: the app's analytic dGamma/dp of the input reflection coefficient (through its
   ABCD cascade) against central differences of the input reflection coefficient that
   scikit-rf computes for the ladder with the parameter moved by +/- 1e-5 of its value. The
   difference code is independent of the app's derivative code; the element formulas are
   check.py's (see its docstring). A relative error above 1e-6 fails.
2. Yield: the app's Monte Carlo pass count of an L match with 5 % uniform parts against the
   exact yield by brute-force integration over the tolerance box (a 801 x 801 midpoint grid,
   the VSWR from numpy's own ABCD cascade of the ideal parts); the app's estimate must lie
   within 4 standard errors (plus the grid's resolution) of it.
3. Worst corner: the app's worst corner against numpy evaluating all four corners (1e-9) and
   against the largest VSWR anywhere on the grid (the corner must not be beaten).
4. Wilson interval: the app's interval against the closed form (1e-12).
5. Correlated draws: the sample correlation of the app's draws against the coefficient asked
   for, within 4 standard errors (1 - rho^2) / sqrt(n) plus 1e-3, independent kinds near 0,
   and the marginal variance (1/3 uniform, 1/9 normal) within 0.01.
"""

import math

import numpy as np

SENSITIVITY_TOLERANCE = 1e-6
STEP = 1e-5
Z95 = 1.959963984540054
GRID = 801


def as_complex(pair):
    return complex(pair[0], pair[1])


# ------------------------------------------------------------- derivatives


def check_sensitivity(case, gamma_in):
    """Every parameter of one case: (label, ok, detail). `gamma_in(case, elements, freqs)`
    returns the input reflection coefficient of the ladder `elements` with the case's load and
    Z0 at the frequencies."""
    out = []
    freqs = np.asarray(case["frequencies"], dtype=float)
    worst = 0.0
    for k, ref in enumerate(case["parameters"]):
        value = ref["value"]
        h = abs(value) * STEP
        up = [dict(el) for el in case["elements"]]
        down = [dict(el) for el in case["elements"]]
        up[ref["index"]][ref["parameter"]] = value + h
        down[ref["index"]][ref["parameter"]] = value - h
        fd = (gamma_in(case, up, freqs) - gamma_in(case, down, freqs)) / (2.0 * h)
        app = np.array([as_complex(case["dGamma"][i][k]) for i in range(len(freqs))])
        scale = np.maximum(np.abs(app), np.abs(fd))
        rel = float(np.max(np.abs(app - fd) / np.where(scale > 0, scale, 1.0)))
        worst = max(worst, rel)
        out.append(
            (
                "d/d %s[%d]" % (ref["parameter"], ref["index"]),
                rel <= SENSITIVITY_TOLERANCE,
                "relative error %.2e" % rel,
            )
        )
    return out


# ------------------------------------------------------------------- yield


def lumped_abcd(el, w, value):
    """ABCD entries (a, b, c, d) of an ideal R, L or C with `value` (an array) at w."""
    kind = el["kind"]
    if kind == "R":
        z = value + 0j
    elif kind == "L":
        z = 1j * w * value
    elif kind == "C":
        z = 1.0 / (1j * w * value)
    else:
        raise ValueError("the yield check takes ideal R, L and C only: " + kind)
    one = np.ones_like(z)
    zero = np.zeros_like(z)
    if el["orientation"] == "series":
        return one, z, zero, one
    return one, zero, 1.0 / z, one


def vswr_grid(case, values, f):
    """VSWR at frequency f for arrays of part values (one array per element), numpy only."""
    w = 2.0 * math.pi * f
    a = b = c = d = None
    for el, v in zip(case["elements"], values):
        ea, eb, ec, ed = lumped_abcd(el, w, v)
        if a is None:
            a, b, c, d = ea, eb, ec, ed
        else:
            # The new element is on the source side: M = E * M.
            a, b, c, d = ea * a + eb * c, ea * b + eb * d, ec * a + ed * c, ec * b + ed * d
    zl = as_complex(case["load"])
    zin = (a * zl + b) / (c * zl + d)
    z0 = case["z0"]
    g = np.abs((zin - z0) / (zin + z0))
    return np.where(g < 1.0, (1.0 + g) / (1.0 - g), np.inf)


def judged(case, values):
    """The VSWR a run is judged by: at f0, and the worst over the band when there is one."""
    v = vswr_grid(case, values, case["frequency"])
    for f in case["band"]:
        v = np.maximum(v, vswr_grid(case, values, f))
    return v


def check_yield(case):
    out = []
    tol = case["tolerance"]
    nominal = [el["value"] for el in case["elements"]]
    if len(nominal) != 2:
        raise ValueError("the brute-force yield integrates two parts")
    d = (2.0 * np.arange(GRID) + 1.0) / GRID - 1.0
    d1, d2 = np.meshgrid(d, d, indexing="ij")
    values = [nominal[0] * (1.0 + tol * d1), nominal[1] * (1.0 + tol * d2)]
    v = judged(case, values)
    truth = float(np.mean(v <= case["vswrLimit"]))
    p = case["passed"] / case["runs"]
    sigma = math.sqrt(max(p * (1.0 - p), 1e-12) / case["runs"])
    err = abs(p - truth)
    bound = 4.0 * sigma + 2.0 / GRID
    out.append(
        (
            "yield",
            err <= bound,
            "app %.4f, brute force %.4f, difference %.4f (bound %.4f)" % (p, truth, err, bound),
        )
    )
    corners = []
    for s1 in (-1.0, 1.0):
        for s2 in (-1.0, 1.0):
            vals = [np.array([nominal[0] * (1.0 + tol * s1)]), np.array([nominal[1] * (1.0 + tol * s2)])]
            corners.append(float(judged(case, vals)[0]))
    worst_corner = max(corners)
    app_corner = case["corner"]["vswr"]
    rel = abs(app_corner / worst_corner - 1.0)
    out.append(
        ("worst corner", rel <= 1e-9, "app %.9f, numpy %.9f, rel %.2e" % (app_corner, worst_corner, rel))
    )
    grid_max = float(np.max(v))
    out.append(
        (
            "corner vs grid",
            grid_max <= app_corner * (1.0 + 1e-9),
            "largest VSWR on the grid %.9f, corner %.9f" % (grid_max, app_corner),
        )
    )
    return out


# ------------------------------------------------------------------ Wilson


def wilson(passed, n, z=Z95):
    p = passed / n
    z2 = z * z
    denom = 1.0 + z2 / n
    centre = (p + z2 / (2.0 * n)) / denom
    half = z * math.sqrt(p * (1.0 - p) / n + z2 / (4.0 * n * n)) / denom
    return max(0.0, centre - half), min(1.0, centre + half)


def check_wilson(case):
    lo, hi = wilson(case["passed"], case["runs"])
    err = max(abs(lo - case["interval"][0]), abs(hi - case["interval"][1]))
    return [
        (
            "Wilson %d/%d" % (case["passed"], case["runs"]),
            err <= 1e-12,
            "[%.6f, %.6f], error %.2e" % (lo, hi, err),
        )
    ]


# ------------------------------------------------------------------- draws


def check_draws(case):
    out = []
    rows = np.asarray(case["rows"], dtype=float)
    n = rows.shape[0]
    kinds = case["kinds"]
    corr = np.corrcoef(rows, rowvar=False)
    for i in range(len(kinds)):
        for j in range(i + 1, len(kinds)):
            rho = case["correlation"].get(kinds[i], 0.0) if kinds[i] == kinds[j] else 0.0
            bound = 4.0 * (1.0 - rho * rho) / math.sqrt(n) + 1e-3
            err = abs(corr[i, j] - rho)
            out.append(
                (
                    "corr %s%d-%s%d" % (kinds[i], i, kinds[j], j),
                    err <= bound,
                    "%.4f, asked %.2f (bound %.4f)" % (corr[i, j], rho, bound),
                )
            )
    want = 1.0 / 3.0 if case["distribution"] == "uniform" else 1.0 / 9.0
    var = np.var(rows, axis=0)
    err = float(np.max(np.abs(var - want)))
    out.append(("variance", err <= 0.01, "largest error %.4f against %.4f" % (err, want)))
    if case["distribution"] == "uniform":
        inside = bool(np.all(np.abs(rows) <= 1.0))
        out.append(("in [-1, 1]", inside, "min %.4f, max %.4f" % (rows.min(), rows.max())))
    return out


def check_d3(d3, gamma_in):
    """Every D3 check: a list of (group, name, label, ok, detail)."""
    out = []
    for case in d3.get("sensitivities", []):
        for label, ok, detail in check_sensitivity(case, gamma_in):
            out.append(("sensitivity", case["name"], label, ok, detail))
    for case in d3.get("yields", []):
        for label, ok, detail in check_yield(case):
            out.append(("yield", case["name"], label, ok, detail))
    for case in d3.get("wilson", []):
        for label, ok, detail in check_wilson(case):
            out.append(("wilson", "interval", label, ok, detail))
    for case in d3.get("draws", []):
        for label, ok, detail in check_draws(case):
            out.append(("draws", case["distribution"], label, ok, detail))
    return out
