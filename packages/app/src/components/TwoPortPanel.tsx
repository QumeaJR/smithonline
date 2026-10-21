import {
  cabs,
  cargDeg,
  conjugateMatch,
  gmaxDb,
  linearToDb,
  loadStabilityCircle,
  mag,
  msg,
  polarDeg,
  sourceStabilityCircle,
  stability,
  unilateralGain,
  type Complex,
  type NoiseParameters,
  type SParameters,
} from '@smithonline/core';
import { useState } from 'react';
import { GAIN_TYPE_LABELS } from '../lib/circles';
import type { GainCircleType } from '../lib/design';
import { fmtDeg, fmtFrequency, fmtNum } from '../lib/format';
import { useDesignStore } from '../store/useDesignStore';
import { NumberList } from './NumberList';
import { ValueInput } from './ValueInput';

const DEFAULT_S: SParameters = {
  s11: polarDeg(0.5, -120),
  s12: polarDeg(0.05, 50),
  s21: polarDeg(3, 80),
  s22: polarDeg(0.4, -40),
};

const DEFAULT_NOISE: NoiseParameters = { nfMinDb: 1, gammaOpt: polarDeg(0.4, 60), rn: 0.3 };

/** Device parameters, their derived figures, and the stability, gain and noise circle lists. */
export function TwoPortPanel() {
  const design = useDesignStore((s) => s.design);
  const twoPortFile = useDesignStore((s) => s.twoPortFile);
  const { setTwoPort, setShowStability, setGainCircles, setNoiseCircles } =
    useDesignStore.getState();
  const [gainType, setGainType] = useState<GainCircleType>('available');
  const tp = design.twoPort;

  if (!tp) {
    return (
      <p className="muted small">
        Enter the S-parameters of a device (or open an example such as Example 13) to draw
        stability, gain and noise circles.{' '}
        <button className="btn tiny" onClick={() => setTwoPort({ s: DEFAULT_S, noise: null })}>
          Enter S-parameters
        </button>
      </p>
    );
  }

  const st = stability(tp.s);
  const u = unilateralGain(tp.s);
  const match = conjugateMatch(tp.s);
  const gmax = gmaxDb(tp.s);
  const setS = (key: keyof SParameters, value: Complex): void =>
    setTwoPort({ ...tp, s: { ...tp.s, [key]: value } });
  const setNoise = (noise: NoiseParameters | null): void => setTwoPort({ ...tp, noise });

  return (
    <>
      {tp.source && (
        <p className="muted small">
          From <strong>{tp.source.fileName}</strong> at {fmtFrequency(tp.source.frequency)}
          {tp.source.clamped
            ? `, outside the file's ${fmtFrequency(tp.source.covers[0])} to ${fmtFrequency(tp.source.covers[1])}: nearest end used`
            : ` (interpolated; file covers ${fmtFrequency(tp.source.covers[0])} to ${fmtFrequency(tp.source.covers[1])})`}
          .{' '}
          {twoPortFile && twoPortFile.fileName === tp.source.fileName
            ? 'The device follows the design frequency; editing a value below detaches the file.'
            : 'The file is not loaded in this session: open it again to make the device follow the design frequency.'}
        </p>
      )}
      <table className="sparams">
        <thead>
          <tr>
            <th></th>
            <th>mag</th>
            <th>angle</th>
          </tr>
        </thead>
        <tbody>
          {(['s11', 's21', 's12', 's22'] as const).map((key) => (
            <tr key={key}>
              <td>{key.toUpperCase()}</td>
              <td>
                <ValueInput
                  value={cabs(tp.s[key])}
                  plain
                  digits={5}
                  min={0}
                  ariaLabel={`${key} magnitude`}
                  onCommit={(m) => setS(key, polarDeg(m, cargDeg(tp.s[key])))}
                />
              </td>
              <td>
                <ValueInput
                  value={cargDeg(tp.s[key])}
                  plain
                  ariaLabel={`${key} angle`}
                  onCommit={(a) => setS(key, polarDeg(cabs(tp.s[key]), a))}
                />
                &#176;
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mono small readout">
        K {fmtNum(st.k, 4)} &nbsp; |&#916;| {fmtNum(st.deltaMag, 4)} &nbsp; &#956;{' '}
        {fmtNum(st.mu, 3)} &nbsp; &#956;&#8242; {fmtNum(st.muPrime, 3)}
        <br />
        {st.k >= 1 ? 'MAG' : 'MSG'} {fmtNum(gmax, 3)} dB
        {st.k >= 1 && <> &nbsp; MSG {fmtNum(linearToDb(msg(tp.s)), 3)} dB</>}
        {Number.isNaN(mag(tp.s)) ? ' (potentially unstable)' : ''} &nbsp; U {fmtNum(u.u, 3)}
        {match && (
          <>
            <br />
            &#915;ms {fmtNum(cabs(match.gammaSource), 4)} &#8736;{' '}
            {fmtDeg(cargDeg(match.gammaSource))} &nbsp; &#915;ml {fmtNum(cabs(match.gammaLoad), 4)}{' '}
            &#8736; {fmtDeg(cargDeg(match.gammaLoad))}
          </>
        )}
      </p>
      <label className="check">
        <input
          type="checkbox"
          checked={design.showStability}
          onChange={(e) => setShowStability(e.target.checked)}
        />
        <span className="sw" style={{ background: 'var(--stab)' }} />
        Stability circles: input plane stable{' '}
        {sourceStabilityCircle(tp.s).stableInside ? 'inside' : 'outside'}, output plane stable{' '}
        {loadStabilityCircle(tp.s).stableInside ? 'inside' : 'outside'}
        {st.unconditionallyStable ? ' (unconditionally stable)' : ''}
      </label>

      <div className="number-list">
        <div className="row">
          <span className="sw" style={{ background: 'var(--gain)' }} />
          <span className="name">Gain circles</span>
          <select
            className="value-input"
            value={gainType}
            onChange={(e) => setGainType(e.target.value as GainCircleType)}
            aria-label="Gain circle type"
          >
            {(Object.keys(GAIN_TYPE_LABELS) as GainCircleType[]).map((t) => (
              <option key={t} value={t}>
                {GAIN_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <GainInput
          gmax={gmax}
          onAdd={(gainDb) => {
            if (!design.gainCircles.some((g) => g.type === gainType && g.gainDb === gainDb)) {
              setGainCircles([...design.gainCircles, { type: gainType, gainDb }]);
            }
          }}
        />
        <div className="chips">
          {design.gainCircles.map((g, i) => (
            <span key={`${g.type}${g.gainDb}`} className="chip mono">
              {GAIN_TYPE_LABELS[g.type].split(' ')[0]} {Number(g.gainDb.toFixed(3))} dB
              <button
                aria-label={`Remove gain circle ${g.gainDb} dB`}
                onClick={() => setGainCircles(design.gainCircles.filter((_, j) => j !== i))}
              >
                &#215;
              </button>
            </span>
          ))}
        </div>
      </div>

      <h2>Noise parameters</h2>
      {tp.noise ? (
        <>
          <div className="row fields">
            <label>
              NFmin
              <ValueInput
                value={tp.noise.nfMinDb}
                plain
                min={0}
                onCommit={(nfMinDb) => setNoise({ ...tp.noise!, nfMinDb })}
              />
              dB
            </label>
            <label title="Equivalent noise resistance normalized to Z0">
              rn
              <ValueInput
                value={tp.noise.rn}
                plain
                min={0}
                onCommit={(rn) => setNoise({ ...tp.noise!, rn })}
              />
            </label>
            <label>
              |&#915;opt|
              <ValueInput
                value={cabs(tp.noise.gammaOpt)}
                plain
                min={0}
                onCommit={(m) =>
                  setNoise({ ...tp.noise!, gammaOpt: polarDeg(m, cargDeg(tp.noise!.gammaOpt)) })
                }
              />
            </label>
            <label>
              &#8736;&#915;opt
              <ValueInput
                value={cargDeg(tp.noise.gammaOpt)}
                plain
                onCommit={(a) =>
                  setNoise({ ...tp.noise!, gammaOpt: polarDeg(cabs(tp.noise!.gammaOpt), a) })
                }
              />
              &#176;
            </label>
            <button className="btn tiny" onClick={() => setNoise(null)}>
              Clear
            </button>
          </div>
          <NumberList
            label="Noise circles"
            values={design.noiseCircles}
            min={tp.noise.nfMinDb}
            swatch="var(--noise)"
            placeholder={String(Math.round((tp.noise.nfMinDb + 0.5) * 10) / 10)}
            unit=" dB"
            onChange={setNoiseCircles}
          />
        </>
      ) : (
        <p className="muted small">
          <button className="btn tiny" onClick={() => setNoise(DEFAULT_NOISE)}>
            Enter noise parameters
          </button>{' '}
          to draw noise figure circles.
        </p>
      )}
      <p className="muted small">
        <button
          className="btn tiny"
          onClick={() => {
            setTwoPort(null);
            setGainCircles([]);
            setNoiseCircles([]);
            setShowStability(false);
          }}
        >
          Remove device
        </button>
      </p>
    </>
  );
}

function GainInput({ gmax, onAdd }: { gmax: number; onAdd: (gainDb: number) => void }) {
  const [text, setText] = useState('');
  const add = (): void => {
    const v = Number(text);
    if (Number.isFinite(v) && text.trim() !== '') onAdd(Math.round(v * 1000) / 1000);
    setText('');
  };
  return (
    <div className="row">
      <span className="muted small">Gmax {fmtNum(gmax, 2)} dB. Circle gain in dB:</span>
      <input
        className="value-input"
        style={{ width: '4.5em' }}
        value={text}
        placeholder={fmtNum(gmax - 1, 1)}
        aria-label="Add gain circle"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && add()}
      />
      <button className="btn tiny" onClick={add}>
        Add
      </button>
    </div>
  );
}
