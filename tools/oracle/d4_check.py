"""Phase D4 checks of the oracle: the board in the network.

- Microstrip: the app's Z0, effective permittivity, conductor and dielectric
  loss and phase constant of a set of microstrips over frequency against
  scikit-rf's own MLine with the same model choices: model='hammerstadjensen'
  (static Z0 and eeff with the strip thickness correction), disp='kirschningjansen'
  (dispersion of eeff, and of Z0 by Jansen and Kirschning), diel='djordjevicsvensson'
  (the wideband Debye permittivity, f_low 1 kHz, f_high 1 THz, er and tanD given
  at f_epr_tand), conductor loss with the Hammerstad-Jensen roughness factor, no
  compatibility mode (scikit-rf's ADS-like default: the complex permittivity is
  carried through, so Z0 is complex). Independent: scikit-rf's implementation of
  every formula. Shared: the choice of models and the constants of the papers.
- The ladders with microstrip elements and board parasitics are rebuilt in
  check.py from scikit-rf networks: MLine line sections for the elements and the
  traces between parts, the via as an inductance in series with a shunt branch.
- Via inductance: the Goldfarb-Pucel formula recomputed with numpy (shared
  formula, independent arithmetic).
- Land (pad) capacitance: C'(W) L + C'(L) W - eps0 er W L / h (parallel plate
  plus the fringing at the four edges), with C'(x) = sqrt(eeff) / (c Z0) from
  scikit-rf's static Hammerstad-Jensen solution (MLine at 1 Hz, no loss); for
  a land whose equal-area side sqrt(L W) is below h, the larger of that and
  the isolated-disc estimate with the ground image (computed here with numpy).
  Independent: the microstrip solution; shared: the way the land is composed.

line.ts is a port of scikit-rf's MLine, so agreement here shows that the port
is faithful, not that the model is right; the check independent of scikit-rf's
code is Keysight ADS's MLIN data in packages/core/test/qa-d4-ads.test.ts.
"""

import math
import warnings

import numpy as np
import skrf as rf
from skrf import constants as rfc
from skrf.media import MLine

D4_TOLERANCE = 1e-9
COPPER_RESISTIVITY = 1.7241e-8


def microstrip_media(freq, trace, z0):
    """scikit-rf's MLine for a trace (width, stackup) with the app's model choices."""
    s = trace["stackup"]
    with warnings.catch_warnings():
        # MLine warns when the copper is thinner than three skin depths (low frequencies).
        warnings.simplefilter("ignore")
        return MLine(
            frequency=freq,
            z0_port=z0,
            w=trace["width"],
            h=s["h"],
            t=s["t"],
            ep_r=s["er"],
            tand=s["tanD"],
            f_epr_tand=s["fRef"],
            rough=s["roughness"],
            rho=s.get("rho", COPPER_RESISTIVITY),
            model="hammerstadjensen",
            disp="kirschningjansen",
            diel="djordjevicsvensson",
        )


def rel(a, b):
    a = np.asarray(a)
    b = np.asarray(b)
    scale = np.maximum(np.abs(b), 1e-300)
    return float(np.max(np.abs(a - b) / scale))


def cpairs(rows):
    return np.array([complex(r[0], r[1]) for r in rows])


def via_inductance(h, drill):
    """Goldfarb and Pucel, IEEE MGWL 1 (6), 1991."""
    r = drill / 2.0
    s = math.sqrt(r * r + h * h)
    return rfc.mu_0 / (2.0 * math.pi) * (h * math.log((h + s) / r) + 1.5 * (r - s))


def capacitance_per_metre(stackup, width):
    """sqrt(eeff) / (c Z0) of scikit-rf's static microstrip (1 Hz, lossless dielectric)."""
    freq = rf.Frequency.from_f([1.0], unit="hz")
    lossless = dict(stackup, tanD=0.0)
    m = microstrip_media(freq, {"width": width, "stackup": lossless}, 50.0)
    z0 = float(np.real(m.z0_characteristic[0]))
    eeff = float(np.real(m.ep_reff_f[0]))
    return math.sqrt(eeff) / (rfc.c * z0)


def disc_land_capacitance(stackup, length, width):
    """A thin disc of the land's area at the air-dielectric interface with its ground image."""
    ea = rfc.epsilon_0 * (stackup["er"] + 1) / 2
    c0 = 8 * ea * math.sqrt(length * width / math.pi)
    den = 1 - c0 / (4 * math.pi * ea * 2 * stackup["h"])
    return c0 / den if den > 0 else 0.0


def land_capacitance(stackup, length, width):
    plate = rfc.epsilon_0 * stackup["er"] * width * length / stackup["h"]
    edge = (
        capacitance_per_metre(stackup, width) * length
        + capacitance_per_metre(stackup, length) * width
        - plate
    )
    if math.sqrt(length * width) < stackup["h"]:
        return max(edge, disc_land_capacitance(stackup, length, width))
    return edge


def check_d4(d4):
    """Yields (group, name, label, ok, detail) for every D4 comparison."""
    for ms in d4.get("microstrips", []):
        name = ms["name"]
        freq = rf.Frequency.from_f(np.asarray(ms["frequencies"], dtype=float), unit="hz")
        m = microstrip_media(freq, ms, 50.0)
        checks = [
            ("Z0", rel(cpairs(ms["z0"]), m.z0_characteristic)),
            ("eeff", rel(cpairs(ms["eeff"]), m.ep_reff_f)),
            ("alpha_c", rel(ms["alphaC"], m.alpha_conductor) if any(ms["alphaC"]) else 0.0),
            ("alpha_d", rel(ms["alphaD"], m.alpha_dielectric) if any(ms["alphaD"]) else 0.0),
            ("beta", rel(ms["beta"], np.imag(m.gamma))),
        ]
        # A zero loss in the app must be zero in scikit-rf too.
        if not any(ms["alphaC"]):
            checks.append(("alpha_c zero", float(np.max(np.abs(m.alpha_conductor)))))
        if not any(ms["alphaD"]):
            checks.append(("alpha_d zero", float(np.max(np.abs(m.alpha_dielectric)))))
        for label, err in checks:
            yield ("microstrip", name, label, err <= D4_TOLERANCE, "rel %.2e" % err)
    for v in d4.get("vias", []):
        ref = via_inductance(v["h"], v["drill"])
        err = abs(v["L"] - ref) / ref
        yield (
            "via",
            "h %.3g mm, drill %.3g mm" % (v["h"] * 1e3, v["drill"] * 1e3),
            "Goldfarb-Pucel",
            err <= 1e-12,
            "%.4g nH, rel %.2e" % (v["L"] * 1e9, err),
        )
    for land in d4.get("lands", []):
        ref = land_capacitance(land["stackup"], land["length"], land["width"])
        err = abs(land["C"] - ref) / ref
        yield (
            "land",
            land["name"],
            "capacitance",
            err <= D4_TOLERANCE,
            "%.4g fF, rel %.2e" % (land["C"] * 1e15, err),
        )
