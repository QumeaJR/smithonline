"""Phase D5 checks of the oracle: real parts from their S-parameter files.

The app reads a part's two-port Touchstone file, decides the fixture it was
measured in (series-through: the part between the ports; shunt-through: the
part from the line to ground) and places the part in series or in shunt. A
series part from a series-through file is the measured two-port itself (S12
and S21 averaged); every other placement uses the part impedance derived from
the chain matrix: Z = B for a series-through file, Z = 1 / C for a
shunt-through file, as a series impedance or as a shunt branch with the via in
series. Between the file's frequencies the S-parameters are interpolated
linearly in their real and imaginary parts; outside them the part has no value.

Here the same files (the synthetic examples in packages/core/test/fixtures/parts,
made from equivalent circuits; no manufacturer data is in the repository) are
read with scikit-rf's own Touchstone reader, interpolated with
Network.interpolate (linear, cartesian), turned into chain matrices with
scikit-rf's s2a, and every cascade is rebuilt from scikit-rf networks
(media.resistor and media.shunt for the derived impedances, the measured
network for a series part from a series-through file) and cascaded with **.

Independent: the Touchstone reading, the interpolation, the S to ABCD
conversion, the cascading and the terminated input impedance. Shared with the
app: the choice of what to use for each placement (the full two-port or the
derived impedance) and the averaging of S12 and S21.

Also checked: the nominal value (the effective value at the lowest frequency)
from scikit-rf's chain matrix, the self-resonance found by bisection on a
numpy interpolation of the file's S-parameters (not the app's code), the
app's self-resonance against the generating circuit's (5e-4, the
interpolation error of 201 points over three decades), and that the app gives
no value outside a file's frequencies.
"""

import os

import numpy as np
import skrf as rf
from skrf.network import s2a
from skrf.media import DefinedGammaZ0

D5_TOLERANCE = 1e-9
ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))

_files = {}


def part_network(path):
    """The part file as scikit-rf reads it."""
    if path not in _files:
        _files[path] = rf.Network(os.path.join(ROOT, path))
    return _files[path]


def averaged(ntwk):
    """The network with S12 and S21 replaced by their mean (a passive part is reciprocal)."""
    s = ntwk.s.copy()
    m = (s[:, 0, 1] + s[:, 1, 0]) / 2.0
    s[:, 0, 1] = m
    s[:, 1, 0] = m
    return rf.Network(frequency=ntwk.frequency, s=s, z0=ntwk.z0)


def at(ntwk, f):
    """The network interpolated to the frequencies f, linearly in real and imaginary parts."""
    freq = rf.Frequency.from_f(np.asarray(f, dtype=float), unit="hz")
    return ntwk.interpolate(freq, kind="linear", coords="cart")


def part_impedance(ntwk, fixture):
    """Z of the part from the chain matrix of its fixture: B in series, 1 / C to ground."""
    a = s2a(ntwk.s, ntwk.z0[0, 0])
    return a[:, 0, 1] if fixture == "series" else 1.0 / a[:, 1, 0]


def element_network(el, fixture_of, f, z0):
    path = fixture_of[el["file"]]["path"]
    fixture = fixture_of[el["file"]]["fixture"]
    freq = rf.Frequency.from_f(np.asarray(f, dtype=float), unit="hz")
    ntwk = averaged(at(part_network(path), f))
    media = DefinedGammaZ0(frequency=freq, z0=z0, gamma=1j)
    if el["orientation"] == "series" and fixture == "series":
        out = rf.Network(frequency=freq, s=ntwk.s, z0=ntwk.z0)
        out.renormalize(z0)
        return out
    z = part_impedance(ntwk, fixture)
    if el["orientation"] == "series":
        return media.resistor(z)
    w = 2.0 * np.pi * np.asarray(f, dtype=float)
    zt = z + 1j * w * el.get("via", 0.0)
    return media.shunt(media.resistor(zt) ** media.short())


def cascade_network(case, fixture_of):
    net = None
    for el in reversed(case["elements"]):
        part = element_network(el, fixture_of, case["frequencies"], case["z0"])
        net = part if net is None else net ** part
    return net


def check_cascade(case, fixture_of):
    ref = cascade_network(case, fixture_of).s
    got = np.array(
        [[[complex(*a), complex(*b)], [complex(*c), complex(*d)]] for a, b, c, d in case["s"]]
    )
    worst = 0.0
    for k in range(ref.shape[0]):
        scale = max(np.max(np.abs(ref[k])), 1e-300)
        worst = max(worst, float(np.max(np.abs(got[k] - ref[k]))) / scale)
    z0 = case["z0"]
    zl = complex(*case["load"])
    gl = (zl - z0) / (zl + z0)
    gin = ref[:, 0, 0] + ref[:, 0, 1] * ref[:, 1, 0] * gl / (1.0 - ref[:, 1, 1] * gl)
    zapp = np.array([complex(*z) for z in case["zin"]])
    gapp = (zapp - z0) / (zapp + z0)
    return worst, float(np.max(np.abs(gapp - gin)))


def interpolated_impedance(ntwk, fixture, f):
    """Z at one frequency from a numpy interpolation of the file's S (independent of scikit-rf's)."""
    fs = ntwk.f
    s = ntwk.s
    row = []
    for i, j in ((0, 0), (0, 1), (1, 0), (1, 1)):
        row.append(np.interp(f, fs, s[:, i, j].real) + 1j * np.interp(f, fs, s[:, i, j].imag))
    s11, s12, s21, s22 = row
    m = (s12 + s21) / 2.0
    z0 = ntwk.z0[0, 0].real
    if fixture == "series":
        return z0 * ((1 + s11) * (1 + s22) - m * m) / (2 * m)
    return 1.0 / (((1 - s11) * (1 - s22) - m * m) / (2 * m * z0))


def bisect_srf(ntwk, fixture, kind):
    """The first sign change of the reactance (C: to positive, L: to negative), by bisection."""
    wrong = (lambda x: x > 0) if kind == "C" else (lambda x: x < 0)
    z = part_impedance(averaged(ntwk), fixture)
    fs = ntwk.f
    for k in range(1, len(fs)):
        if wrong(z[k].imag) and not wrong(z[k - 1].imag):
            lo, hi = fs[k - 1], fs[k]
            for _ in range(200):
                if hi - lo <= lo * 1e-13:
                    break
                mid = (lo + hi) / 2
                if wrong(interpolated_impedance(ntwk, fixture, mid).imag):
                    hi = mid
                else:
                    lo = mid
            return (lo + hi) / 2
    return None


def check_d5(d5):
    """Yields (group, name, label, ok, detail) for every D5 comparison."""
    files = d5.get("files", [])
    fixture_of = {f["name"]: f for f in files}
    for f in files:
        ntwk = part_network(f["path"])
        z = part_impedance(averaged(ntwk), f["fixture"])
        w0 = 2 * np.pi * ntwk.f[0]
        nominal = -1.0 / (w0 * z[0].imag) if f["type"] == "C" else z[0].imag / w0
        err = abs(f["nominal"] - nominal) / abs(nominal)
        yield ("part", f["name"], "nominal", err <= D5_TOLERANCE, "rel %.2e" % err)
        srf = bisect_srf(ntwk, f["fixture"], f["type"])
        if srf is None or f["srf"] is None:
            ok = srf is None and f["srf"] is None
            yield ("part", f["name"], "SRF", ok, "none in the data" if ok else "mismatch")
        else:
            err = abs(f["srf"] - srf) / srf
            yield ("part", f["name"], "SRF", err <= 1e-9, "%.6g GHz, rel %.2e" % (srf / 1e9, err))
            err_c = abs(f["srf"] - f["circuitSrf"]) / f["circuitSrf"]
            yield ("part", f["name"], "SRF vs circuit", err_c <= 5e-4, "rel %.2e" % err_c)
    for case in d5.get("cascades", []):
        s_err, g_err = check_cascade(case, fixture_of)
        ok = s_err <= D5_TOLERANCE and g_err <= D5_TOLERANCE
        yield (
            "parts",
            case["name"],
            "S and Gamma_in",
            ok,
            "S rel %.2e  Gamma_in %.2e" % (s_err, g_err),
        )
    for r in d5.get("refusals", []):
        ntwk = part_network(fixture_of[r["file"]]["path"])
        outside = r["frequency"] < ntwk.f[0] or r["frequency"] > ntwk.f[-1]
        yield ("parts", r["name"], "no value", outside and r["zinIsNaN"], "outside the file: %s" % outside)
