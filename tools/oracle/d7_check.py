"""Phase D7 checks of the oracle: broadband matching by the real frequency technique.

For each exported result (export.mjs, d7Cases):

- The load is rebuilt from its element values with numpy (series RL, parallel RC).
- Hurwitz factor: g(p) is recomputed from the app's h(p) and k with numpy alone: the
  roots of h(p) h(-p) + (-1)^k p^(2k) by numpy.roots on the full polynomial in p (the
  app works on half the degree in p^2 with its own root finder), the left half plane
  ones kept, scaled by the leading coefficient. Compared with the app's g (1e-8 relative).
- Gain shape: the transducer gain of the Belevitch form, |S21|^2 (1 - |Gamma_L|^2) /
  |1 - S22 Gamma_L|^2 with S22 = -(-1)^k h(-jw) / g(jw), from numpy's g, against the
  app's gain shape (1e-9).
- Ladders: the synthesized and the final ladder rebuilt in scikit-rf (check.py's
  ladder_network, the transformer included), the input reflection with the load from
  scikit-rf's S-parameters, the transducer gain 1 - |Gamma_in|^2 against the app's
  (1e-9); the synthesized ladder against the gain shape (1e-6: what the continued
  fraction and, for a bandpass ladder, the termination penalty may lose); the final
  ladder's lowest gain not below the synthesized one's.
- Fano's RC load over a lowpass band: the lowest gain below Bode's limit
  1 - exp(-2 pi / (omega_c R C)).

Independent of the app: numpy's polynomial roots, scikit-rf's cascade and S-parameters.
Shared: the Belevitch gain formula (textbook) and the element values themselves.
"""

import numpy as np

D7_TOLERANCE = 1e-9
SYNTHESIS_TOLERANCE = 1e-6


def load_impedance(load, f):
    w = 2 * np.pi * np.asarray(f, dtype=float)
    if load["kind"] == "seriesRL":
        return load["r"] + 1j * w * load["l"]
    if load["kind"] == "parallelRC":
        return 1.0 / (1.0 / load["r"] + 1j * w * load["c"])
    raise ValueError("unknown load kind %s" % load["kind"])


def hurwitz(h, k):
    """g(p) (ascending) with g(p) g(-p) = h(p) h(-p) + (-1)^k p^(2k), roots in the left half plane."""
    h = np.asarray(h, dtype=float)
    hm = h * np.array([(-1) ** i for i in range(len(h))])
    big = np.polynomial.polynomial.polymul(h, hm)
    ff = np.zeros(2 * k + 1)
    ff[2 * k] = (-1) ** k
    big = np.polynomial.polynomial.polyadd(big, ff)
    while len(big) > 1 and abs(big[-1]) == 0:
        big = big[:-1]
    roots = np.roots(big[::-1])
    left = roots[roots.real < 0]
    m = len(left)
    lead = np.sqrt(abs(big[-1]))
    g = np.real(np.poly(left))[::-1] * lead
    return g, m


def shape_gain(h, g, k, w, zl):
    p = 1j * np.asarray(w, dtype=float)
    hp = np.polynomial.polynomial.polyval(p, h)
    hm = np.polynomial.polynomial.polyval(-p, h)
    gp = np.polynomial.polynomial.polyval(p, g)
    s22 = -((-1) ** k) * hm / gp
    s21sq = np.abs(np.asarray(w, dtype=float) ** (2 * k)) / np.abs(gp) ** 2
    gl = (zl - 1) / (zl + 1)
    return s21sq * (1 - np.abs(gl) ** 2) / np.abs(1 - s22 * gl) ** 2


def ladder_gain(ladder_network, z0, elements, freqs, zl):
    s = ladder_network({"frequencies": list(freqs), "z0": z0, "elements": elements}).s
    gl = (zl - z0) / (zl + z0)
    gin = s[:, 0, 0] + s[:, 0, 1] * s[:, 1, 0] * gl / (1.0 - s[:, 1, 1] * gl)
    return 1 - np.abs(gin) ** 2


def check_d7(cases, ladder_network):
    """Yields (group, name, label, ok, detail) for every D7 comparison."""
    for c in cases or []:
        name = c["name"]
        z0 = c["z0"]
        fs = np.asarray(c["frequencies"], dtype=float)
        zl = load_impedance(c["load"], fs)
        b = c["belevitch"]
        h = np.asarray(b["h"], dtype=float)
        k = int(b["k"])
        g, m = hurwitz(h, k)
        app_g = np.asarray(b["g"], dtype=float)
        if m != len(app_g) - 1:
            yield ("rft", name, "Hurwitz g", False, "degree %d against %d" % (m, len(app_g) - 1))
            continue
        err = float(np.max(np.abs(g - app_g)) / np.max(np.abs(app_g)))
        yield ("rft", name, "Hurwitz g", err <= 1e-8, "rel %.2e" % err)
        w = 2 * np.pi * fs / c["omega"]
        shape = shape_gain(h, g, k, w, zl / z0)
        err = float(np.max(np.abs(shape - np.asarray(c["shapeGain"]))))
        yield ("rft", name, "gain shape", err <= D7_TOLERANCE, "abs %.2e" % err)
        syn = ladder_gain(ladder_network, z0, c["synthesized"], fs, zl)
        err = float(np.max(np.abs(syn - np.asarray(c["synthesizedGain"]))))
        yield ("rft", name, "synthesized", err <= D7_TOLERANCE, "abs %.2e" % err)
        err = float(np.max(np.abs(syn - shape)))
        yield (
            "rft",
            name,
            "ladder = shape",
            err <= SYNTHESIS_TOLERANCE,
            "abs %.2e, termination %.9f" % (err, c["termination"]),
        )
        fin = ladder_gain(ladder_network, z0, c["elements"], fs, zl)
        err = float(np.max(np.abs(fin - np.asarray(c["elementsGain"]))))
        yield ("rft", name, "final ladder", err <= D7_TOLERANCE, "abs %.2e" % err)
        lo_fin = float(np.min(fin))
        lo_syn = float(np.min(syn))
        yield (
            "rft",
            name,
            "polish no worse",
            lo_fin >= lo_syn - 1e-12,
            "min gain %.6f against %.6f" % (lo_fin, lo_syn),
        )
        if "bode" in c:
            yield (
                "rft",
                name,
                "below Bode",
                c["minGain"] < c["bode"],
                "min gain %.6f, Bode %.6f" % (c["minGain"], c["bode"]),
            )
