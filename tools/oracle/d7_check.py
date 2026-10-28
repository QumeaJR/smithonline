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
  ladder's lowest gain not below the synthesized one's when the synthesized parts lie in
  the part window, and every final part inside the window (reactance Z0 / 25 to 10 Z0 at
  band centre, worked out here from the values).
- Quality, not only consistency: Fano's RC load (decrement 0.5) with the generator
  resistance free at 1 to 8 parts. The Chebyshev optimum of Matthaei, Young and Jones
  (1963, DTIC AD 402852, Sec. 4.10, Eqs. 4.10-3, 4.10-4 and 4.10-17, solved here by
  bisection) for n = parts + 1 reactive elements: the synthesized ladder's lowest gain must reach
  it (within 1e-3) and stay under Bode's limit 1 - exp(-2 pi delta); along the series the
  lowest gain must never fall as parts are added. A result with no optimization fails here.
- Quality on the path the app runs (QA round 2: the Fano cases use a transformer and no
  polish, which the app never does): the lesson antenna and the sample antenna, no
  transformer, every number of zeros at DC, polished, 1 to 6 parts from one run. Each ladder
  is rebuilt in scikit-rf on the load (the sample antenna's load as the app's fitted model
  sampled on the grid), its worst VSWR recomputed and held to the docs/08 table, no worse
  than 0.2 %. A run with the optimization switched off on this path fails here.

Independent of the app: numpy's polynomial roots, scikit-rf's cascade and S-parameters,
the Chebyshev optimum and Bode's limit. Shared: the Belevitch gain formula (textbook) and
the element values themselves.
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
        if c.get("appPath"):
            continue
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
        window = c.get("window")
        outside = [] if window is None else outside_window(c["synthesized"], window)
        if not outside:
            yield (
                "rft",
                name,
                "polish no worse",
                lo_fin >= lo_syn - 1e-12,
                "min gain %.6f against %.6f" % (lo_fin, lo_syn),
            )
        if window is not None:
            bad = outside_window(c["elements"], window)
            yield (
                "rft",
                name,
                "parts in window",
                not bad,
                "; ".join(bad) or "%d parts within %.3g to %.3g ohm at %.6g Hz%s"
                % (
                    len(c["elements"]),
                    window["xLo"],
                    window["xHi"],
                    window["f0"],
                    ", %d synthesized outside" % len(outside) if outside else "",
                ),
            )
        if "bode" in c:
            yield (
                "rft",
                name,
                "below Bode",
                c["minGain"] < c["bode"],
                "min gain %.6f, Bode %.6f" % (c["minGain"], c["bode"]),
            )
    yield from check_fano(cases, ladder_network)
    yield from check_app_path(cases, ladder_network)


def outside_window(elements, window):
    """The L and C parts whose reactance at the window's f0 lies outside xLo to xHi (the search's
    part window, Z0 / 25 to 10 Z0 at band centre), worked out here from the values."""
    w = 2 * np.pi * window["f0"]
    out = []
    for e in elements:
        if e["kind"] == "L":
            x = w * e["value"]
        elif e["kind"] == "C":
            x = 1.0 / (w * e["value"])
        else:
            continue
        if x < window["xLo"] * (1 - 1e-9) or x > window["xHi"] * (1 + 1e-9):
            out.append("%s %s %.4g ohm" % (e["orientation"], e["kind"], x))
    return out


def fano_optimum(n, delta):
    """Lowest-loss Chebyshev match of Matthaei, Young and Jones Sec. 4.10.

    n reactive elements (the load's one included), decrement delta = 1 / (w1 R C).
    Eq. (4.10-3): e = d - 2 delta sin(pi / 2n); Eq. (4.10-4): |Gamma|max =
    cosh(n asinh e) / cosh(n asinh d); Eq. (4.10-17), after Fano: the best d = sinh a
    solves tanh(n a) / cosh(a) = tanh(n b) / cosh(b), e = sinh b. Solved here by
    bisection; returns the transducer gain 1 - |Gamma|max^2 at that optimum.
    """
    c = 2.0 * delta * np.sin(np.pi / (2.0 * n))

    def b_of(a):
        return np.arcsinh(np.sinh(a) - c)

    def f(a):
        b = b_of(a)
        return np.tanh(n * a) / np.cosh(a) - np.tanh(n * b) / np.cosh(b)

    lo, hi = float(np.arcsinh(c)), 10.0
    for _ in range(200):
        mid = 0.5 * (lo + hi)
        if f(mid) > 0:
            lo = mid
        else:
            hi = mid
    a = 0.5 * (lo + hi)
    gamma = np.cosh(n * b_of(a)) / np.cosh(n * a)
    return 1.0 - gamma**2


def bode_limit(delta):
    """Bode's limit on the lowest gain over a lowpass band for an RC load: 1 - exp(-2 pi delta)."""
    return 1.0 - np.exp(-2.0 * np.pi * delta)


# The result may fall short of the Chebyshev optimum by this much in gain: the band starts at
# 1 MHz rather than DC (easier), the grid is discrete, and the optimizer's own convergence.
FANO_SLACK = 1e-3


def check_fano(cases, ladder_network):
    """The quality checks: per Fano case, the synthesized ladder (rebuilt in scikit-rf) reaches the
    Chebyshev optimum and stays under Bode's limit; along a series, more parts never lose."""
    series = {}
    for c in cases or []:
        fano = c.get("fano")
        if not fano:
            continue
        fs = np.asarray(c["frequencies"], dtype=float)
        zl = load_impedance(c["load"], fs)
        # The ladder synthesized from the gain shape: the technique itself, before the part
        # window and the polish (the case runs with a transformer and no polish).
        syn = ladder_gain(ladder_network, c["z0"], c["synthesized"], fs, zl)
        low = float(np.min(syn))
        cheb = float(fano_optimum(fano["n"], fano["delta"]))
        bode = float(bode_limit(fano["delta"]))
        yield (
            "rft",
            c["name"],
            "reaches Chebyshev",
            low >= cheb - FANO_SLACK,
            "min gain %.6f, Chebyshev optimum %.6f (n %d)" % (low, cheb, fano["n"]),
        )
        yield (
            "rft",
            c["name"],
            "under Bode",
            low <= bode + 1e-12,
            "min gain %.6f, Bode %.6f" % (low, bode),
        )
        series.setdefault(fano["series"], []).append((fano["n"], low))
    for name, points in series.items():
        points.sort()
        worse = [
            "%d after %d parts: %.6f < %.6f" % (n2 - 1, n1 - 1, g2, g1)
            for (n1, g1), (n2, g2) in zip(points, points[1:])
            if g2 < g1 - 1e-9
        ]
        yield (
            "rft",
            name,
            "more parts never worse",
            not worse,
            "; ".join(worse) or "%d degrees, min gain %.6f to %.6f" % (len(points), points[0][1], points[-1][1]),
        )


# The docs/08 table (D7, "More parts on the same band", the technique on its own with 33 band
# points): worst VSWR at 1 to 6 parts on the path the app runs (no transformer, every number of
# zeros at DC, polished inside the part window). A result worse than these by more than
# APP_PATH_TOLERANCE fails: the optimization or the polish has lost ground.
APP_PATH_REFERENCE = {
    "lesson antenna": [3.5414, 3.1643, 2.2086, 2.1898, 1.8109, 1.7841],
    "sample antenna": [2.5812, 2.0000, 1.5244, 1.4933, 1.3506, 1.3277],
}
APP_PATH_TOLERANCE = 2e-3


def check_app_path(cases, ladder_network):
    """Quality on the app's path: each size's ladder rebuilt in scikit-rf on the load, its worst
    VSWR recomputed here against the app's (1e-9) and against the docs/08 table (no worse than
    APP_PATH_TOLERANCE, relative)."""
    for c in cases or []:
        if not c.get("appPath"):
            continue
        name = c["name"]
        z0 = c["z0"]
        fs = np.asarray(c["frequencies"], dtype=float)
        if "loadSamples" in c:
            zl = np.array([complex(re, im) for re, im in c["loadSamples"]])
        else:
            zl = load_impedance(c["load"], fs)
        reference = APP_PATH_REFERENCE[c["series"]]
        for size in c["sizes"]:
            n = size["parts"]
            gain = ladder_gain(ladder_network, z0, size["elements"], fs, zl)
            gamma = np.sqrt(np.clip(1 - gain, 0, 1))
            vswr = float(np.max((1 + gamma) / (1 - gamma)))
            err = abs(vswr - size["worstVswr"]) / vswr
            yield (
                "rft",
                name,
                "%d parts worst VSWR" % n,
                err <= 1e-9,
                "scikit-rf %.6f, app %.6f" % (vswr, size["worstVswr"]),
            )
            if n <= len(reference):
                ref = reference[n - 1]
                yield (
                    "rft",
                    name,
                    "%d parts against docs/08" % n,
                    vswr <= ref * (1 + APP_PATH_TOLERANCE),
                    "worst VSWR %.4f, table %.4f (%s, %d parts built)"
                    % (vswr, ref, size["source"], len(size["elements"])),
                )
