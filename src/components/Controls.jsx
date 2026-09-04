import { CATALOG, FAMILIES } from '../lib/catalog.js';
import { MODES } from '../lib/render.js';

const GLOBE_LAYERS = [
  ['relief', 'Relief', 'The area ratio as height. Bulges where the first map inflates the ground.'],
  ['wrinkle', 'Wrinkle', 'Each sheet laid back on the globe. Where it is too big to fit, it ruffles.'],
  ['arcs', 'Reading error', 'Where the second map really shows the ground the first one puts at each node.'],
];

function ProjectionPicker({ side, value, onChange }) {
  return (
    <label className={`picker picker-${side}`}>
      <span className="picker-tick" aria-hidden="true" />
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {FAMILIES.map((family) => (
          <optgroup key={family} label={family}>
            {CATALOG.filter((entry) => entry.family === family).map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

export default function Controls({ settings, update, summary, onSwap }) {
  const { idA, idB, mode, rotate, columns, morphT, globeLayer, exaggeration, wavelength, globeColumns } =
    settings;

  return (
    <aside className="rail">
      <header className="rail-head">
        <h1>Projection diff</h1>
        <p>Two ways of flattening the same globe, and where they part company.</p>
      </header>

      <section className="rail-block">
        <ProjectionPicker side="a" value={idA} onChange={(id) => update({ idA: id })} />
        <ProjectionPicker side="b" value={idB} onChange={(id) => update({ idB: id })} />
        <button type="button" className="swap" onClick={onSwap}>
          Swap them
        </button>
      </section>

      <section className="rail-block">
        <h2>Read the difference as</h2>
        <div className="modes">
          {Object.entries(MODES).map(([key, entry]) => (
            <button
              key={key}
              type="button"
              className={key === mode ? 'mode is-on' : 'mode'}
              onClick={() => update({ mode: key })}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <p className="hint">{MODES[mode].hint}</p>
      </section>

      {mode === 'globe' && (
        <section className="rail-block">
          <h2>Show on the sphere</h2>
          <div className="modes">
            {GLOBE_LAYERS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={key === globeLayer ? 'mode is-on' : 'mode'}
                onClick={() => update({ globeLayer: key })}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="hint">{GLOBE_LAYERS.find(([key]) => key === globeLayer)[2]}</p>
        </section>
      )}

      <section className="rail-block">
        {mode === 'morph' && (
          <label className="slider">
            <span>Blend</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={morphT}
              onChange={(event) => update({ morphT: Number(event.target.value) })}
            />
            <output>{Math.round(morphT * 100)}%</output>
          </label>
        )}
        <label className="slider">
          <span>Central meridian</span>
          <input
            type="range"
            min="-180"
            max="180"
            step="5"
            value={-rotate}
            onChange={(event) => update({ rotate: -Number(event.target.value) })}
          />
          <output>{Math.round(-rotate)}°</output>
        </label>
        {mode === 'globe' && globeLayer === 'relief' && (
          <label className="slider">
            <span>Exaggeration</span>
            <input
              type="range"
              min="0.04"
              max="0.5"
              step="0.02"
              value={exaggeration}
              onChange={(event) => update({ exaggeration: Number(event.target.value) })}
            />
            <output>{Math.round(exaggeration * 100)}%</output>
          </label>
        )}
        {mode === 'globe' && globeLayer === 'wrinkle' && (
          <label className="slider">
            <span>Fold spacing</span>
            <input
              type="range"
              min="0.06"
              max="0.4"
              step="0.01"
              value={wavelength}
              onChange={(event) => update({ wavelength: Number(event.target.value) })}
            />
            <output>{(wavelength * (180 / Math.PI)).toFixed(0)}°</output>
          </label>
        )}
        <label className="slider">
          <span>Sampling</span>
          {mode === 'globe' ? (
            <input
              type="range"
              min="180"
              max="540"
              step="90"
              value={globeColumns}
              onChange={(event) => update({ globeColumns: Number(event.target.value) })}
            />
          ) : (
            <input
              type="range"
              min="24"
              max="144"
              step="12"
              value={columns}
              onChange={(event) => update({ columns: Number(event.target.value) })}
            />
          )}
          <output>
            {mode === 'globe' ? `${globeColumns}×${globeColumns / 2}` : `${columns}×${columns / 2}`}
          </output>
        </label>
      </section>

      {summary && (
        <section className="rail-block scores">
          <h2>Whole-world error</h2>
          <table>
            <thead>
              <tr>
                <th scope="col" />
                <th scope="col">Area</th>
                <th scope="col">Angle</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['a', summary.a],
                ['b', summary.b],
              ].map(([side, row]) => (
                <tr key={side} className={`row-${side}`}>
                  <th scope="row">
                    <span className="picker-tick" aria-hidden="true" />
                    {row.name}
                  </th>
                  <td>{row.areal.toFixed(3)}</td>
                  <td>{row.angular.toFixed(1)}°</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">
            Root-mean-square across the globe, weighted by ground area. Zero area error means the
            map is equal-area; zero angle error means it is conformal. No map gets both.
          </p>
        </section>
      )}
    </aside>
  );
}
