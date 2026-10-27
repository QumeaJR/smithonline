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
  decided here: the scaled Jacobian at the start by central differences on the
  scikit-rf model, columns taken largest remaining first, one whose cosine
  with a column taken before it is above sqrt(1 - 0.05^2) (0.99875) or which
  lies within 1e-6 of their span not resolved; the rest refitted with
  scipy.optimize.least_squares and the parameter whose standard uncertainty
  (worked out here, s^2 (J^T J)^-1, s^2 the residual sum of squares over
  2N - P) is half its prior width or more fixed and the rest refitted; the
  app's split must match, its drifts agree within a thousandth of each prior
  width and its standard uncertainties within 1 % (a sigma off by 1000 fails);
  the fitted drifts must lie within three of their uncertainties of the truth;
- the reference plane: the app's p-value of its F statistic must equal
  scipy's F distribution (1e-8), and the F-test is worked out here (the same
  parameters refitted with the plane from a scan of the plane alone over
  +-1 ns; s^2 against the floor, the residual's correlation inflation kappa,
  dof / kappa; called when p is below 0.001 and the plane is at least twice
  its uncertainty): on the sample it must not call for a plane, on the same file
  rotated by 5 mm of FR-4 microstrip (30.3 ps) it must, with the app's fit not
  trusted; ticked, the scipy refit of that file must agree with the app's
  drifts and put the plane, the pads and the values within three
  uncertainties of the truth;
- the retune's worst VSWR over the band is recomputed and must equal the
  app's prediction (1e-9) and lie inside the limit, under the fitted drifts and
  under the true ones;
- QA round 3: the floor (its own scatter estimate, at least 0.002), the
  stated uncertainties against it (s^2 the larger of RSS / (2N - P) and
  floor^2 / 2, times kappa when the scatter sets it) and equal to the larger
  of the fit's and the fit's with the plane, no drift moved by the plane on
  the sample, the global plane search by brute force on the 5 mm file (the
  app's plane within a grid step of the profile's best, no rival minimum
  inside the 99 % joint region), and the retune under each other explanation
  the app keeps: none worse than the board as it is.

Independent: the Touchstone reading, the cascade and its reflection
coefficient, the Jacobian, the identifiability decision, the least squares
solver, the covariance, the plane's start and the F distribution. Shared with
the app: the element models (check.py's port of them), the parameterization
of a drift (a value scaled by 1 + x, a pad capacitance added, a via scaled,
Gamma rotated by exp(-j 4 pi f tau) for the plane), the rule thresholds
(0.99875, 1e-6, half the prior width, p 0.001) and the snapped candidate
values (E24 from the app).
"""

import copy
import os

import numpy as np
import skrf as rf

D6_TOLERANCE = 1e-9
ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))


def _as_complex(pairs):
    return np.array([complex(a, b) for a, b in pairs])


def _soft_above(x, lo, c):
    """The app's smooth lower bound (closedloop.ts softAbove): x down to lo + c, then
    lo + c^2 / (2c - (x - lo)); no flat region."""
    t = x - lo
    return x if t >= c else lo + c * c / (2 * c - t)


def _drifted(elements, free, x):
    """The as-built elements with the drifts x applied, as the app applies them: a relative
    factor bounded smoothly above 0.05, a pad linear in its drift and of either sign."""
    out = copy.deepcopy(elements)
    for p, v in zip(free, x):
        if p["kind"] == "value":
            el = out[p["index"]]
            el["value"] = el["value"] * _soft_above(1.0 + v, 0.05, 0.01)
        elif p["kind"] == "pad":
            el = out[p["index"]]
            par = dict(el.get("parasitics", {}))
            par["pad"] = par.get("pad", 0.0) + v
            el["parasitics"] = par
        elif p["kind"] == "via":
            for el in out:
                b = el.get("board")
                if b and "via" in b:
                    b["via"] = b["via"] * _soft_above(1.0 + v, 0.05, 0.01)
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

    # Identifiability, decided here on the scikit-rf model: the scaled Jacobian at the start by
    # central differences; columns taken largest remaining first; one whose cosine with a column
    # taken before it is above sqrt(1 - 0.05^2) (0.99875), or which lies within 1e-6 of their
    # span, is not resolved. The rest is fitted with scipy, and the parameter whose standard
    # uncertainty (worked out here) is half its prior width or more is fixed and the rest fitted
    # again. The app's split must be the same.
    from scipy.optimize import least_squares
    from scipy.stats import f as f_dist

    like_one = np.sqrt(1 - 0.05**2)
    cands = d6["fitted"]["candidates"]
    base = d6["designed"]["elements"]
    plane_param = {"id": "plane", "kind": "plane", "index": None, "prior": 20e-12, "nominal": 0.0}

    def residuals_of(sel, target):
        def residuals(u):
            x = [ui * p["prior"] for ui, p in zip(u, sel)]
            edits = [(p, v) for p, v in zip(sel, x) if p["kind"] != "plane"]
            g = gamma_in(case, _drifted(base, [p for p, _ in edits], [v for _, v in edits]), fs)
            tau = sum(v for p, v in zip(sel, x) if p["kind"] == "plane")
            g = g * np.exp(-4j * np.pi * fs * tau)
            d = g - target
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

    def picked_of(j0):
        norms = np.linalg.norm(j0, axis=0)
        work = j0.copy()
        left = [j for j in range(j0.shape[1]) if norms[j] > 1e-9 * norms.max()]
        picked = []
        while left:
            j = max(left, key=lambda k: np.linalg.norm(work[:, k]))
            left.remove(j)
            r = np.linalg.norm(work[:, j]) / norms[j]
            cos = max(
                [abs(j0[:, j] @ j0[:, i]) / (norms[j] * norms[i]) for i in picked], default=0.0
            )
            if cos > like_one or r < 1e-6:
                continue
            picked.append(j)
            q = work[:, j] / np.linalg.norm(work[:, j])
            for k in left:
                work[:, k] -= (work[:, k] @ q) * q
        return sorted(picked)

    def plane_scan(target):
        """The plane alone that brings the designed Gamma closest to the target: a scan of +-1 ns."""
        g = gamma_in(case, base, fs)
        step = 1 / (40 * fs.max())
        taus = np.arange(-1e-9, 1e-9 + step, step)
        costs = [np.sum(np.abs(g * np.exp(-4j * np.pi * fs * t) - target) ** 2) for t in taus]
        return float(taus[int(np.argmin(costs))])

    def solve(sel, target, starts):
        fun = residuals_of(sel, target)
        lower = [-1e-9 / p["prior"] if p["kind"] == "plane" else -np.inf for p in sel]
        upper = [1e-9 / p["prior"] if p["kind"] == "plane" else np.inf for p in sel]
        best = None
        for u0 in starts:
            sol = least_squares(
                fun,
                np.clip(u0, np.array(lower) + 1e-12, np.array(upper) - 1e-12),
                bounds=(lower, upper),
                method="trf",
                xtol=1e-15,
                ftol=1e-15,
                gtol=1e-15,
            )
            if best is None or sol.cost < best.cost:
                best = sol
        jac = jacobian(fun, best.x)
        res = fun(best.x)
        dof = len(res) - len(sel)
        cov = np.linalg.inv(jac.T @ jac) * float(res @ res) / dof
        sig = np.sqrt(np.diag(cov)) * np.array([p["prior"] for p in sel])
        return best.x, sig, float(res @ res), dof

    def fit_set(sel, target, tau0):
        u_start = [tau0 / p["prior"] if p["kind"] == "plane" else 0.0 for p in sel]
        j0 = jacobian(residuals_of(sel, target), u_start)
        active = [sel[j] for j in picked_of(j0)]
        while True:
            has_plane = any(p["kind"] == "plane" for p in active)
            starts = [
                np.array([t / p["prior"] if p["kind"] == "plane" else 0.0 for p in active])
                for t in ((tau0, 0.0) if has_plane else (0.0,))
            ]
            x, sig, rss, dof = solve(active, target, starts)
            ratio = [s / p["prior"] for s, p in zip(sig, active)]
            k = int(np.argmax(ratio))
            if ratio[k] < 0.5:
                return active, x, sig, rss, dof
            active = active[:k] + active[k + 1 :]

    free, sol_x, sol_sig, rss0, dof0 = fit_set(cands, g_meas, 0.0)
    mine = sorted(p["id"] for p in free)
    apps = sorted(pid for pid, p in params.items() if p["status"] == "fitted")
    yield (
        "fit",
        "parameters resolved by the data",
        "skrf rule vs app",
        mine == apps,
        "skrf %s, app %s" % (", ".join(mine), ", ".join(apps)),
    )
    worst = 0.0
    for ui, p in zip(sol_x, free):
        worst = max(worst, abs(ui * p["prior"] - params[p["id"]]["drift"]) / p["prior"])
    yield (
        "fit",
        "scipy refit (" + ", ".join(p["id"] for p in free) + ")",
        "drifts",
        worst <= 1e-3,
        "worst %.2e of the prior width" % worst,
    )
    # The stated uncertainty (fix round 3), worked out here: s^2 is the larger of RSS / (2N - P)
    # and the floor's variance floor^2 / 2, the floor the larger of the scatter between
    # neighbouring points (median estimator) and the lab VNA's 0.002; when the scatter sets s^2 it
    # is scaled by the residual's correlation inflation kappa (1 + 2 sum of the lag
    # autocorrelations while above 2 / sqrt(2N)).
    def scatter_floor(g):
        e = []
        for k in range(1, len(fs) - 1):
            w = (fs[k + 1] - fs[k]) / (fs[k + 1] - fs[k - 1])
            d = g[k] - (w * g[k - 1] + (1 - w) * g[k + 1])
            e.append(abs(d) ** 2 / (1 + w * w + (1 - w) ** 2))
        return float(np.sqrt(np.median(e) / np.log(2)))

    floor = max(scatter_floor(g_meas), 0.002)
    yield (
        "fit",
        "floor used",
        "scatter or lab accuracy, here vs app",
        abs(floor - d6["fitted"]["floorUsed"]) <= 1e-9 * floor,
        "%.6g vs %.6g" % (floor, d6["fitted"]["floorUsed"]),
    )

    def kappa_of(res):
        n = len(res) // 2
        re, im = res[:n], res[n:]
        r0 = float(re @ re + im @ im)
        total = 0.0
        for lag in range(1, n // 4 + 1):
            rho = float(re[:-lag] @ re[lag:] + im[:-lag] @ im[lag:]) / r0
            if not rho > 2 / np.sqrt(2 * n):
                break
            total += rho
        return min(n / 4, max(1.0, 1 + 2 * total))

    def stated(sel, target, x):
        fun = residuals_of(sel, target)
        jac = jacobian(fun, x)
        res = fun(x)
        dof = len(res) - len(sel)
        raw = float(res @ res) / dof
        s2, kappa = (raw, kappa_of(res)) if raw > floor**2 / 2 else (floor**2 / 2, 1.0)
        cov = np.linalg.inv(jac.T @ jac) * s2 * kappa
        return np.sqrt(np.diag(cov)) * np.array([p["prior"] for p in sel]), s2, kappa

    own_sig, _, _ = stated(free, g_meas, sol_x)
    own_app = {p["id"]: p for p in d6["fitted"]["own"]}
    worst_sigma = 0.0
    for s, p in zip(own_sig, free):
        app_sigma = own_app[p["id"]]["sigma"]
        rel = abs(app_sigma - s) / s if app_sigma is not None else float("inf")
        worst_sigma = max(worst_sigma, rel)
    yield (
        "fit",
        "standard uncertainties against the floor",
        "skrf covariance vs app",
        worst_sigma <= 1e-2,
        "worst relative difference %.2e" % worst_sigma,
    )

    # The F-test of the reference plane, worked out here: the same parameters refitted with the
    # plane (scipy, from a scan of the plane alone), F = (RSS0 - RSS1) / extra / (RSS1 / dof1),
    # its p-value from scipy's F distribution. The app's p (its own incomplete beta) must equal
    # scipy's for the app's F, and its decision (p below 0.001) must be the one made here.
    def plane_test(target, rss_without, n_without):
        tau0 = plane_scan(target)
        act1, x1, sig1, rss1, dof1 = fit_set(cands + [plane_param], target, tau0)
        extra = max(1, len(act1) - n_without)
        # Fix round 3: s^2 against the floor and kappa, dof / kappa; called when p is below 0.001
        # and the plane is at least twice its own uncertainty.
        sig1, s2, kappa = stated(act1, target, x1)
        f_val = max(0.0, rss_without - rss1) / extra / (s2 * kappa)
        k = [p["id"] for p in act1].index("plane") if any(p["id"] == "plane" for p in act1) else None
        tau = float(x1[k] * plane_param["prior"]) if k is not None else 0.0
        sig = float(sig1[k]) if k is not None else float("nan")
        p_val = float(f_dist.sf(f_val, extra, dof1 / kappa))
        called = p_val < 1e-3 and abs(tau) >= 2 * sig
        return f_val, p_val, called, extra, dof1, tau, sig, act1, x1, sig1

    pc = d6["fitted"].get("planeCheck")
    if pc:
        own = float(f_dist.sf(pc["f"], pc["extra"], pc["dof"] / pc["kappa"]))
        rel = abs(own - pc["p"]) / max(own, 1e-300)
        yield ("plane", "app p-value of its F", "scipy F sf", rel <= 1e-8, "%.6g vs %.6g" % (pc["p"], own))
        f_val, p_val, called, _, _, _, _, act1, x1, sig1 = plane_test(g_meas, rss0, len(free))
        yield (
            "plane",
            "no plane in the sample",
            "same decision as the F-test here",
            called == pc["better"] and not pc["better"],
            "app p %.3g, here p %.3g (F %.3g)" % (pc["p"], p_val, f_val),
        )
        # A drift the plane moves by more than twice the larger of the two uncertainties makes
        # the fit untrusted; the stated uncertainty is that larger one.
        alt = {p["id"]: (ui * p["prior"], s) for ui, s, p in zip(x1, sig1, act1)}
        moved, worst_stated = [], 0.0
        for ui, s_own, p in zip(sol_x, own_sig, free):
            to, s_alt = alt.get(p["id"], (None, None))
            if to is None:
                continue
            wide = max(s_own, s_alt)
            if abs(to - ui * p["prior"]) > 2 * wide:
                moved.append(p["id"])
            app_sigma = params[p["id"]]["sigma"]
            worst_stated = max(worst_stated, abs(app_sigma - wide) / wide)
        yield (
            "plane",
            "drifts the plane moves (none on the sample)",
            "here vs app",
            sorted(moved) == sorted(pc["moved"]) and not moved and d6["fitted"]["trusted"],
            "here %s, app %s" % (moved, pc["moved"]),
        )
        yield (
            "fit",
            "stated uncertainty: the larger of the fit's and the fit's with the plane",
            "skrf vs app",
            worst_stated <= 2e-2,
            "worst relative difference %.2e" % worst_stated,
        )

    pl = d6.get("plane")
    if pl:
        target = g_meas * np.exp(-4j * np.pi * fs * pl["tau"])
        _, _, rss0p, _ = solve(free, target, [np.zeros(len(free))])
        f_val, p_val, called, extra, dof1, tau, sig, act1, x1, sig1 = plane_test(
            target, rss0p, len(free)
        )
        upc = pl["unticked"]["planeCheck"]
        yield (
            "plane",
            "5 mm offset unticked",
            "F-test here flags it, app not trusted",
            called and upc["better"] and not pl["unticked"]["trusted"],
            "here p %.3g, plane %.4g ps; app p %.3g, plane %.4g ps"
            % (p_val, tau * 1e12, upc["p"], upc["drift"] * 1e12),
        )
        tp = {p["id"]: p for p in pl["ticked"]["parameters"]}
        worst = 0.0
        for ui, p in zip(x1, act1):
            q = tp[p["id"]]
            worst = max(worst, abs(ui * p["prior"] - q["drift"]) / p["prior"]) if q["status"] == "fitted" else float("inf")
        yield (
            "plane",
            "5 mm offset ticked: scipy refit (" + ", ".join(p["id"] for p in act1) + ")",
            "drifts",
            worst <= 1e-3,
            "worst %.2e of the prior width" % worst,
        )
        truth = dict(d6["truth"])
        truth["plane"] = pl["tau"]
        bad = [
            "%s %.4g +- %.2g (truth %.4g)" % (p["id"], ui * p["prior"], s, truth.get(p["id"], 0.0))
            for ui, s, p in zip(x1, sig1, act1)
            if abs(ui * p["prior"] - truth.get(p["id"], 0.0)) > 3 * s
        ]
        yield (
            "plane",
            "5 mm offset ticked: truth in 3 sigma",
            "plane, pads and values",
            not bad and pl["ticked"]["trusted"],
            "; ".join(bad) if bad else "plane %.4g ps +- %.2g (truth %.4g)" % (tau * 1e12, sig * 1e12, pl["tau"] * 1e12),
        )

        # The global plane search (fix round 3), checked here by brute force: the plane on a grid
        # of 1 / (40 f_max) over the app's range, the other free parameters refitted by scipy at
        # every step (from the step before and from no drift, the better kept). The app's plane
        # must lie within a step of the grid's best, and no other local minimum of that profile
        # may lie inside the 99 % joint region (RSS within P s^2 kappa F(P, dof / kappa; 0.99)),
        # as the app found none.
        board = [p for p in act1 if p["kind"] != "plane"]
        rng = pl["ticked"]["planeRange"]
        step = 1 / (40 * fs.max())
        taus = np.arange(-rng, rng + step / 2, step)
        prof = []
        u = np.zeros(len(board))
        for t in taus:
            fun = residuals_of(board, target * np.exp(4j * np.pi * fs * t))
            best = None
            for u0 in (u, np.zeros(len(board))):
                sol = least_squares(fun, u0, method="lm", xtol=1e-12, ftol=1e-12)
                if best is None or sol.cost < best.cost:
                    best = sol
            u = best.x
            prof.append(2 * best.cost)
        prof = np.array(prof)
        i0 = int(np.argmin(prof))
        _, s2t, kt = stated(act1, target, x1)
        dof_t = 2 * len(fs) - len(act1)
        region = len(act1) * s2t * kt * f_dist.ppf(0.99, len(act1), dof_t / kt)
        minima = [
            i
            for i in range(len(prof))
            if (i == 0 or prof[i] <= prof[i - 1]) and (i == len(prof) - 1 or prof[i] < prof[i + 1])
        ]
        rivals = [taus[i] for i in minima if abs(i - i0) > 2 and prof[i] - prof[i0] <= region]
        yield (
            "plane",
            "5 mm offset ticked: the global plane search",
            "brute-force profile here vs app",
            abs(taus[i0] - tp["plane"]["drift"]) <= step
            and not rivals
            and pl["ticked"]["ambiguous"] == 0,
            "grid best %.4g ps, app %.4g ps, %d local minima, rivals inside the region: %s"
            % (taus[i0] * 1e12, tp["plane"]["drift"] * 1e12, len(minima), [round(r * 1e12, 1) for r in rivals]),
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

    # The retune under every other explanation the data allows (fix round 3): rebuilt here, the
    # board with the retune is no worse than the board as it is under each, and the worst of them
    # is the app's stated worstAlternative.
    alts = rt.get("alternatives") or []
    if alts:
        worse, worst_alt = [], 0.0
        for i, a in enumerate(alts):
            w0 = _worst_vswr(gamma_in(case, a["asIs"], band))
            w1 = _worst_vswr(gamma_in(case, a["retuned"], band))
            worst_alt = max(worst_alt, w1)
            if not w1 <= w0 * (1 + 1e-9):
                worse.append("%d: %.5g after, %.5g as is" % (i, w1, w0))
        yield (
            "retune",
            "no worse under each of %d other explanations" % len(alts),
            "skrf",
            not worse,
            "; ".join(worse) if worse else "worst %.6g" % worst_alt,
        )
        stated_alt = rt.get("worstAlternative")
        err = abs(worst_alt - stated_alt) / worst_alt if stated_alt else float("inf")
        yield (
            "retune",
            "worst under the other explanations",
            "app vs skrf",
            err <= D6_TOLERANCE,
            "%.6g vs %.6g, rel %.2e" % (stated_alt or float("nan"), worst_alt, err),
        )
