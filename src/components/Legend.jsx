import { diverging, intensityStep as intensity, PALETTE } from '../lib/palette.js';

const STEPS = 40;

function DivergingBar({ range, unit, format }) {
  return (
    <div className="legend-scale">
      <span className="legend-end legend-end-b">{format(-range)} {unit}</span>
      <div className="ramp" role="img" aria-label={`Diverging scale from ${format(-range)} to ${format(range)} ${unit}`}>
        {Array.from({ length: STEPS }, (_, index) => {
          const t = (index / (STEPS - 1)) * 2 - 1;
          return <i key={index} style={{ background: diverging(t) }} />;
        })}
      </div>
      <span className="legend-end legend-end-a">{format(range)} {unit}</span>
    </div>
  );
}

function SequentialBar({ color, side, name, top }) {
  return (
    <div className="legend-scale">
      <span className={`legend-end legend-end-${side}`}>{name}</span>
      <div className="ramp" role="img" aria-label={`${name}: flat to ${top}`}>
        {Array.from({ length: STEPS }, (_, index) => (
          <i key={index} style={{ background: intensity(color, index / (STEPS - 1)) }} />
        ))}
      </div>
      <span className="legend-end">{top}</span>
    </div>
  );
}

/**
 * Turning the contrast up shrinks the full-scale value, and a ratio printed to
 * one decimal collapses to `1.0` at both ends of the ramp. Under a tenth of a
 * stop the ends are said as a percentage instead, which keeps a number there.
 */
function areaTicks(range) {
  if (range < 0.1) {
    return { unit: '', format: (t) => `${t > 0 ? '+' : ''}${((2 ** t - 1) * 100).toFixed(1)}%` };
  }
  return { unit: '\u00d7', format: (t) => (2 ** t).toFixed(2) };
}

/** Enough decimals that a narrowed angle scale does not read 0 at both ends. */
function decimalsFor(range) {
  if (range >= 5) return 0;
  return range >= 0.5 ? 1 : 2;
}

const RELIEF_TEXT = {
  area: 'Height is the same ratio the flat Area map colours.',
  angle: 'Height is the difference in how far each map bends local shapes.',
  strain: 'Height is the two wrinkle globes subtracted: how much further one sheet has to stretch to lie on the sphere than the other.',
};

const RELIEF_FLAT = {
  area: 'Both of these are equal-area maps, so they put the same ground area in the same amount of ink everywhere and their ratio is exactly 1.',
  angle: 'Both of these are conformal maps, so neither bends local shapes at all.',
  strain: 'These two sheets stretch by exactly the same amount everywhere.',
};

/** Ends for whichever measure the relief is built from. */
function reliefTicks(source, range) {
  if (source === 'angle') {
    return { unit: '\u00b0', format: (t) => Math.abs(t).toFixed(decimalsFor(range)) };
  }
  if (source === 'strain') {
    return {
      unit: '',
      format: (t) => `${Math.abs(t * 100).toFixed(range < 0.1 ? 1 : 0)}% longer`,
    };
  }
  return areaTicks(range);
}

export default function Legend({ mode, names, summary, areaRange, angleRange, probe, globe }) {
  return (
    <footer className="legend">
      <div className="legend-body">
        {mode === 'outlines' && (
          <p className="legend-keys">
            <span className="key key-a">{names.a}</span>
            <span className="key key-b">{names.b}</span>
            drawn at the same fitted size.
          </p>
        )}

        {mode === 'displacement' && (
          <p className="legend-keys">
            Each stalk runs from <span className="key key-a">{names.a}</span> to{' '}
            <span className="key key-b">{names.b}</span>. Median{' '}
            <b>{summary.displacement.median.toFixed(0)} px</b>, longest{' '}
            <b>{summary.displacement.max.toFixed(0)} px</b>.
          </p>
        )}

        {mode === 'area' && (
          <>
            <DivergingBar range={areaRange} {...areaTicks(areaRange)} />
            <p className="legend-keys">
              Magenta: <span className="key key-a">{names.a}</span> shows that ground larger. Teal:{' '}
              <span className="key key-b">{names.b}</span> does.
            </p>
          </>
        )}

        {mode === 'angle' && (
          <>
            <DivergingBar range={angleRange} unit="°" format={(t) => Math.abs(t).toFixed(decimalsFor(angleRange))} />
            <p className="legend-keys">
              Magenta: <span className="key key-a">{names.a}</span> bends local shapes more. Teal:{' '}
              <span className="key key-b">{names.b}</span> does.
            </p>
          </>
        )}

        {mode === 'morph' && (
          <p className="legend-keys">
            Drag the blend to bend <span className="key key-a">{names.a}</span> into{' '}
            <span className="key key-b">{names.b}</span>.
          </p>
        )}

        {mode === 'globe' && globe?.layer === 'relief' && (
          <>
            <DivergingBar range={globe.range} {...reliefTicks(globe.source, globe.range)} />
            <p className="legend-keys">
              {globe.flat ? (
                <>
                  {RELIEF_FLAT[globe.source]} There is nothing for the height to follow, at any
                  contrast — take the height from something else.
                </>
              ) : (
                <>
                  {RELIEF_TEXT[globe.source]} It bulges where{' '}
                  <span className="key key-a">{names.a}</span> is the worse of the two and sinks
                  where <span className="key key-b">{names.b}</span> is. Drag to turn the globe.
                </>
              )}
            </p>
          </>
        )}

        {mode === 'globe' && globe?.layer === 'wrinkle' && (
          <>
            {globe.strainScale > 0 && (
              <>
                <SequentialBar
                  color={PALETTE.a}
                  side="a"
                  name={names.a}
                  top={`${(globe.strainScale * 100).toFixed(0)}% too long`}
                />
                <SequentialBar color={PALETTE.b} side="b" name={names.b} top="" />
              </>
            )}
            <p className="legend-keys">
              Each sheet laid back on the globe, ruffling wherever it is too big to fit.{' '}
              {globe.strainScale > 0
                ? 'Colour is the local excess: white where the sheet lies on the sphere untouched. '
                : ''}
              Worst excess{' '}
              <b>{(globe.peak.a.strain * 100).toFixed(0)}%</b> on{' '}
              <span className="key key-a">{names.a}</span>,{' '}
              <b>{(globe.peak.b.strain * 100).toFixed(0)}%</b> on{' '}
              <span className="key key-b">{names.b}</span>. Fold depth follows a scaling law, not a
              cloth simulation, and flattens off where real material would fold over.
            </p>
          </>
        )}

        {mode === 'globe' && globe?.layer === 'cloth' && (
          <p className="legend-keys">
            Each sheet relaxed onto the sphere rather than folded by a formula: every edge holds the
            length it has on the flat map, the globe pulls the sheet back down, and stiffness resists
            sharp turns. Nothing sets the fold spacing — it is what those three settle into, which is
            why the folds gather where the material has nowhere else to go.
          </p>
        )}

        {mode === 'globe' && globe?.layer === 'arcs' && (
          <p className="legend-keys">
            Each arc starts where <span className="key key-a">{names.a}</span> puts a graticule node
            and ends at the ground <span className="key key-b">{names.b}</span> really shows there —
            the error you make by reading one map as the other.
          </p>
        )}
      </div>

      <div className="readout" aria-live="off">
        {mode === 'globe' ? (
          <p className="readout-empty">Drag the globe to turn it.</p>
        ) : probe ? (
          <dl>
            <div>
              <dt>Position</dt>
              <dd>
                {Math.abs(probe.lat).toFixed(1)}°{probe.lat >= 0 ? 'N' : 'S'}{' '}
                {Math.abs(probe.lon).toFixed(1)}°{probe.lon >= 0 ? 'E' : 'W'}
              </dd>
            </div>
            <div className="row-a">
              <dt>{names.a}</dt>
              <dd>
                {probe.a ? `${probe.a.areal.toFixed(2)}× area, ${probe.a.angular.toFixed(1)}° bend` : '—'}
              </dd>
            </div>
            <div className="row-b">
              <dt>{names.b}</dt>
              <dd>
                {probe.b ? `${probe.b.areal.toFixed(2)}× area, ${probe.b.angular.toFixed(1)}° bend` : '—'}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="readout-empty">Point at the map to measure a spot.</p>
        )}
      </div>
    </footer>
  );
}
