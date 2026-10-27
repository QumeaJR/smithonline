"""Phase D6 checks of the oracle: measure, compare, retune.

The app compares the measured S11 of a built board with the network as built,
fits the drifts of part values and board parameters by least squares, and
suggests a retune snapped to a value series. Here, on the synthetic
measurement of scripts/synth-board.mjs (the buildable board with +8 % on the
shunt L and +0.3 pF on the pads of the series C, noise 0.001 in Gamma):

- the measured file is read with scikit-rf's own Touchstone reader;
- the network as built with no drift, with the fitted drifts and with the
  retune (under the fitted and under the true drifts) is rebuilt from the
  exported elements by check.py's ladder builder in scikit-rf and compared
  with the app's reflection coefficients (1e-9);
- the fit residual is recomputed from the scikit-rf model and the file
  (relative 1e-6 against the app's) and must lie at the noise floor;
- which of the parameters the app was asked to fit this data resolves is
  decided here: the scaled Jacobian at no drift by central differences on the
  scikit-rf model, scipy's QR with column pivoting, a column within 5 % of the
  span of those picked before it not resolved; the app's split must match;
- the resolved drifts are refitted with scipy.optimize.least_squares on the
  scikit-rf model, starting from no drift, and must agree with the app's
  within a thousandth of each parameter's prior width; the fitted drifts must
  lie within three of their stated standard uncertainties of the truth;
- the standard uncertainties are worked out here from the Jacobian at the
  scipy solution (s^2 (J^T J)^-1, s^2 the residual sum of squares over
  2N - P) and the app's must agree within 1 % (a sigma off by 1000 fails);
- the retune's worst VSWR over the band is recomputed and must equal the
  app's prediction (1e-9) and lie inside the limit, under the fitted drifts and
  under the true ones.

Independent: the Touchstone reading, the cascade and its reflection
coefficient, the Jacobian, the identifiability decision, the least squares
solver and the covariance. Shared with the app: the element
models (check.py's port of them), the parameterization of a drift (a value
scaled by 1 + x, a pad capacitance added, a via scaled), and the snapped
candidate values (E24 from the app).
"""

import copy
import os

import numpy as np
import skrf as rf

D6_TOLERANCE = 1e-9
ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))


def _as_complex(pairs):
    return np.array([complex(a, b) for a, b in pairs])


def _drifted(elements, free, x):
    """The as-built elements with the drifts x applied, as the app applies them."""
    out = copy.deepcopy(elements)
    for p, v in zip(free, x):
        if p["kind"] == "value":
            el = out[p["index"]]
            el["value"] = el["value"] * max(0.05, 1.0 + v)
        elif p["kind"] == "pad":
            el = out[p["index"]]
            par = dict(el.get("parasitics", {}))
            par["pad"] = max(0.0, par.get("pad", 0.0) + v)
            el["parasitics"] = par
        elif p["kind"] == "via":
            for el in out:
                b = el.get("board")
                if b and "via" in b:
                    b["via"] = b["via"] * max(0.05, 1.0 + v)
        else:
            raise ValueError("d6_check refits value, pad and via drifts only, not %s" % p["kind"])
    return out


def _worst_vswr(g):
    m = np.abs(g)
    return float(np.max((1 + m) / (1 - m)))


def check_d6(d6, gamma_in):
    """Yields (group, name, label, ok, detail) for every D6 comparison."""
    if not d6:
        return
    case = {"z0": d6["z0"], "load": d6["load"]}
    fs = np.asarray(d6["frequencies"], dtype=float)
    meas = rf.Network(os.path.join(ROOT, d6["measuredFile"]))
    yield (
        "measure",
        "board-1g-synthetic.s1p",
        "frequencies",
        len(meas.f) == len(fs) and float(np.max(np.abs(meas.f - fs) / fs)) < 1e-12,
        "%d points" % len(meas.f),
    )
    g_meas = meas.s[:, 0, 0]

    for key in ("designed", "fitted"):
        g = gamma_in(case, d6[key]["elements"], fs)
        err = float(np.max(np.abs(g - _as_complex(d6[key]["gamma"]))))
        yield ("measure", key + " network as built", "Gamma_in", err <= D6_TOLERANCE, "%.2e" % err)

    g_fit = gamma_in(case, d6["fitted"]["elements"], fs)
    g_des = gamma_in(case, d6["designed"]["elements"], fs)
    rms_after = float(np.sqrt(np.mean(np.abs(g_fit - g_meas) ** 2)))
    rms_before = float(np.sqrt(np.mean(np.abs(g_des - g_meas) ** 2)))
    err = abs(rms_after - d6["fitted"]["rmsAfter"]) / rms_after
    yield ("fit", "residual after the fit", "app vs skrf", err <= 1e-6, "%.6g, rel %.2e" % (rms_after, err))
    floor = d6["noise"] * np.sqrt(2.0)
    yield (
        "fit",
        "residual at the noise floor",
        "RMS / floor",
        0.7 * floor <= rms_after <= 1.3 * floor,
        "%.4g / %.4g (before the fit %.4g)" % (rms_after, floor, rms_before),
    )

    params = {p["id"]: p for p in d6["fitted"]["parameters"]}
    for pid, truth in d6["truth"].items():
        p = params[pid]
        ok = p["status"] == "fitted" and abs(p["drift"] - truth) <= 3 * p["sigma"]
        yield (
            "fit",
            "drift " + pid,
            "truth in 3 sigma",
            ok,
            "%.6g +- %.2g (truth %.6g)" % (p["drift"], p["sigma"], truth),
        )
    yield ("fit", "via", "not resolved", params["via"]["status"] == "unresolved", params["via"]["status"])

    # Identifiability, decided here: the scaled Jacobian at no drift by central differences on
    # the scikit-rf model, QR with column pivoting (scipy), a column within 5 % of the span of
    # the ones picked before it not resolved. The app's split must be the same.
    from scipy.linalg import qr
    from scipy.optimize import least_squares

    cands = d6["fitted"]["candidates"]
    base = d6["designed"]["elements"]

    def residuals_of(sel):
        def residuals(u):
            x = [ui * p["prior"] for ui, p in zip(u, sel)]
            g = gamma_in(case, _drifted(base, sel, x), fs)
            d = g - g_meas
            return np.concatenate([d.real, d.imag])

        return residuals

    def jacobian(fun, u, h=1e-6):
        cols = []
        for j in range(len(u)):
            up = np.array(u, dtype=float)
            dn = np.array(u, dtype=float)
            up[j] += h
            dn[j] -= h
            cols.append((fun(up) - fun(dn)) / (2 * h))
        return np.column_stack(cols)

    j0 = jacobian(residuals_of(cands), np.zeros(len(cands)))
    norms = np.linalg.norm(j0, axis=0)
    _, r_mat, piv = qr(j0, mode="economic", pivoting=True)
    resolved = []
    for k, j in enumerate(piv):
        if norms[j] <= 1e-9 * norms.max() or abs(r_mat[k, k]) / norms[j] < 0.05:
            break
        resolved.append(int(j))
    free = [cands[j] for j in sorted(resolved)]
    mine = sorted(p["id"] for p in free)
    apps = sorted(pid for pid, p in params.items() if p["status"] == "fitted")
    yield (
        "fit",
        "parameters resolved by the data",
        "skrf QR vs app",
        mine == apps,
        "skrf %s, app %s" % (", ".join(mine), ", ".join(apps)),
    )

    # An independent refit with scipy on the scikit-rf model, of the set decided above.
    residuals = residuals_of(free)
    # Bounded so that no pad goes below zero and no value below 5 % (where the model is flat).
    lower = [
        -p["nominal"] / p["prior"] if p["kind"] == "pad" else -0.95 / p["prior"] for p in free
    ]
    sol = least_squares(
        residuals,
        np.zeros(len(free)),
        bounds=(lower, np.inf),
        method="trf",
        xtol=1e-15,
        ftol=1e-15,
        gtol=1e-15,
    )
    worst = 0.0
    names = []
    for ui, p in zip(sol.x, free):
        diff = abs(ui * p["prior"] - params[p["id"]]["drift"]) / p["prior"]
        worst = max(worst, diff)
        names.append(p["id"])
    yield (
        "fit",
        "scipy refit (" + ", ".join(names) + ")",
        "drifts",
        worst <= 1e-3,
        "worst %.2e of the prior width" % worst,
    )

    # Uncertainties, worked out here: s^2 (J^T J)^-1 from the Jacobian at the solution, s^2 the
    # residual sum of squares over 2N - P. Each app sigma must agree within 1 %; one that is half
    # its prior width or more would be unresolved.
    jac = jacobian(residuals, sol.x)
    res = residuals(sol.x)
    dof = len(res) - len(free)
    cov = np.linalg.inv(jac.T @ jac) * float(res @ res) / dof
    worst_sigma = 0.0
    for k, p in enumerate(free):
        sigma = float(np.sqrt(cov[k, k])) * p["prior"]
        app_sigma = params[p["id"]]["sigma"]
        rel = abs(app_sigma - sigma) / sigma if app_sigma is not None else float("inf")
        worst_sigma = max(worst_sigma, rel)
        if sigma >= 0.5 * p["prior"]:
            worst_sigma = float("inf")
    yield (
        "fit",
        "standard uncertainties",
        "skrf covariance vs app",
        worst_sigma <= 1e-2,
        "worst relative difference %.2e" % worst_sigma,
    )

    rt = d6["retune"]
    band = np.asarray(rt["band"], dtype=float)
    for key in ("fitted", "truth"):
        g = gamma_in(case, rt[key]["elements"], band)
        err = float(np.max(np.abs(g - _as_complex(rt[key]["gamma"]))))
        w = _worst_vswr(g)
        yield ("retune", "Gamma_in under the %s drifts" % key, "app vs skrf", err <= D6_TOLERANCE, "%.2e" % err)
        yield (
            "retune",
            "worst VSWR under the %s drifts" % key,
            "inside %.3g" % rt["limit"],
            w <= rt["limit"],
            "%.6g" % w,
        )
        if key == "fitted":
            err = abs(w - rt["worst"]) / w
            yield ("retune", "worst VSWR as predicted", "app vs skrf", err <= D6_TOLERANCE, "rel %.2e" % err)
