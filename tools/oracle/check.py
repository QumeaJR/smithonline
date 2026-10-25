#!/usr/bin/env python3
"""Independent oracle for Smith Online's network evaluation.

Reads the cases written by tools/oracle/export.mjs and recomputes them
outside the app:

1. scikit-rf: every ladder is rebuilt from its element values with
   scikit-rf's media and Network primitives (series and shunt impedances,
   transmission lines and stubs of the same characteristic impedance and
   propagation, cascading and renormalization) and its S-parameters are
   compared with the app's. A relative error above 1e-9 fails (above the
   case's own `tolerance` where it has one: the .s2p text round trip is
   compared at its 9 significant digits, 1e-8).
2. ngspice: every SPICE netlist the app wrote is run in batch mode (.ac
   analysis); the input impedance is read from the node voltages and
   compared with the app's. A relative error above 1e-6 fails.

What is independent and what is not. Independent of the app: scikit-rf's
cascading of two-ports, its renormalization of a line to the port impedance,
its conversion to S-parameters and its line and stub networks; ngspice's
nodal solution of the netlist. Copied from the app's element formulas (so an
error in those formulas would be repeated here, not caught): the branch
impedance of each lumped part with its Q, ESR, Cp and ESL, the package pad
capacitance split half to each end, the lossy line's attenuation scaling
(alpha in dB/m at the reference frequency, times sqrt(f / fref), over the
physical length from er), the RLC block formulas, and the ideal transformer,
whose S-parameters come from its closed-form ABCD matrix. Those formulas are
textbook expressions checked separately by the closed-form pins in
packages/core/test/qa-d1-model-pins.test.ts; this oracle checks everything
built on top of them.

3. Fitted loads (phase D2): for every measured load the app fitted, the
   true load is recomputed from its element values with scikit-rf, the
   app's rational model is evaluated from its poles, residues, d and e with
   numpy (not with the app's evaluator), and the comparison checks: the
   app's evaluation against numpy's (1e-9), the model against the truth
   (the case's tolerance: 1e-8 for clean data, the noise level for noisy
   data), the impedance the band tools read against the truth, the
   residuals the app reports, every pole in the left half plane, |Gamma| <=
   1 + 1e-9 on a dense grid 10 percent past the band, and for a series RL
   load the app's Bode-Fano floor against Fano's closed form (1 percent).

4. Sensitivity and yield (phase D3, d3_check.py): the app's analytic derivatives of the input
   reflection coefficient against central differences of the scikit-rf ladder (1e-6), its
   Monte Carlo yield of an L match against brute-force integration over the tolerance box with
   numpy, its worst corner against every corner and the grid, its Wilson interval against the
   closed form and its correlated draws against the coefficients asked for.

Usage:
    python tools/oracle/check.py oracle-cases.json [--report oracle-report.txt]
    python tools/oracle/check.py --self-test

The exit status is 0 when every comparison passes and 1 otherwise.
"""

import argparse
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile

import numpy as np
import skrf as rf
from skrf.media import DefinedGammaZ0

from d3_check import check_d3, check_sensitivity

C0 = 299792458.0
NEPER_PER_DB = math.log(10.0) / 20.0
S_TOLERANCE = 1e-9
SPICE_TOLERANCE = 1e-6
FIT_EVAL_TOLERANCE = 1e-9
FIT_PASSIVITY_SLACK = 1e-9
FIT_FLOOR_TOLERANCE = 0.01


# --------------------------------------------------------------- building


def frequency_of(freqs):
    return rf.Frequency.from_f(np.asarray(freqs, dtype=float), unit="hz")


def media_of(freq, z0, gamma=1j):
    """A media with characteristic and port impedance z0."""
    return DefinedGammaZ0(frequency=freq, z0=z0, gamma=gamma)


def series_z(media, z):
    """A series impedance z (array over frequency) as a two-port."""
    return media.resistor(np.asarray(z, dtype=complex))


def shunt_z(media, z):
    """A shunt impedance z to ground as a two-port."""
    return media.shunt(media.resistor(np.asarray(z, dtype=complex)) ** media.short())


def ideal_q(q):
    return q is None or not (q > 0) or math.isinf(q)


def branch_impedance(el, w):
    """Impedance of a lumped element's branch at angular frequencies w."""
    kind = el["kind"]
    if kind == "R":
        return np.full_like(w, el["value"], dtype=complex)
    if kind == "L":
        par = el.get("parasitics", {})
        x = w * el["value"]
        r = (0.0 if ideal_q(el.get("q")) else x / el["q"]) + par.get("esr", 0.0)
        z = r + 1j * x
        cp = par.get("cp", 0.0)
        if cp > 0:
            z = 1.0 / (1.0 / z + 1j * w * cp)
        return z
    if kind == "C":
        par = el.get("parasitics", {})
        x = -1.0 / (w * el["value"])
        r = 0.0 if ideal_q(el.get("q")) else -x / el["q"]
        return r + 1j * (x + w * par.get("esl", 0.0))
    if kind == "RLC":
        r = el.get("r", 0.0)
        l = el.get("l", 0.0)
        c = el.get("c", 0.0)
        if el["connection"] == "series":
            x = (w * l if l > 0 else 0.0) - (1.0 / (w * c) if c > 0 else 0.0)
            return r + 1j * x
        g = 1.0 / r if r > 0 else 0.0
        b = (w * c if c > 0 else 0.0) - (1.0 / (w * l) if l > 0 else 0.0)
        return 1.0 / (g + 1j * b)
    raise ValueError("not a lumped element: " + kind)


def line_propagation(el, f):
    """Total attenuation (Np) plus j times electrical length (rad) of a line or stub, as an
    array over the frequencies f. Without a reference frequency the electrical length is the
    same at every frequency, as in the app."""
    fref = el.get("refFrequency")
    scale = np.ones_like(f) if fref is None else f / fref
    beta_l = 2.0 * math.pi * el["length"] * scale
    alpha = el.get("alphaDbPerM", 0.0)
    if alpha == 0.0:
        return 1j * beta_l
    fr = f if fref is None else fref * np.ones_like(f)
    metres = el["length"] * (C0 / fr) / math.sqrt(el.get("er", 1.0))
    return alpha * NEPER_PER_DB * metres * np.sqrt(f / fr) + 1j * beta_l


def line_network(freq, f, el, z0):
    """A series line of characteristic impedance el.z0, renormalized to z0."""
    gl = line_propagation(el, f)
    # One metre of a medium whose propagation constant is the whole line's gamma l.
    m = media_of(freq, abs(el["z0"]), gamma=gl)
    ntwk = m.line(1.0, unit="m")
    ntwk.renormalize(z0)
    return ntwk


def stub_impedance(freq, f, el):
    """Input impedance of an open or shorted stub, from a scikit-rf line and termination."""
    gl = line_propagation(el, f)
    m = media_of(freq, abs(el["z0"]), gamma=gl)
    end = m.open() if el["kind"] == "openStub" else m.short()
    return (m.line(1.0, unit="m") ** end).z[:, 0, 0]


def transformer_network(freq, n, z0):
    """Ideal transformer, voltage ratio n (source sees n^2 times the load), from its closed-form
    ABCD matrix [[n, 0], [0, 1/n]] converted to S at z0 with the textbook formula. This is
    independent of the app's cascade code; scikit-rf's renormalization of a mismatched thru uses
    a reference-impedance convention that does not match the textbook sign of S22."""
    nf = len(freq.f)
    a, b, c, d = n, 0.0, 0.0, 1.0 / n
    delta = a + b / z0 + c * z0 + d
    s = np.zeros((nf, 2, 2), dtype=complex)
    s[:, 0, 0] = (a + b / z0 - c * z0 - d) / delta
    s[:, 0, 1] = 2.0 * (a * d - b * c) / delta
    s[:, 1, 0] = 2.0 / delta
    s[:, 1, 1] = (-a + b / z0 - c * z0 + d) / delta
    return rf.Network(frequency=freq, s=s, z0=z0)


def element_network(freq, f, el, z0):
    media = media_of(freq, z0)
    w = 2.0 * math.pi * f
    kind = el["kind"]
    if kind in ("R", "L", "C", "RLC"):
        zb = branch_impedance(el, w)
        pad = 0.0
        if kind in ("L", "C"):
            pad = el.get("parasitics", {}).get("pad", 0.0)
        if el["orientation"] == "shunt":
            y = 1.0 / zb + (1j * w * pad / 2.0 if pad > 0 else 0.0)
            return shunt_z(media, 1.0 / y)
        if pad > 0:
            # Half the pad capacitance to ground at each end of a series part.
            half = shunt_z(media, 1.0 / (1j * w * pad / 2.0))
            return half ** series_z(media, zb) ** half
        return series_z(media, zb)
    if kind == "transformer":
        return transformer_network(freq, el["n"], z0)
    if kind == "line":
        return line_network(freq, f, el, z0)
    if kind in ("openStub", "shortStub"):
        return shunt_z(media, stub_impedance(freq, f, el))
    raise ValueError("unknown element kind: " + kind)


def ladder_network(case):
    """The ladder as one scikit-rf two-port, port 1 at the source, port 2 at the load."""
    f = np.asarray(case["frequencies"], dtype=float)
    freq = frequency_of(f)
    z0 = case["z0"]
    ntwk = None
    # Elements are stored load side first; the source end is port 1.
    for el in reversed(case["elements"]):
        part = element_network(freq, f, el, z0)
        ntwk = part if ntwk is None else ntwk ** part
    return ntwk


# -------------------------------------------------------------- comparing


def as_complex(pair):
    return complex(pair[0], pair[1])


def app_s(case):
    """The app's S-parameters as an array (frequency, 2, 2)."""
    out = np.zeros((len(case["frequencies"]), 2, 2), dtype=complex)
    for k, (s11, s12, s21, s22) in enumerate(case["s"]):
        out[k] = [[as_complex(s11), as_complex(s12)], [as_complex(s21), as_complex(s22)]]
    return out


def compare_s(case):
    """Largest relative error of the app's S matrix against scikit-rf's, and of Zin."""
    ref = ladder_network(case).s
    got = app_s(case)
    worst = 0.0
    for k in range(ref.shape[0]):
        scale = max(np.max(np.abs(ref[k])), 1e-300)
        worst = max(worst, float(np.max(np.abs(got[k] - ref[k]))) / scale)
    # Input impedance with the load: Gamma_in = S11 + S12 S21 Gamma_L / (1 - S22 Gamma_L).
    z0 = case["z0"]
    zl = as_complex(case["load"])
    gl = (zl - z0) / (zl + z0)
    gin = ref[:, 0, 0] + ref[:, 0, 1] * ref[:, 1, 0] * gl / (1.0 - ref[:, 1, 1] * gl)
    zapp = np.array([as_complex(z) for z in case["zin"]])
    gapp = (zapp - z0) / (zapp + z0)
    zin_err = float(np.max(np.abs(gapp - gin)))
    return worst, zin_err


def case_tolerance(case):
    """The S tolerance of a case: its own `tolerance` when it has one, else S_TOLERANCE."""
    return float(case.get("tolerance", S_TOLERANCE))


# ---------------------------------------------------------------- ngspice


def parse_raw_ascii(text):
    """Vectors of an ASCII rawfile of one complex (AC) plot, by lower-case name."""
    lines = text.splitlines()
    nvars = npoints = None
    names = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("No. Variables:"):
            nvars = int(line.split(":", 1)[1])
        elif line.startswith("No. Points:"):
            npoints = int(line.split(":", 1)[1])
        elif line.startswith("Variables:"):
            for j in range(nvars):
                names.append(lines[i + 1 + j].split()[1].lower())
            i += nvars
        elif line.startswith("Values:"):
            tokens = " ".join(lines[i + 1 :]).split()
            break
        i += 1
    else:
        raise ValueError("no Values section in the rawfile")
    if nvars is None or npoints is None or len(names) != nvars:
        raise ValueError("incomplete rawfile header")
    step = nvars + 1
    if len(tokens) < step * npoints:
        raise ValueError("rawfile has fewer values than its header says")
    data = {name: [] for name in names}
    for p in range(npoints):
        row = tokens[p * step : (p + 1) * step]
        for name, tok in zip(names, row[1:]):
            re_part, im_part = tok.split(",")
            data[name].append(complex(float(re_part), float(im_part)))
    return {name: np.array(v) for name, v in data.items()}


def vector(vectors, name):
    """A node voltage by node name, whether the rawfile calls it v(node) or node."""
    for key in (name, "v(%s)" % name):
        if key in vectors:
            return vectors[key]
    raise KeyError("no vector %s in the rawfile (it has %s)" % (name, ", ".join(sorted(vectors))))


def run_ngspice(netlist, workdir):
    """Run the netlist in ngspice batch mode; returns (frequencies, Zin) at the input node."""
    match = re.search(r"^RSRC\s+(\S+)\s+(\S+)\s+(\S+)\s*$", netlist, re.MULTILINE)
    if not match:
        raise ValueError("no RSRC line in the netlist")
    src, node, rsrc = match.group(1).lower(), match.group(2).lower(), float(match.group(3))
    raw = os.path.join(workdir, "out.raw")
    if os.path.exists(raw):
        os.remove(raw)
    control = "\n".join(
        [
            # Every node gets 1e12 ohm to ground so a node that only capacitors reach still
            # has a DC operating point; its effect on Zin is far below the tolerance.
            ".options rshunt=1e12",
            ".control",
            "set filetype=ascii",
            "run",
            "write out.raw v(%s) v(%s)" % (node, src),
            "set noaskquit",
            "quit",
            ".endc",
        ]
    )
    lines = netlist.rstrip("\n").split("\n")
    if lines[-1].strip().lower() != ".end":
        raise ValueError("the netlist does not end with .end")
    deck = "\n".join(lines[:-1] + [control, ".end"]) + "\n"
    deck_path = os.path.join(workdir, "deck.cir")
    with open(deck_path, "w", encoding="ascii") as fh:
        fh.write(deck)
    logs = []
    # Batch mode runs the .control section; plain mode without a terminal is the fallback.
    for command in (["ngspice", "-b", "deck.cir"], ["ngspice", "deck.cir"]):
        proc = subprocess.run(
            command,
            cwd=workdir,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=120,
        )
        logs.append(
            "%s (exit %d)\n%s\n%s" % (" ".join(command), proc.returncode, proc.stdout, proc.stderr)
        )
        if os.path.exists(raw):
            break
    if not os.path.exists(raw):
        raise RuntimeError("ngspice wrote no rawfile:\n" + "\n".join(logs))
    with open(raw, "r", encoding="ascii", errors="replace") as fh:
        vectors = parse_raw_ascii(fh.read())
    freq = np.real(vector(vectors, "frequency"))
    v_in = vector(vectors, node)
    v_src = vector(vectors, src)
    zin = rsrc * v_in / (v_src - v_in)
    return freq, zin


def compare_spice(spice, workdir):
    freq, zin = run_ngspice(spice["netlist"], workdir)
    expected_f = np.asarray(spice["frequencies"], dtype=float)
    if len(freq) != len(expected_f):
        raise ValueError("ngspice gave %d points, expected %d" % (len(freq), len(expected_f)))
    f_err = float(np.max(np.abs(freq - expected_f) / expected_f))
    if f_err > 1e-9:
        raise ValueError("ngspice frequencies differ from the app's by %.3g" % f_err)
    zapp = np.array([as_complex(z) for z in spice["zin"]])
    return float(np.max(np.abs(zin - zapp) / np.abs(zapp)))


# ------------------------------------------------------------ fitted loads


def evaluate_model(model, freqs):
    """H(s) = sum r / (s - a) + d + s e at s = j 2 pi f, from the poles and residues (rad/s)."""
    s = 2j * math.pi * np.asarray(freqs, dtype=float)
    poles = np.array([as_complex(p) for p in model["poles"]], dtype=complex)
    residues = np.array([as_complex(r) for r in model["residues"]], dtype=complex)
    h = model["d"] + s * model["e"] + 0j
    if poles.size:
        h = h + np.sum(residues[None, :] / (s[:, None] - poles[None, :]), axis=1)
    return h


def true_gamma(fit, freqs):
    """Gamma of the ladder on its resistor, recomputed with scikit-rf from the element values."""
    z0 = fit["z0"]
    case = {"frequencies": list(freqs), "z0": z0, "elements": fit["elements"]}
    s = ladder_network(case).s
    zl = complex(fit["termination"])
    gl = (zl - z0) / (zl + z0)
    return s[:, 0, 0] + s[:, 0, 1] * s[:, 1, 0] * gl / (1.0 - s[:, 1, 1] * gl)


def fano_floor(fano):
    """Fano's exact floor (Pozar section 5.9) for the single-reactance load of a case."""
    w1 = 2.0 * math.pi * fano["lo"]
    w2 = 2.0 * math.pi * fano["hi"]
    if fano["kind"] != "series RL":
        raise ValueError("no closed form here for " + fano["kind"])
    ln = math.pi * fano["r"] / (fano["l"] * (w2 - w1))
    g = math.exp(-ln)
    return (1.0 + g) / (1.0 - g)


def passivity_peak(model, lo, hi):
    """Largest |Gamma| of a model on 20 001 points from 0.9 lo to 1.1 hi."""
    grid = np.linspace(0.9 * lo, 1.1 * hi, 20001)
    return float(np.max(np.abs(evaluate_model(model, grid))))


def gamma_in(case, elements, freqs):
    """Input reflection coefficient of a ladder with the case's load, from scikit-rf."""
    z0 = case["z0"]
    s = ladder_network({"frequencies": list(freqs), "z0": z0, "elements": elements}).s
    zl = as_complex(case["load"])
    gl = (zl - z0) / (zl + z0)
    return s[:, 0, 0] + s[:, 0, 1] * s[:, 1, 0] * gl / (1.0 - s[:, 1, 1] * gl)


def check_fit(fit):
    """Every check of one fitted load: a list of (label, ok, detail)."""
    z0 = fit["z0"]
    out = []
    check = np.asarray(fit["check"], dtype=float)
    mine = evaluate_model(fit["model"], check)
    app = np.array([as_complex(g) for g in fit["appGamma"]])
    err = float(np.max(np.abs(mine - app)))
    out.append(("evaluation", err <= FIT_EVAL_TOLERANCE, "numpy vs app %.2e" % err))

    truth = true_gamma(fit, check)
    tol = float(fit["truthTolerance"])
    err = float(np.max(np.abs(mine - truth)))
    out.append(("model vs truth", err <= tol, "%.2e (tolerance %.0e)" % (err, tol)))

    zapp = np.array([as_complex(z) for z in fit["appZ"]])
    gz = (zapp - z0) / (zapp + z0)
    err = float(np.max(np.abs(gz - truth)))
    out.append(("load Z vs truth", err <= tol, "%.2e in Gamma" % err))

    data = np.array([as_complex(g) for g in fit["data"]])
    at = evaluate_model(fit["model"], fit["measured"])
    res = np.abs(at - data)
    rms = float(math.sqrt(np.mean(res**2)))
    mx = float(np.max(res))
    # Clean fits sit at the rounding floor (1e-15), where only the order of magnitude agrees.
    ok_rms = abs(rms - fit["rms"]) <= 1e-6 * fit["rms"] + 1e-13
    ok_max = abs(mx - fit["maxResidual"]) <= 1e-6 * fit["maxResidual"] + 1e-13
    detail = "RMS %.3e (app %.3e), max %.3e (app %.3e)" % (rms, fit["rms"], mx, fit["maxResidual"])
    out.append(("residuals", ok_rms and ok_max, detail))

    worst_re = max(as_complex(p).real for p in fit["model"]["poles"])
    out.append(("stability", worst_re < 0.0, "largest Re(pole) %.3e rad/s" % worst_re))

    lo, hi = fit["band"]
    peak = passivity_peak(fit["model"], lo, hi)
    out.append(("passivity", peak <= 1.0 + FIT_PASSIVITY_SLACK, "max |Gamma| %.12f" % peak))

    # A case whose raw fit was not passive: the app must say it enforced passivity.
    report = fit.get("passivity")
    if report and report["maxBefore"] > 1.0:
        ok = report["method"] in ("perturbation", "scaling")
        detail = "raw max |Gamma| %.6f, %s" % (report["maxBefore"], report["method"])
        out.append(("enforcement", ok, detail))

    if "fano" in fit:
        fano = fit["fano"]
        exact = fano_floor(fano)
        rel = abs(fano["floor"] / exact - 1.0)
        ok = rel <= FIT_FLOOR_TOLERANCE and fano["method"] == "exact" and fano["fromFit"]
        detail = "app %.6f (%s) vs closed form %.6f, rel %.2e" % (
            fano["floor"],
            fano["method"],
            exact,
            rel,
        )
        out.append(("Fano floor", ok, detail))
    return out


# ------------------------------------------------------------------- main


def status(ok):
    return "PASS" if ok else "FAIL"


def check(cases_path, report_path):
    with open(cases_path, "r", encoding="utf-8") as fh:
        loaded = json.load(fh)
    cases = loaded["cases"]
    fits = loaded.get("fits", [])
    have_spice = shutil.which("ngspice") is not None
    failures = 0
    lines = [
        "Smith Online oracle: %d cases from %s" % (len(cases), cases_path),
        "scikit-rf %s, numpy %s, ngspice %s"
        % (rf.__version__, np.__version__, "found" if have_spice else "NOT FOUND"),
        "tolerances: S relative %.0e (scikit-rf), Zin relative %.0e (ngspice)"
        % (S_TOLERANCE, SPICE_TOLERANCE),
        "",
    ]
    with tempfile.TemporaryDirectory() as workdir:
        for case in cases:
            name = case["name"]
            try:
                s_err, g_err = compare_s(case)
                tol = case_tolerance(case)
                ok = s_err <= tol and g_err <= tol
                failures += 0 if ok else 1
                lines.append(
                    "%s  scikit-rf  %-55s  S rel %.2e  Gamma_in %.2e  (tolerance %.0e)"
                    % (status(ok), name, s_err, g_err, tol)
                )
            except Exception as exc:  # report every case, then fail
                failures += 1
                lines.append("FAIL  scikit-rf  %-55s  error: %s" % (name, exc))
            spice = case.get("spice", {})
            if "netlist" not in spice:
                reason = spice.get("skip", "no netlist")
                lines.append("SKIP  ngspice    %-55s  %s" % (name, reason))
                continue
            if not have_spice:
                failures += 1
                lines.append("FAIL  ngspice    %-55s  ngspice is not installed" % name)
                continue
            try:
                z_err = compare_spice(spice, workdir)
                ok = z_err <= SPICE_TOLERANCE
                failures += 0 if ok else 1
                note = ("  (" + spice["note"] + ")") if spice.get("note") else ""
                lines.append(
                    "%s  ngspice    %-55s  Zin rel %.2e%s" % (status(ok), name, z_err, note)
                )
            except Exception as exc:
                failures += 1
                lines.append("FAIL  ngspice    %-55s  error: %s" % (name, exc))
    for fit in fits:
        name = fit["name"]
        try:
            for label, ok, detail in check_fit(fit):
                failures += 0 if ok else 1
                lines.append("%s  fit        %-55s  %-16s %s" % (status(ok), name, label, detail))
        except Exception as exc:
            failures += 1
            lines.append("FAIL  fit        %-55s  error: %s" % (name, exc))
    try:
        for group, name, label, ok, detail in check_d3(loaded.get("d3", {}), gamma_in):
            failures += 0 if ok else 1
            lines.append(
                "%s  %-10s %-55s  %-16s %s" % (status(ok), group, name, label, detail)
            )
    except Exception as exc:
        failures += 1
        lines.append("FAIL  d3         error: %s" % exc)
    lines.append("")
    lines.append("%d failure(s)" % failures if failures else "all comparisons passed")
    text = "\n".join(lines) + "\n"
    sys.stdout.write(text)
    if report_path:
        with open(report_path, "w", encoding="utf-8") as fh:
            fh.write(text)
    return 0 if failures == 0 else 1


def self_test():
    """Trivial cases with closed-form answers, so the CI log shows the harness works."""
    failures = 0
    freqs = [1e6, 2e6, 3e6]
    f = np.asarray(freqs)

    # 1. A 30 ohm series resistor between 50 ohm ports, through the full comparison.
    #    S11 = S22 = R / (R + 2 Z0), S21 = S12 = 2 Z0 / (R + 2 Z0); Zin with 50 ohm load is 80.
    s11 = 30.0 / 130.0
    s21 = 100.0 / 130.0
    case = {
        "name": "self-test series resistor",
        "z0": 50.0,
        "frequency": 2e6,
        "load": [50.0, 0.0],
        "elements": [{"kind": "R", "orientation": "series", "value": 30.0}],
        "frequencies": freqs,
        "s": [[[s11, 0.0], [s21, 0.0], [s21, 0.0], [s11, 0.0]] for _ in freqs],
        "zin": [[80.0, 0.0] for _ in freqs],
    }
    s_err, g_err = compare_s(case)
    ok = s_err <= S_TOLERANCE and g_err <= S_TOLERANCE
    failures += 0 if ok else 1
    print(
        "%s  scikit-rf %s: series resistor, S rel %.2e, Gamma_in %.2e"
        % (status(ok), rf.__version__, s_err, g_err)
    )

    # 2. A shunt 50 ohm resistor behind a matched quarter-wave line: |S11| = 1/3, |S21| = 2/3.
    shunt = dict(case)
    shunt["elements"] = [
        {"kind": "line", "z0": 50.0, "length": 0.25, "refFrequency": 2e6},
        {"kind": "R", "orientation": "shunt", "value": 50.0},
    ]
    s = ladder_network(shunt).s
    ok = bool(
        np.all(np.abs(np.abs(s[:, 0, 0]) - 1.0 / 3.0) < 1e-12)
        and np.all(np.abs(np.abs(s[:, 1, 0]) - 2.0 / 3.0) < 1e-12)
    )
    failures += 0 if ok else 1
    print(
        "%s  scikit-rf: shunt resistor behind a matched line, |S11| %s"
        % (status(ok), np.abs(s[:, 0, 0]))
    )

    # 3. An ideal transformer, n = 2: S11 = (n^2 - 1) / (n^2 + 1) = 0.6, S21 = 2 n / (n^2 + 1).
    s = transformer_network(frequency_of(f), 2.0, 50.0).s
    ok = bool(
        np.all(np.abs(s[:, 0, 0] - 0.6) < 1e-12)
        and np.all(np.abs(s[:, 1, 0] - 0.8) < 1e-12)
        and np.all(np.abs(s[:, 1, 1] + 0.6) < 1e-12)
    )
    failures += 0 if ok else 1
    print("%s  scikit-rf: ideal transformer n = 2, S11 %s, S21 %s, S22 %s" % (status(ok), s[0, 0, 0], s[0, 1, 0], s[0, 1, 1]))

    # 4. An eighth-wave open stub of 70 ohm: Zin = -j 70 cot(pi / 4) = -j70 ohm at 2 MHz.
    stub = {"kind": "openStub", "z0": 70.0, "length": 0.125, "refFrequency": 2e6}
    z = stub_impedance(frequency_of(f), f, stub)
    ok = bool(abs(z[1] - (-70j)) < 1e-9)
    failures += 0 if ok else 1
    print("%s  scikit-rf: open stub, Zin %s at 2 MHz (expected -70j)" % (status(ok), z[1]))

    # 5. A case's own tolerance: the series resistor with S rounded to 9 significant digits,
    #    as a Touchstone round trip carries it, passes at its tolerance of 1e-8.
    rounded = dict(case)
    r11 = [float("%.9g" % s11), 0.0]
    r21 = [float("%.9g" % s21), 0.0]
    rounded["s"] = [[r11, r21, r21, r11] for _ in freqs]
    rounded["tolerance"] = 1e-8
    s_err, g_err = compare_s(rounded)
    tol = case_tolerance(rounded)
    ok = tol == 1e-8 and case_tolerance(case) == S_TOLERANCE and s_err <= tol and g_err <= tol
    failures += 0 if ok else 1
    print(
        "%s  scikit-rf: 9-digit S at the case tolerance %.0e, S rel %.2e"
        % (status(ok), tol, s_err)
    )

    # 6. ngspice on the series resistor: Zin = 80 ohm.
    if shutil.which("ngspice") is None:
        print("FAIL  ngspice is not installed")
        return 1
    netlist = (
        "\n".join(
            [
                "* self-test: 30 ohm in series with a 50 ohm load",
                "VS src 0 AC 1",
                "RSRC src n1 50",
                "R1 n1 n0 30",
                "RLOAD n0 0 50",
                ".ac lin 3 1000000 3000000",
                ".end",
            ]
        )
        + "\n"
    )
    with tempfile.TemporaryDirectory() as workdir:
        freq, zin = run_ngspice(netlist, workdir)
    err = float(np.max(np.abs(zin - 80.0) / 80.0))
    ok = err <= SPICE_TOLERANCE and len(freq) == 3
    failures += 0 if ok else 1
    print("%s  ngspice: series resistor, Zin %s (expected 80), rel %.2e" % (status(ok), zin, err))

    # 7. The rational model evaluator: one real pole and a pair with d and e, against the sum
    #    written out by hand at one frequency.
    model = {
        "poles": [[-2.0e9, 0.0], [-1.0e8, 6.0e9], [-1.0e8, -6.0e9]],
        "residues": [[3.0e9, 0.0], [1.0e9, 2.0e8], [1.0e9, -2.0e8]],
        "d": 0.25,
        "e": 1e-11,
    }
    f1 = 0.8e9
    s1 = 2j * math.pi * f1
    want = 0.25 + s1 * 1e-11 + 3.0e9 / (s1 + 2.0e9)
    want += (1.0e9 + 2.0e8j) / (s1 - (-1.0e8 + 6.0e9j))
    want += (1.0e9 - 2.0e8j) / (s1 - (-1.0e8 - 6.0e9j))
    got = evaluate_model(model, [f1])[0]
    err = abs(got - want)
    ok = err <= 1e-13 * abs(want)
    failures += 0 if ok else 1
    print("%s  fit: rational model evaluator, error %.2e" % (status(ok), err))
    # 8. The truth of a fit case: a series 8 nH on 25 ohm, Gamma closed form.
    case = {
        "z0": 50.0,
        "termination": 25.0,
        "elements": [{"kind": "L", "orientation": "series", "value": 8e-9}],
    }
    g = true_gamma(case, [1e9])[0]
    zl = 25.0 + 2j * math.pi * 1e9 * 8e-9
    err = abs(g - (zl - 50.0) / (zl + 50.0))
    ok = err <= 1e-12
    failures += 0 if ok else 1
    print("%s  fit: true load from scikit-rf, error %.2e" % (status(ok), err))
    # 9. The passivity check: a model with |Gamma| = 1.2 everywhere fails it, one of 0.5 passes.
    active = passivity_peak({"poles": [], "residues": [], "d": 1.2, "e": 0.0}, 1e9, 2e9)
    passive = passivity_peak({"poles": [], "residues": [], "d": 0.5, "e": 0.0}, 1e9, 2e9)
    ok = active > 1.0 + FIT_PASSIVITY_SLACK and passive <= 1.0 + FIT_PASSIVITY_SLACK
    failures += 0 if ok else 1
    print("%s  fit: passivity check, active %.3f, passive %.3f" % (status(ok), active, passive))
    # 10. The derivative check on a series R before a 50 ohm load: Gamma = R / (R + 100), so
    #     dGamma/dR = 100 / (R + 100)^2, given as the "app's" value; a wrong one must fail.
    r = 30.0
    exact = 100.0 / (r + 100.0) ** 2
    sens = {
        "name": "self-test series R",
        "z0": 50.0,
        "load": [50.0, 0.0],
        "elements": [{"kind": "R", "orientation": "series", "value": r}],
        "frequencies": [1e6, 2e6],
        "parameters": [{"index": 0, "parameter": "value", "value": r}],
        "dGamma": [[[exact, 0.0]], [[exact, 0.0]]],
    }
    good = all(ok for _, ok, _ in check_sensitivity(sens, gamma_in))
    sens["dGamma"] = [[[exact * 1.001, 0.0]], [[exact * 1.001, 0.0]]]
    bad = all(ok for _, ok, _ in check_sensitivity(sens, gamma_in))
    ok = good and not bad
    failures += 0 if ok else 1
    print("%s  d3: derivative check, exact passes %s, 0.1 %% off fails %s" % (status(ok), good, not bad))
    print("self-test passed" if failures == 0 else "self-test: %d failure(s)" % failures)
    return 0 if failures == 0 else 1


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "cases", nargs="?", default="oracle-cases.json", help="cases written by export.mjs"
    )
    parser.add_argument(
        "--report", default="oracle-report.txt", help="where to write the comparison report"
    )
    parser.add_argument(
        "--self-test", action="store_true", help="check the harness on closed-form cases"
    )
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    return check(args.cases, args.report)


if __name__ == "__main__":
    sys.exit(main())
