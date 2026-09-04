import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { feature } from 'topojson-client';
import landTopology from 'world-atlas/land-110m.json';
import Controls from './components/Controls.jsx';
import DiffCanvas from './components/DiffCanvas.jsx';
import Legend from './components/Legend.jsx';
import { buildPair, sampleField } from './lib/diff.js';
import { distortion } from './lib/distortion.js';
import { sphereMesh, unitRadii } from './lib/globe.js';
import { createDrape } from './lib/cloth.js';
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
  reliefSource: 'area',
  contrast: 1,
  shadeStrain: true,
  tilt: 0.32,
  globeColumns: 180,
  exaggeration: 0.22,
  foldScale: 0.3,
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

/** `robustRange` over one of the globe field's per-vertex measures. */
function meshRange(field, values, count, floor) {
  const magnitudes = [];
  for (let n = 0; n < count; n++) {
    if (field.defined[n] && Number.isFinite(values[n])) magnitudes.push(Math.abs(values[n]));
  }
  if (!magnitudes.length) return floor;
  magnitudes.sort((x, y) => x - y);
  return Math.max(floor, magnitudes[Math.floor(magnitudes.length * 0.95)]);
}

// A pair that agrees exactly still measures a little above zero: the Jacobian is
// a central difference, and two equal-area maps come out about 2e-7 apart in
// log2. These are a few orders above that noise and a few below anything a
// reader could see — 1e-4 in log2 is a hundredth of a percent of area.
const FLAT_FLOOR = { area: 1e-4, angle: 1e-3, strain: 1e-4 };

/** The largest difference anywhere, to tell "too small to see" from "identically
 *  zero" — two equal-area maps have no area difference at all, and no contrast
 *  setting can conjure one. */
function spread(field, values, count) {
  let worst = 0;
  for (let n = 0; n < count; n++) {
    if (field.defined[n] && Number.isFinite(values[n])) worst = Math.max(worst, Math.abs(values[n]));
  }
  return worst;
}

/**
 * Full-scale strain for the wrinkle shading. Strain runs away at the poles of a
 * cylindrical map — Mercator's worst vertex is several hundred percent — so a
 * cap taken anywhere near the top of the range leaves the rest of the world
 * white. The upper quartile puts the mid-latitudes on the ramp instead, and the
 * contrast slider moves it from there.
 */
function robustStrain(field, count) {
  const values = [];
  for (let n = 0; n < count; n++) {
    if (field.defined[n]) values.push(Math.max(field.excessA[n], field.excessB[n]));
  }
  if (!values.length) return 0.05;
  values.sort((x, y) => x - y);
  return Math.max(0.02, values[Math.floor(values.length * 0.75)]);
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

// Passes per animation frame, and the total each sheet gets. The drape is shown
// forming and then held: the relaxation does not converge (see cloth.js), and
// what runs past the budget is the solver arguing with itself, which reads as a
// globe that never stops twitching. The budget is a third of what it was
// because the sheet no longer starts from static — it starts folded.
const DRAPE_PASSES = 3;
const DRAPE_BUDGET = 60;
const CLOTH_COLUMNS = 96;


/**
 * Relaxes both sheets onto the sphere a few passes at a time, so the drape is
 * something you watch happen rather than a freeze followed by an answer. The
 * positions are mutated in place and the tick is only there to get the canvas
 * redrawn; nothing downstream reads it.
 */
function useDrape(active, mesh, pair, foldScale) {
  const [, setTick] = useState(0);
  const drapes = useRef(null);

  const sheets = useMemo(() => {
    if (!active || !mesh) return null;
    return {
      a: createDrape(mesh, pair.rawA, pair.maxLat, { bending: foldScale }),
      b: createDrape(mesh, pair.rawB, pair.maxLat, { bending: foldScale }),
    };
  }, [active, mesh, pair.rawA, pair.rawB, pair.maxLat, foldScale]);

  drapes.current = sheets;

  useEffect(() => {
    if (!sheets) return undefined;
    let frame = 0;
    let spent = 0;
    const tick = () => {
      sheets.a.settle(DRAPE_PASSES);
      sheets.b.settle(DRAPE_PASSES);
      spent += DRAPE_PASSES;
      setTick((n) => n + 1);
      if (spent < DRAPE_BUDGET) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [sheets]);

  return sheets;
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

  // The robust cap fits the pair, but two well-behaved projections differ by so
  // little that the whole world lands in the dead centre of the ramp. Contrast
  // divides the full-scale value so those pairs can be opened up.
  const areaRange = useMemo(
    () => robustRange(field.cells.map((cell) => cell.arealRatio), 0.25) / settings.contrast,
    [field, settings.contrast],
  );
  const angleRange = useMemo(
    () => robustRange(field.cells.map((cell) => cell.angularDelta), 2) / settings.contrast,
    [field, settings.contrast],
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

  // The fold scale the relaxation settles on is measured in mesh cells, so a
  // finer lattice buys finer folds rather than a better answer — past a point
  // they land at the cell size and read as static. The cloth keeps its own
  // coarser mesh, and the sampling slider still moves it up to that ceiling.
  const clothMesh = useMemo(
    () => (onGlobe ? sphereMesh(CLOTH_COLUMNS, CLOTH_COLUMNS / 2) : null),
    [onGlobe],
  );

  const clothField = useMemo(
    () => (clothMesh ? globeField(clothMesh, pair.rawA, pair.rawB, pair.maxLat) : null),
    [clothMesh, pair.rawA, pair.rawB, pair.maxLat],
  );

  const sheets = useDrape(
    onGlobe && settings.globeLayer === 'cloth',
    clothMesh,
    pair,
    settings.foldScale,
  );

  const strainCap = useMemo(
    () => (mesh && measured ? robustStrain(measured, mesh.count) : 0.05),
    [mesh, measured],
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

    if (globeLayer === 'cloth') {
      return {
        ...shared,
        mesh: clothMesh,
        field: clothField,
        strainScale: settings.shadeStrain ? strainCap / settings.contrast : 0,
        pointsA: sheets?.a.points,
        pointsB: sheets?.b.points,
        radii: unitRadii(clothMesh),
      };
    }

    if (globeLayer === 'wrinkle') {
      return {
        ...shared,
        strainScale: settings.shadeStrain ? strainCap / settings.contrast : 0,
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

    const source = settings.reliefSource;
    const values =
      source === 'angle'
        ? measured.angularDelta
        : source === 'strain'
          ? measured.strainDelta
          : measured.arealRatio;
    const range =
      source === 'angle'
        ? angleRange
        : source === 'strain'
          ? meshRange(measured, measured.strainDelta, mesh.count, 0.05) / settings.contrast
          : areaRange;
    return {
      ...shared,
      source,
      values,
      range,
      flat: spread(measured, values, mesh.count) < FLAT_FLOOR[source],
      radii: reliefRadii(mesh, values, { range, amplitude: exaggeration }),
    };
  }, [mesh, measured, clothMesh, clothField, pair, areaRange, angleRange, strainCap, sheets, settings]);

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
