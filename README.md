# Projection diff

Two ways of flattening the same globe, and where they part company.

Pick any two whole-world map projections and the app renders the difference
between them four ways: as overlaid outlines, as a field showing how far every
point travels between the two, and as heat maps of which one inflates area more
and which one bends local shapes more. There is also a morph, which is the least
rigorous view and often the most legible.

```
npm install
npm run dev      # http://localhost:5173
npm test         # the distortion math, pinned to closed-form values
npm run report -- mercator equalEarth
```

## The modes

**Outlines** draws both maps on top of each other, each in its own colour, fitted
to the same box. Crude, immediate, and the right first look.

**Displacement** draws a stalk from each graticule node's position on the first
map to its position on the second. Length is how much the point moved; direction
is how. This is the view that shows *where* two projections disagree rather than
just how much.

**Area** and **Angle** are the quantitative views. Every cell of a lon/lat mesh
is coloured by the difference in local distortion between the two projections —
area as a log2 ratio, angle as a difference in degrees. Magenta means the first
projection is the more distorted one at that spot, teal means the second.

**Morph** blends the two raw projections and lets you scrub between them.

Both heat maps are drawn in the *first* projection's plane, so they read as "here
is where, on map A, the two disagree". Swapping the pair re-frames them.

## How the numbers are worked out

`src/lib/distortion.js` is the whole of the mathematics and is independent of
React and of the browser.

For a raw projection — a plain function from (λ, φ) in radians to plane
coordinates on the unit sphere — the Jacobian is taken by finite differences, and
from it come Snyder's local quantities: `h` the scale along the meridian, `k` the
scale along the parallel, the semi-axes `a` and `b` of the Tissot indicatrix,
the areal scale factor `a·b`, and the maximum angular deformation
`2·asin((a−b)/(a+b))`.

Two details that were not optional:

- **Area normalization.** d3's raw projections are each drawn at whatever plane
  scale their author picked, so their area factors are not comparable as
  shipped. `areaNormalization` integrates the projected area over the sphere and
  returns the scale factor that makes the map cover the same area as the unit
  sphere. After it, every equal-area projection reads exactly 1.000 everywhere,
  which is both correct and a useful self-check.
- **Non-differentiable points.** The antipode of an azimuthal projection is a
  single point on the globe that becomes the entire rim of the disc. d3 returns a
  finite coordinate there, so a plain central difference straddles the
  discontinuity and reports a derivative around 10¹⁰ — enough to swamp the
  global scores. `jacobian` computes both one-sided differences and discards the
  point when they disagree, which is what a discontinuity looks like and what
  ordinary curvature does not.

The global scores in the sidebar are root-mean-square values weighted by ground
area: RMS of `ln(area factor)`, so doubling and halving score alike, and RMS of
the maximum angular deformation. An equal-area projection scores 0 on the first,
a conformal one scores 0 on the second, and nothing scores 0 on both.

## Scope

The catalog holds whole-world projections only. Orthographic, gnomonic and
stereographic are deliberately absent: the first two show a hemisphere or less
and the third is unbounded, so a point-for-point comparison against a world map
would either fold the far side of the globe onto the near side or fail to fit
into any finite box.

Mercator, transverse Mercator and Van der Grinten are sampled to ±84°, and the
pair is always sampled to the stricter of the two limits so that both sides of a
comparison cover the same ground.

## Layout

```
src/lib/catalog.js      the projection list, with per-projection latitude limits
src/lib/distortion.js   Jacobian, Tissot, area normalization, morph
src/lib/diff.js         fits the pair to a shared box, samples the mesh, scores
src/lib/render.js       canvas drawing for each mode
src/lib/palette.js      the two hues and the diverging ramp
src/components/         controls, canvas, legend
scripts/report.mjs      the same comparison, headless
test/                   closed-form checks on the math
```

## Licence

MIT.
