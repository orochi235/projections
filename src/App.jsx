import { useCallback, useMemo, useState } from 'react';
import { feature } from 'topojson-client';
import landTopology from 'world-atlas/land-110m.json';
import Controls from './components/Controls.jsx';
import DiffCanvas from './components/DiffCanvas.jsx';
import Legend from './components/Legend.jsx';
import { buildPair, sampleField } from './lib/diff.js';
import { distortion } from './lib/distortion.js';

const LAND = feature(landTopology, landTopology.objects.land);
const RADIANS = Math.PI / 180;

const INITIAL = {
  idA: 'mercator',
  idB: 'equalEarth',
  mode: 'area',
  rotate: 0,
  columns: 72,
  morphT: 0.5,
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

export default function App() {
  const [settings, setSettings] = useState(INITIAL);
  const [size, setSize] = useState({ width: 900, height: 520 });
  const [pointer, setPointer] = useState(null);

  const update = useCallback((patch) => setSettings((prev) => ({ ...prev, ...patch })), []);
  const onResize = useCallback((next) => setSize(next), []);
  const onProbe = useCallback((next) => setPointer(next), []);

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

  const probe = useMemo(() => {
    if (!pointer || !pair.projA.invert) return null;
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
  }, [pointer, pair]);

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
          pair={pair}
          field={field}
          land={LAND}
          mode={settings.mode}
          morphT={settings.morphT}
          areaRange={areaRange}
          angleRange={angleRange}
        />
        <Legend
          mode={settings.mode}
          names={names}
          summary={field.summary}
          areaRange={areaRange}
          angleRange={angleRange}
          probe={probe}
        />
      </main>
    </div>
  );
}
