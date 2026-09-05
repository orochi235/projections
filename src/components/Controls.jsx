import { CATALOG, FAMILIES } from '../lib/catalog.js';
import { PATCH_SITES, siteFor } from '../lib/patch.js';
import { MODES } from '../lib/render.js';

const RELIEF_SOURCES = [
  ['area', 'Area', 'the ground each map inflates'],
  ['angle', 'Angle', 'how much each map bends local shapes'],
  ['strain', 'Wrinkling', 'how far each sheet has to stretch — the two wrinkle globes subtracted'],
];

const GLOBE_LAYERS = [
  ['relief', 'Relief', 'One measure of the pair as height. Bulges where the first map is the worse of the two.'],
  ['wrinkle', 'Wrinkle', 'Each sheet laid back on the globe. Where it is too big to fit, it ruffles.'],
  ['cloth', 'Cloth', 'The same two sheets, but relaxed onto the sphere instead of folded by a formula. Watch them settle.'],
  ['patch', 'Patch', 'One window on the globe, meshed fine enough to see the individual folds. The inset says where it was cut from.'],
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

/**
 * An isocol belongs to one map, not to the globe, so choosing a window chooses
 * the map it means something on. If the other side already holds that map, it
 * takes the one being displaced rather than leaving both sides the same.
 */
function showSiteOn(siteId, idB) {
  const { projection } = siteFor(siteId);
  return projection === idB ? { idA: projection, idB: 'equirectangular' } : { idA: projection };
}

export default function Controls({ settings, update, summary, onSwap }) {
  const {
    idA,
    idB,
    mode,
    rotate,
    columns,
    morphT,
    globeLayer,
    exaggeration,
    wavelength,
    globeColumns,
    contrast,
    shadeStrain,
    reliefSource,
    foldScale,
    patchSite,
    patchFolds,
  } = settings;
  const onWrinkle = mode === 'globe' && globeLayer === 'wrinkle';
  const onCloth = mode === 'globe' && globeLayer === 'cloth';
  const onRelief = mode === 'globe' && globeLayer === 'relief';
  const onScale =
    mode === 'area' ||
    mode === 'angle' ||
    onRelief ||
    ((onWrinkle || onCloth) && shadeStrain);

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

      {mode === 'globe' && (
        <section className="rail-block">
          <h2>Show on the sphere</h2>
          <div className="modes">
            {GLOBE_LAYERS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={key === globeLayer ? 'mode is-on' : 'mode'}
                onClick={() =>
                  update(key === 'patch' ? { globeLayer: key, ...showSiteOn(patchSite, idB) } : { globeLayer: key })
                }
              >
                {label}
              </button>
            ))}
          </div>
          <p className="hint">{GLOBE_LAYERS.find(([key]) => key === globeLayer)[2]}</p>
          {globeLayer === 'patch' && (
            <>
              <h2>Window</h2>
              <label className="picker picker-a">
                <span className="picker-tick" aria-hidden="true" />
                <select
                  value={patchSite}
                  onChange={(event) =>
                    update({ patchSite: event.target.value, ...showSiteOn(event.target.value, idB) })
                  }
                >
                  {PATCH_SITES.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.title}
                    </option>
                  ))}
                </select>
              </label>
              <p className="hint">{siteFor(patchSite).why}</p>
            </>
          )}
          {onRelief && (
            <>
              <h2>Height from</h2>
              <div className="modes">
                {RELIEF_SOURCES.map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={key === reliefSource ? 'mode is-on' : 'mode'}
                    onClick={() => update({ reliefSource: key })}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="hint">
                The difference in {RELIEF_SOURCES.find(([key]) => key === reliefSource)[2]}.
              </p>
            </>
          )}
        </section>
      )}

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
        {(onWrinkle || onCloth) && (
          <label className="toggle">
            <input
              type="checkbox"
              checked={shadeStrain}
              onChange={(event) => update({ shadeStrain: event.target.checked })}
            />
            <span>Shade by strain</span>
          </label>
        )}
        {onScale && (
          <label className="slider">
            <span>Contrast</span>
            <input
              type="range"
              min="0"
              max="4"
              step="0.25"
              value={Math.log2(contrast)}
              onChange={(event) => update({ contrast: 2 ** Number(event.target.value) })}
            />
            <output>×{contrast < 10 ? contrast.toFixed(1) : contrast.toFixed(0)}</output>
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
        {mode === 'globe' && globeLayer === 'patch' && (
          <label className="slider">
            <span>Folds across</span>
            <input
              type="range"
              min="3"
              max="9"
              step="0.5"
              value={patchFolds}
              onChange={(event) => update({ patchFolds: Number(event.target.value) })}
            />
            <output>{patchFolds}</output>
          </label>
        )}
        {onCloth && (
          <label className="slider">
            <span>Fold scale</span>
            <input
              type="range"
              min="0.1"
              max="0.5"
              step="0.05"
              value={foldScale}
              onChange={(event) => update({ foldScale: Number(event.target.value) })}
            />
            <output>{foldScale.toFixed(2)}</output>
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
