import { useCallback, useMemo, useState } from 'react';
import { feature } from 'topojson-client';
import landTopology from 'world-atlas/land-110m.json';
import Controls from './components/Controls.jsx';
import DiffCanvas from './components/DiffCanvas.jsx';
import Legend from './components/Legend.jsx';
import { buildPair, sampleField } from './lib/diff.js';
import { distortion } from './lib/distortion.js';
import { sphereMesh, unitRadii } from './lib/globe.js';
import { globeField, peakAmplitude, reliefRadii, wrinkleRadii } from './lib/relief.js';

const LAND = feature(landTopology, landTopology.objects.land);
const RADIANS = Math.PI / 180;

const INITIAL = {
  idA: 'mercator',
  idB: 'equalEarth',
  mode: 'globe',
  rotate: 0,
  columns: 72,
  morphT: 0.5,
  globeLayer: 'relief',
  tilt: 0.32,
  globeColumns: 180,
  exaggeration: 0.22,
  wavelength: 0.22,
};

/** Symmetric range for the diverging ramps, clipped to the 95th percentile so a
 *  couple of polar outliers cannot flatten the rest of the map to nothing. */
function robustRange(values, floor) {
  const magnitudes = values
    .filter((value) => value !== null && Number.isFinite(value))
    .map(Math.abs)
    .sort((x, y) => x - y);
  if (!magnitudes.length) return floor;
  return Math.max(floor, magnitudes[Math.floor(magnitudes.length * 0.95)]);
}

/**
 * Where map B actually shows the ground that map A puts at each graticule node.
 * Reading one map as though it were the other lands you at the far end of the
 * arc.
 */
function readingErrors(pair, step = 15) {
  const arcs = [];
  if (!pair.projB.invert) return arcs;
  for (let lat = pair.maxLat - step; lat > -pair.maxLat; lat -= step) {
    for (let lon = -180; lon < 180; lon += step) {
      const plane = pair.projA([lon, lat]);
      if (!plane || !Number.isFinite(plane[0])) continue;
      const back = pair.projB.invert(plane);
      if (!back || !Number.isFinite(back[0]) || Math.abs(back[1]) > pair.maxLat) continue;
      arcs.push([lon, lat, back[0], back[1]]);
    }
  }
  return arcs;
}

export default function App() {
  const [settings, setSettings] = useState(INITIAL);
  const [size, setSize] = useState({ width: 900, height: 520 });
  const [pointer, setPointer] = useState(null);

  const update = useCallback((patch) => setSettings((prev) => ({ ...prev, ...patch })), []);
  const onResize = useCallback((next) => setSize(next), []);
  const onProbe = useCallback((next) => setPointer(next), []);
  const onDrag = useCallback((dx, dy) => {
    setSettings((prev) => ({
      ...prev,
      rotate: ((prev.rotate + dx * 0.35 + 180) % 360) - 180,
      tilt: Math.max(-1.2, Math.min(1.2, prev.tilt + dy * 0.005)),
    }));
  }, []);

  const pair = useMemo(
    () =>
      buildPair({
        idA: settings.idA,
        idB: settings.idB,
        width: size.width,
        height: size.height,
        rotate: settings.rotate,
      }),
    [settings.idA, settings.idB, settings.rotate, size.width, size.height],
  );

  const field = useMemo(
    () => sampleField(pair, { columns: settings.columns, rows: settings.columns / 2 }),
    [pair, settings.columns],
  );

  const areaRange = useMemo(
    () => robustRange(field.cells.map((cell) => cell.arealRatio), 0.25),
    [field],
  );
  const angleRange = useMemo(
    () => robustRange(field.cells.map((cell) => cell.angularDelta), 2),
    [field],
  );

  const onGlobe = settings.mode === 'globe';

  const mesh = useMemo(
    () => (onGlobe ? sphereMesh(settings.globeColumns, settings.globeColumns / 2) : null),
    [onGlobe, settings.globeColumns],
  );

  // Two Jacobians per vertex, so this is the expensive step. It depends on the
  // pair and the mesh only, which is what keeps dragging cheap.
  const measured = useMemo(
    () => (mesh ? globeField(mesh, pair.rawA, pair.rawB, pair.maxLat) : null),
    [mesh, pair.rawA, pair.rawB, pair.maxLat],
  );

  const globe = useMemo(() => {
    if (!mesh || !measured) return null;
    const { globeLayer, wavelength, exaggeration, rotate, tilt } = settings;
    const shared = {
      mesh,
      field: measured,
      layer: globeLayer,
      yaw: rotate * RADIANS,
      pitch: tilt,
      names: { a: pair.entryA.name, b: pair.entryB.name },
    };

    if (globeLayer === 'wrinkle') {
      return {
        ...shared,
        radiiA: wrinkleRadii(mesh, measured, 'a', wavelength),
        radiiB: wrinkleRadii(mesh, measured, 'b', wavelength),
        peak: {
          a: peakAmplitude(mesh, measured, 'a', wavelength),
          b: peakAmplitude(mesh, measured, 'b', wavelength),
        },
      };
    }
    if (globeLayer === 'arcs') {
      return { ...shared, radii: unitRadii(mesh), arcs: readingErrors(pair) };
    }
    return {
      ...shared,
      radii: reliefRadii(mesh, measured, { range: areaRange, amplitude: exaggeration }),
    };
  }, [mesh, measured, pair, areaRange, settings]);

  const probe = useMemo(() => {
    if (onGlobe || !pointer || !pair.projA.invert) return null;
    const location = pair.projA.invert(pointer);
    if (!location || !Number.isFinite(location[0]) || Math.abs(location[1]) > pair.maxLat) {
      return null;
    }
    const [lon, lat] = location;
    return {
      lon,
      lat,
      a: distortion(pair.rawA, lon * RADIANS, lat * RADIANS),
      b: distortion(pair.rawB, lon * RADIANS, lat * RADIANS),
    };
  }, [onGlobe, pointer, pair]);

  const names = { a: pair.entryA.name, b: pair.entryB.name };

  return (
    <div className="app">
      <Controls
        settings={settings}
        update={update}
        summary={field.summary}
        onSwap={() => update({ idA: settings.idB, idB: settings.idA })}
      />
      <main className="stage">
        <DiffCanvas
          size={size}
          onResize={onResize}
          onProbe={onProbe}
          onDrag={onGlobe ? onDrag : null}
          pair={pair}
          field={field}
          land={LAND}
          mode={settings.mode}
          morphT={settings.morphT}
          areaRange={areaRange}
          angleRange={angleRange}
          globe={globe}
        />
        <Legend
          mode={settings.mode}
          names={names}
          summary={field.summary}
          areaRange={areaRange}
          angleRange={angleRange}
          probe={probe}
          globe={globe}
        />
      </main>
    </div>
  );
}
