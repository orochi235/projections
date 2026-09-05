# Projection diff

Two ways of flattening the same globe, and where they part company.

Pick any two whole-world map projections and the app renders the difference
between them four ways: as overlaid outlines, as a field showing how far every
point travels between the two, and as heat maps of which one inflates area more
and which one bends local shapes more. There is also a morph, which is the least
rigorous view and often the most legible, and a globe, which puts the whole
comparison back on the sphere.

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

**Globe** turns the comparison back into a solid. *Relief* pushes the surface out
where the first map is the worse of the two and pulls it in where the second is,
taking its height from the area ratio, the angle difference, or the difference in
how far each sheet has to stretch — the two wrinkle globes subtracted. That last
one is the only measure that never vanishes: two equal-area maps have an area
ratio of exactly 1 everywhere, so Relief on Equal Earth against Boggs eumorphic is
a featureless sphere until you take the height from stretch instead. *Wrinkle* lays each sheet back onto the
sphere: where it is too big to fit it has to ruffle, and since that is a property
of one map rather than of a pair it draws two globes side by side; colour there is
the local excess, white where the sheet lies on the sphere untouched. *Reading
error* runs an arc from each graticule node to the ground the second map really
shows there. Drag to turn it.

Both heat maps are drawn in the *first* projection's plane, so they read as "here
is where, on map A, the two disagree". Swapping the pair re-frames them.

Every colour scale is fitted to the pair, which flattens two projections that are
already close to each other. **Contrast** divides that full-scale value, up to
×16, so a pair like Robinson against Natural Earth still has structure to show.

## What the folds mean

A map sheet buckles where it must be compressed to lie on the globe. Along the
Tissot major axis the sheet is a factor `a` too long, and a sinusoid absorbs that
excess at amplitude `(λ/π)·√(a−1)`, so the fold depth is set by the strain and
the spacing is yours to choose.

Two readings fall out of that. Equal-area projections still buckle: `a·b = 1`
kills the area error but not the excess length, and a sheet stretched one way and
squeezed the other has the same area and still cannot lie flat. And because
`areaNormalization` fixes the plane scale, every map is in tension near its
standard region and in compression outside it — so the folds start at a definite
parallel, around 55° for Mercator, and nothing ruffles inside that.

Fold depth is a scaling law, held to a slope past which real material would fold
over instead. There was briefly a real cloth solver here — a relaxation that held
every edge at its printed length and pressed the sheet against the globe — and it
is gone, because the question it asks has no answer. A sheet has to be printed at
some size, and the size that never has to stretch is set by the ratio of the
map's largest local scale to its smallest, which lives at the pole where every
projection is pathological: 666% excess for Mercator, 6,074% for Equal Earth,
93,311% for the azimuthal equal-area. Print it smaller instead and an equal-area
map is over-long and under-long at the same point everywhere, because `a·b = 1`,
so the solver answers by shearing rather than folding. Neither picture is about
the projection; both are about a print scale nobody can justify.

What survives is the reading itself, and it is worth stating plainly: how well a
map drapes is not its area error or its angle error but how uniform its scale is.
Every projection in the catalogue except the conformal ones and Van der Grinten
needs at least a 5.5-to-1 stretch somewhere before it will lie flat.

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
src/lib/globe.js        sphere mesh, camera, depth sort, screen projection
src/lib/relief.js       the three globe fields: relief, wrinkle, arcs
src/lib/render.js       canvas drawing for each mode
src/lib/palette.js      the two hues and the diverging ramp
src/components/         controls, canvas, legend
scripts/report.mjs      the same comparison, headless
test/                   closed-form checks on the math
```

## Licence

MIT.
