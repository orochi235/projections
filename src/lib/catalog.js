import {
  geoAzimuthalEqualAreaRaw,
  geoAzimuthalEquidistantRaw,
  geoEqualEarthRaw,
  geoEquirectangularRaw,
  geoMercatorRaw,
  geoNaturalEarth1Raw,
  geoTransverseMercatorRaw,
} from 'd3-geo';
import {
  geoAitoffRaw,
  geoBoggsRaw,
  geoBromleyRaw,
  geoCollignonRaw,
  geoCylindricalEqualAreaRaw,
  geoEckert4Raw,
  geoEckert6Raw,
  geoHammerRaw,
  geoMillerRaw,
  geoMollweideRaw,
  geoPolyconicRaw,
  geoRobinsonRaw,
  geoSinusoidalRaw,
  geoTimesRaw,
  geoVanDerGrintenRaw,
  geoWagner6Raw,
  geoWinkel3Raw,
} from 'd3-geo-projection';

const RADIANS = Math.PI / 180;

// Only whole-world projections belong here. Orthographic, gnomonic and
// stereographic show a hemisphere, less, or an unbounded plane, so a
// point-for-point comparison against a world map would either fold the far side
// of the globe onto the near side or fail to fit into any finite box at all.
export const CATALOG = [
  { id: 'equirectangular', name: 'Equirectangular', family: 'Cylindrical', raw: geoEquirectangularRaw },
  { id: 'mercator', name: 'Mercator', family: 'Cylindrical', raw: geoMercatorRaw, maxLat: 84 },
  { id: 'transverseMercator', name: 'Transverse Mercator', family: 'Cylindrical', raw: geoTransverseMercatorRaw, maxLat: 84 },
  { id: 'miller', name: 'Miller', family: 'Cylindrical', raw: geoMillerRaw },
  { id: 'gallPeters', name: 'Gall–Peters', family: 'Cylindrical', raw: geoCylindricalEqualAreaRaw(45 * RADIANS) },
  { id: 'lambertCylindrical', name: 'Lambert cylindrical', family: 'Cylindrical', raw: geoCylindricalEqualAreaRaw(0) },
  { id: 'behrmann', name: 'Behrmann', family: 'Cylindrical', raw: geoCylindricalEqualAreaRaw(30 * RADIANS) },

  { id: 'robinson', name: 'Robinson', family: 'Pseudocylindrical', raw: geoRobinsonRaw },
  { id: 'naturalEarth1', name: 'Natural Earth', family: 'Pseudocylindrical', raw: geoNaturalEarth1Raw },
  { id: 'equalEarth', name: 'Equal Earth', family: 'Pseudocylindrical', raw: geoEqualEarthRaw },
  { id: 'mollweide', name: 'Mollweide', family: 'Pseudocylindrical', raw: geoMollweideRaw },
  { id: 'sinusoidal', name: 'Sinusoidal', family: 'Pseudocylindrical', raw: geoSinusoidalRaw },
  { id: 'eckert4', name: 'Eckert IV', family: 'Pseudocylindrical', raw: geoEckert4Raw },
  { id: 'eckert6', name: 'Eckert VI', family: 'Pseudocylindrical', raw: geoEckert6Raw },
  { id: 'boggs', name: 'Boggs eumorphic', family: 'Pseudocylindrical', raw: geoBoggsRaw },
  { id: 'bromley', name: 'Bromley', family: 'Pseudocylindrical', raw: geoBromleyRaw },
  { id: 'wagner6', name: 'Wagner VI', family: 'Pseudocylindrical', raw: geoWagner6Raw },
  { id: 'times', name: 'Times', family: 'Pseudocylindrical', raw: geoTimesRaw },
  { id: 'collignon', name: 'Collignon', family: 'Pseudocylindrical', raw: geoCollignonRaw },

  { id: 'winkel3', name: 'Winkel tripel', family: 'Lenticular', raw: geoWinkel3Raw },
  { id: 'aitoff', name: 'Aitoff', family: 'Lenticular', raw: geoAitoffRaw },
  { id: 'hammer', name: 'Hammer', family: 'Lenticular', raw: geoHammerRaw(2, 2) },
  { id: 'vanDerGrinten', name: 'Van der Grinten', family: 'Lenticular', raw: geoVanDerGrintenRaw, maxLat: 84 },
  { id: 'polyconic', name: 'Polyconic', family: 'Lenticular', raw: geoPolyconicRaw },

  { id: 'azimuthalEqualArea', name: 'Azimuthal equal-area', family: 'Azimuthal', raw: geoAzimuthalEqualAreaRaw },
  { id: 'azimuthalEquidistant', name: 'Azimuthal equidistant', family: 'Azimuthal', raw: geoAzimuthalEquidistantRaw },
];

const BY_ID = new Map(CATALOG.map((entry) => [entry.id, entry]));

export function lookup(id) {
  const entry = BY_ID.get(id);
  if (!entry) throw new Error(`Unknown projection: ${id}`);
  return entry;
}

export const FAMILIES = [...new Set(CATALOG.map((entry) => entry.family))];
