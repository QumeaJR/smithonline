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
import { TIPS } from '../lib/tips';
import { fmtDeg, fmtFrequency, fmtNum } from '../lib/format';
import { useDesignStore } from '../store/useDesignStore';
import { NumberList } from './NumberList';
import { Button } from './ui/Button';
import { Field } from './ui/Field';
import { IconClose } from './ui/icons';

const DEFAULT_S: SParameters = {
  s11: polarDeg(0.5, -120),
  s12: polarDeg(0.05, 50),
  s21: polarDeg(3, 80),
  s22: polarDeg(0.4, -40),
};

const DEFAULT_NOISE: NoiseParameters = { nfMinDb: 1, gammaOpt: polarDeg(0.4, 60), rn: 0.3 };

/** The tooltips of the stability and gain figures (docs/09 section 5). */
const K_TIP = 'K, mu: stability tests (above 1: stable)';
const MAG_TIP = 'MAG: maximum available gain';
const MSG_TIP = 'MSG: maximum stable gain when K is below 1';

/** Device parameters, their derived figures, and the stability, gain and noise circle lists. */
export function TwoPortPanel() {
  const design = useDesignStore((s) => s.design);
  const twoPortFiles = useDesignStore((s) => s.twoPortFiles);
  const { setTwoPort, setShowStability, setGainCircles, setNoiseCircles } =
    useDesignStore.getState();
  const [gainType, setGainType] = useState<GainCircleType>('available');
  const tp = design.twoPort;
  /** The file opened last, offered again after a hand edit. */
  const lastFileId = Object.keys(twoPortFiles).at(-1);
  const lastFile = lastFileId === undefined ? undefined : twoPortFiles[lastFileId];

  if (!tp) {
    return (
      <p className="muted small">
        Enter the S-parameters of a device (or open an example such as Example 13) to draw
        stability, gain and noise circles.{' '}
        <Button size="sm" onClick={() => setTwoPort({ s: DEFAULT_S, noise: null })}>
          Enter S-parameters
        </Button>
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
      {!tp.source && lastFile && (
        <p className="muted small">
          Edited by hand: the device no longer follows the design frequency.{' '}
          <Button
            size="sm"
            onClick={() =>
              useDesignStore.getState().importTwoPort(lastFile.data, lastFile.fileName)
            }
          >
            Fill again from {lastFile.fileName}
          </Button>
        </p>
      )}
      {tp.source && (
        <p className="muted small">
          From <strong>{tp.source.fileName}</strong> at {fmtFrequency(tp.source.frequency)}
          {tp.source.clamped
            ? `, outside the file's ${fmtFrequency(tp.source.covers[0])} to ${fmtFrequency(tp.source.covers[1])}: nearest end used`
            : ` (interpolated; file covers ${fmtFrequency(tp.source.covers[0])} to ${fmtFrequency(tp.source.covers[1])})`}
          .{' '}
          {Object.values(twoPortFiles).some((f) => f.fileName === tp.source?.fileName)
            ? 'The device follows the design frequency; editing a value below detaches the file.'
            : 'The file is not loaded in this session: open it again to make the device follow the design frequency.'}
        </p>
      )}
      <p
        className={`small stability-line${st.unconditionallyStable ? '' : ' warn-text'}`}
        data-tour="numbers.stability"
      >
        {st.unconditionallyStable ? (
          <>
            Stable at {fmtFrequency(design.frequency)} (<abbr title={K_TIP}>K</abbr>{' '}
            {fmtNum(st.k, 2)}, <abbr title={K_TIP}>mu</abbr> {fmtNum(st.mu, 2)}): for any passive
            source and load.
          </>
        ) : (
          <>
            Potentially unstable at {fmtFrequency(design.frequency)} (<abbr title={K_TIP}>K</abbr>{' '}
            {fmtNum(st.k, 2)}, <abbr title={K_TIP}>mu</abbr> {fmtNum(st.mu, 2)}): draw the stability
            circles.{' '}
            {!design.showStability && (
              <Button size="sm" onClick={() => setShowStability(true)}>
                Draw stability circles
              </Button>
            )}
          </>
        )}
      </p>
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
                <Field
                  value={cabs(tp.s[key])}
                  plain
                  digits={5}
                  min={0}
                  ariaLabel={`${key} magnitude`}
                  onCommit={(m) => setS(key, polarDeg(m, cargDeg(tp.s[key])))}
                />
              </td>
              <td>
                <Field
                  value={cargDeg(tp.s[key])}
                  plain
                  suffix="°"
                  ariaLabel={`${key} angle`}
                  onCommit={(a) => setS(key, polarDeg(cabs(tp.s[key]), a))}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mono small readout">
        <abbr title={K_TIP}>K</abbr> {fmtNum(st.k, 4)} &nbsp; |&#916;| {fmtNum(st.deltaMag, 4)}{' '}
        &nbsp; <abbr title={K_TIP}>&#956;</abbr> {fmtNum(st.mu, 3)} &nbsp;{' '}
        <abbr title={K_TIP}>&#956;&#8242;</abbr> {fmtNum(st.muPrime, 3)}
        <br />
        <abbr title={st.k >= 1 ? MAG_TIP : MSG_TIP}>{st.k >= 1 ? 'MAG' : 'MSG'}</abbr>{' '}
        {fmtNum(gmax, 3)} dB
        {st.k >= 1 && (
          <>
            {' '}
            &nbsp; <abbr title={MSG_TIP}>MSG</abbr> {fmtNum(linearToDb(msg(tp.s)), 3)} dB
          </>
        )}
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
      <label className="check" data-tour="numbers.circles.stability">
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

      <div className="number-list" data-tour="numbers.circles.gain">
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
                type="button"
                aria-label={`Remove gain circle ${g.gainDb} dB`}
                title={`Remove gain circle ${g.gainDb} dB`}
                onClick={() => setGainCircles(design.gainCircles.filter((_, j) => j !== i))}
              >
                <IconClose size={11} />
              </button>
            </span>
          ))}
        </div>
      </div>

      <h2 title={TIPS.noise}>Noise parameters</h2>
      {tp.noise ? (
        <>
          <div className="row fields">
            <Field
              label="NFmin"
              value={tp.noise.nfMinDb}
              plain
              min={0}
              suffix="dB"
              onCommit={(nfMinDb) => setNoise({ ...tp.noise!, nfMinDb })}
            />
            <Field
              label="rn"
              title="Equivalent noise resistance normalized to Z0"
              value={tp.noise.rn}
              plain
              min={0}
              onCommit={(rn) => setNoise({ ...tp.noise!, rn })}
            />
            <Field
              label={<>|&#915;opt|</>}
              value={cabs(tp.noise.gammaOpt)}
              plain
              min={0}
              onCommit={(m) =>
                setNoise({ ...tp.noise!, gammaOpt: polarDeg(m, cargDeg(tp.noise!.gammaOpt)) })
              }
            />
            <Field
              label={<>&#8736;&#915;opt</>}
              value={cargDeg(tp.noise.gammaOpt)}
              plain
              suffix="°"
              onCommit={(a) =>
                setNoise({ ...tp.noise!, gammaOpt: polarDeg(cabs(tp.noise!.gammaOpt), a) })
              }
            />
            <Button size="sm" onClick={() => setNoise(null)}>
              Clear
            </Button>
          </div>
          <div data-tour="numbers.circles.noise">
            <NumberList
              label="Noise circles"
              itemName="noise circle"
              values={design.noiseCircles}
              min={tp.noise.nfMinDb}
              swatch="var(--noise)"
              placeholder={String(Math.round((tp.noise.nfMinDb + 0.5) * 10) / 10)}
              unit=" dB"
              onChange={setNoiseCircles}
            />
          </div>
        </>
      ) : (
        <p className="muted small">
          <Button size="sm" onClick={() => setNoise(DEFAULT_NOISE)}>
            Enter noise parameters
          </Button>{' '}
          to draw noise figure circles.
        </p>
      )}
      <p className="muted small">
        <Button
          size="sm"
          variant="destructive"
          onClick={() => {
            setTwoPort(null);
            setGainCircles([]);
            setNoiseCircles([]);
            setShowStability(false);
          }}
        >
          Remove device
        </Button>
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
      <Button size="sm" onClick={add}>
        Add
      </Button>
    </div>
  );
}
