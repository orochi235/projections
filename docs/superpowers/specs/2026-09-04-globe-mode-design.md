# Globe mode

A sixth mode for projection-diff: the comparison drawn on the sphere instead of
in the plane. For whoever works on it next. Assumes you have read
`distortion.js` and `diff.js`.

The five flat modes all answer "what does the map do to the ground." Globe mode
answers the inverse — what the sphere would have to do to become the map.

## Three layers, one camera

| Layer | Surface | Signed? |
|---|---|---|
| **Relief** | `r = 1 + k·log2(arealA / arealB)` | yes — magenta out, teal in |
| **Wrinkle** | `r = 1 + A·carrier` | no — per map, two globes |
| **Reading error** | `r = 1`, great-circle arcs | n/a |

`k` is vertical exaggeration, as on a terrain model. Relief and Reading error
are diffs of the pair. Wrinkle is not, and cannot be: buckling is a property of
one map against the sphere, so it draws two globes side by side sharing one
camera.

Reading error runs each arc from a graticule node to `projB.invert(projA(node))`
— the ground map B really shows where map A shows that node. It is zero at the
equator for a Mercator/Equal Earth pair and grows poleward.

## Why the sheet buckles, and by how much

Where a map sheet must be **compressed** to lie on the globe it sheds the excess
length out of plane. At each point the Tissot semi-axes are `a ≥ b`, so along the
major axis the sheet is `a` times too long. A sinusoid `A·sin(2πx/λ)` has arc
length `λ(1 + π²A²/λ²)`, so absorbing strain `ε` needs

```
A = (λ/π)·√ε        ε = max(a − 1, 0)
```

capped so the slope never exceeds `MAX_SLOPE`. Past that a real sheet answers
more strain by folding finer rather than deeper, and one carrier just becomes
spikes the mesh cannot resolve.

Three things this got wrong first, all of which show up as pattern rather than
as error:

**The carriers crossfade; the phase does not steer.** Building the phase as
`cos(θ)·east + sin(θ)·north` only puts the gradient along the major axis while
`θ` is constant. On any pseudocylindrical map `θ` turns with longitude — the
meridians curve — so the gradient stops following the axis and the folds come
out as ripples spreading from the middle of the map. Two separately valid
carriers mixed by `cos²θ` have no such problem, and `cos²+sin² = 1` keeps the
peak at the amplitude the law asked for.

**`θ` is an axis, not a direction.** It is only known modulo π, so the carrier
has to be even in it or the wrap paints a seam wherever the major axis passes
180°.

**The fold count is fixed for the whole globe.** A whole number of folds must
close around a parallel or the antimeridian shows a seam; re-rounding that
number latitude by latitude jumps the phase and draws contour rings that are
pure arithmetic. Holding it constant makes folds run pole to pole and crowd
together as the parallels shorten, which is what gathered material does, and
takes fold spacing to nothing at the pole instead of leaving a spike.

Two consequences worth stating, because they are what the layer is for:

**Equal-area projections still buckle.** `ab = 1` kills the area error but not
the excess length: a sheet stretched one way and squeezed the other has the same
area and still cannot lie flat.

**The smooth region is a band, not a line.** After `areaNormalization` a map is
in tension near its standard region and in compression outside it, so the folds
begin at a definite parallel — about 55° for Mercator against Equal Earth — and
nothing ruffles inside that.

Where `a ≈ b` the excess has no preferred direction and those places take an
egg-carton of two perpendicular carriers instead. Their product, not their sum,
which would peak at √2 and overshoot the amplitude just derived. Conformal maps
are isotropic everywhere, so Mercator crinkles where Equal Earth ruffles.

## Rendering

Hand-rolled painter's algorithm on the existing 2D canvas: no WebGL, no new
dependency, and the flat fills carry over from the plane modes.

Cost is proportional to mesh size and it is nearly all canvas fill, so the mesh
slider is the frame-rate control. 180×90 drags comfortably; 360×180 does not, on
a 1136×846 canvas at devicePixelRatio 2. Two things matter more than they look:

- The quads are **filled, not stroked**. The flat modes stroke each cell in its
  own colour to close the seams between them; measured on this canvas that costs
  about four times the fill. On the globe neighbouring quads already share their
  corner vertices exactly.
- Ramp colours and Lambert shades are **quantized and memoized**. Interpolating
  the ramp and building an `rgb(...)` string per quad, tens of thousands of times
  a frame, is not free — though it turned out to be the smaller of the two.

## Files

```
src/lib/globe.js       mesh, camera, cull, depth sort, screen projection, and
                       `locator` for drawing coastlines on the displaced
                       surface. Pure — no React, no DOM, no canvas.
src/lib/relief.js      the three fields, plus the polar cap
src/lib/distortion.js  + `theta`, the Tissot major axis bearing
src/lib/palette.js     + `shade`, and quantized `divergingStep` / `shadeStep`
src/lib/render.js      + `renderGlobe`
```

Past the compared domain there is nothing to measure, and leaving those vertices
undisplaced opens a hole through a globe whose surface has moved. Each end is
capped with the mean of the nearest measured row, so it meets itself at the pole
instead of tearing; the cap stays outside `defined` and is greyed out.

## Traps

`scaleRaw` used to return a fresh wrapper on every call, so anything memoized on
the identity of `rawA` re-ran on every frame. `diff.js` now caches the wrapper,
not just the scale factor.

`topojson`'s `feature` returns a **FeatureCollection** even for one named object.
`geoPath` absorbs that silently; a hand-written ring walker does not, and the
coastlines simply fail to draw.

The Tissot semi-axes come from `sqrt(h² + k² − 2hk·sinθ)`, which cancels
catastrophically where a projection is conformal and leaves `a` about 1e-7 above
1 at a point that is exactly taut. `STRAIN_FLOOR` gates it.

## Not in scope

A true cloth solve — nonlinear shell relaxation with self-contact. The amplitude
law is an approximation and the legend says so, the way the README already does
of Morph.
