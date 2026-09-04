import { diverging } from '../lib/palette.js';

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

export default function Legend({ mode, names, summary, areaRange, angleRange, probe }) {
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
            <DivergingBar range={areaRange} unit="×" format={(t) => (2 ** t).toFixed(1)} />
            <p className="legend-keys">
              Magenta: <span className="key key-a">{names.a}</span> shows that ground larger. Teal:{' '}
              <span className="key key-b">{names.b}</span> does.
            </p>
          </>
        )}

        {mode === 'angle' && (
          <>
            <DivergingBar range={angleRange} unit="°" format={(t) => Math.abs(t).toFixed(0)} />
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
      </div>

      <div className="readout" aria-live="off">
        {probe ? (
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
