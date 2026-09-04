# Globe mode

A sixth mode for projection-diff: the comparison drawn on the sphere instead of
in the plane. For whoever implements it. Assumes you have read `distortion.js`
and `diff.js`.

The five existing modes all answer "what does the map do to the ground." Globe
mode answers the inverse — what the sphere would have to do to become the map.

## Three layers, one camera

| Layer | Surface | Signed? |
|---|---|---|
| **Relief** | `r = 1 + k·log2(arealA / arealB)` | yes — magenta out, teal in |
| **Wrinkle** | `r = 1 + A·carrier` | no — per map, two globes |
| **Arcs** | `r = 1`, great-circle stalks | n/a |

`k` is a user-facing exaggeration factor, the way vertical exaggeration works
on a terrain model; `carrier` is the oscillation defined below.

Relief and Arcs are diffs of the pair. Wrinkle is not, and cannot be: buckling
is a property of one map against the sphere. It draws two globes side by side —
A in magenta, B in teal — sharing one camera so they rotate together.

Layers compose. Wrinkle rides on top of Relief's displacement; Arcs overlay
either.

## Why the sheet buckles, and by how much

Where a map sheet must be **compressed** to lie on the globe, it sheds the
excess length out of plane. At each point the Tissot semi-axes are `a ≥ b`, so
along the major axis the sheet is `a` times too long.

A sinusoid `A·sin(2πx/λ)` has arc length `λ(1 + π²A²/λ²)`. Absorbing excess
strain `ε` therefore needs

```
A = (λ/π)·√ε        ε = max(a − 1, 0)
```

`λ` is a UI slider. Crests run perpendicular to the major axis.

Two consequences, both load-bearing:

**Equal-area projections still buckle.** They have `ab = 1` but `a ≠ b` — zero
area error, real length excess. The wrinkle field vanishes only at a
projection's standard points and lines, where `a = b = 1` and the map touches
the globe truly. This is the visible form of "nothing scores 0 on both."

**Where `a ≈ b` the excess is isotropic** and has no single crest direction.
Those regions take a sum of two perpendicular carriers — a crinkle like a leaf
edge, not parallel ruffles. Conformal maps are isotropic everywhere, so Mercator
crinkles where Mollweide ruffles.

## Rendering

Hand-rolled painter's algorithm on the existing 2D canvas. Measured in Chrome at
1° cells (360×180): 5.4 ms to transform, back-face cull and depth sort 65k
vertices; ~8 ms to fill the 32.4k surviving quads. About 70 fps, or 35 fps for
the two-globe wrinkle layer. 512×256 still drags at ~31 fps.

No WebGL and no new dependency. Flat fills and hairline strokes carry over from
the plane modes unchanged.

Lambert shading off the displaced normals is what makes relief read as relief.
The magenta/teal sign convention is the same one the flat Area map uses: a bulge
is magenta because A inflates that ground.

## Files

```
src/lib/globe.js       mesh, trackball rotation, cull, depth sort, screen
                       projection. Pure — no React, no DOM, no canvas.
src/lib/relief.js      the three fields above, as typed arrays
src/lib/distortion.js  + orientation of the Tissot major axis: the eigenvector
                       of JᵀJ for the larger eigenvalue
src/lib/render.js      + renderGlobe(), taking the same `state`
```

`sampleField` already emits `arealRatio` per node, so Relief needs no new
mathematics.

## Interaction

Drag to rotate. Longitude reuses `settings.rotate`, so the existing central
meridian slider and the drag stay in sync; `tilt` is new. The wrinkle scale
slider appears only in the wrinkle layer, alongside the existing sampling
control.

## Tests

Closed form, in the style of the existing suite:

- Mercator at the equator: wrinkle amplitude exactly 0, since `a = b = 1`
- Equirectangular at 60°: `a = 2` along the parallel, so crests run along
  meridians with amplitude `λ/π`
- Zero displacement leaves every mesh radius exactly 1
- The rotation matrix is orthonormal — chord lengths survive it
- Relief's sign at a node matches the flat Area map's sign at that node; the
  two views are not permitted to disagree
- Depth sort: no quad is drawn over one strictly nearer the camera

## Not in scope

A true cloth solve — nonlinear shell relaxation with self-contact — for the
wrinkle layer. The closed-form amplitude above is an approximation, and the UI
should say so the way the README already says it of Morph.
