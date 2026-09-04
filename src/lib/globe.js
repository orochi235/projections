/**
 * A displaced sphere, prepared for drawing. Pure geometry: no canvas, no React.
 *
 * The mesh is a lon/lat lattice whose vertices carry a radius, so a caller can
 * push the surface in and out to stand for whatever it is measuring. What comes
 * back is screen coordinates, the quads that face the camera sorted far to
 * near, and a Lambert term per quad.
 *
 * View space is right-handed with x right, y up and z toward the camera. Screen
 * space flips y and applies the scale. Normals and lighting stay in view space;
 * mixing the two is how shading silently stops meaning anything.
 */

const RADIANS = Math.PI / 180;
const LIGHT = normalize([-0.4, 0.62, 0.68]);
const AMBIENT = 0.34;

function normalize(v) {
  const length = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / length, v[1] / length, v[2] / length];
}

/** Lattice from the north pole down, matching sampleField's row order. */
export function sphereMesh(columns, rows) {
  const count = (columns + 1) * (rows + 1);
  const lon = new Float64Array(count);
  const lat = new Float64Array(count);
  const ux = new Float64Array(count);
  const uy = new Float64Array(count);
  const uz = new Float64Array(count);

  let n = 0;
  for (let j = 0; j <= rows; j++) {
    const latitude = 90 - (180 * j) / rows;
    const phi = latitude * RADIANS;
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);
    for (let i = 0; i <= columns; i++) {
      const longitude = -180 + (360 * i) / columns;
      const lambda = longitude * RADIANS;
      lon[n] = longitude;
      lat[n] = latitude;
      ux[n] = cosPhi * Math.sin(lambda);
      uy[n] = sinPhi;
      uz[n] = cosPhi * Math.cos(lambda);
      n++;
    }
  }
  return { columns, rows, count, lon, lat, ux, uy, uz };
}

/** Every vertex on the undisplaced sphere. */
export function unitRadii(mesh) {
  return new Float64Array(mesh.count).fill(1);
}

/**
 * Turns a camera description into the two transforms everything else uses:
 * `view` rotates a point on the globe, `screen` places a view-space point on
 * the canvas.
 */
export function camera({ yaw = 0, pitch = 0, scale = 1, cx = 0, cy = 0 }) {
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);

  return {
    scale,
    cx,
    cy,
    view(x, y, z, out) {
      const rx = x * cosYaw + z * sinYaw;
      const rz = -x * sinYaw + z * cosYaw;
      out[0] = rx;
      out[1] = y * cosPitch - rz * sinPitch;
      out[2] = y * sinPitch + rz * cosPitch;
      return out;
    },
    screenX: (x) => cx + x * scale,
    screenY: (y) => cy - y * scale,
  };
}

/**
 * Transforms the mesh for one camera and returns the quads worth drawing.
 *
 * `order` holds quad indices sorted back to front, so a painter's-algorithm
 * pass can walk it straight through. A caller that has moved its vertices off
 * their own meridians — a draped sheet gathers sideways, not just outward —
 * passes `points` instead of leaning on `radii`.
 */
export function buildFrame(mesh, radii, cam, points) {
  const { columns, rows, count, ux, uy, uz } = mesh;

  const vx = new Float64Array(count);
  const vy = new Float64Array(count);
  const vz = new Float64Array(count);
  const sx = new Float64Array(count);
  const sy = new Float64Array(count);
  const point = [0, 0, 0];

  for (let n = 0; n < count; n++) {
    const r = radii ? radii[n] : 1;
    if (points) cam.view(points.x[n], points.y[n], points.z[n], point);
    else cam.view(ux[n] * r, uy[n] * r, uz[n] * r, point);
    vx[n] = point[0];
    vy[n] = point[1];
    vz[n] = point[2];
    sx[n] = cam.screenX(point[0]);
    sy[n] = cam.screenY(point[1]);
  }

  const quads = columns * rows;
  const depth = new Float64Array(quads);
  const shade = new Float32Array(quads);
  const facing = new Uint32Array(quads);
  let seen = 0;

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      const p0 = j * (columns + 1) + i;
      const p1 = p0 + 1;
      const p3 = p0 + columns + 1;
      const p2 = p3 + 1;

      // The winding runs east then south, whose cross product points into the
      // globe; negating it gives the outward normal and makes nz > 0 the
      // facing test.
      const ax = vx[p1] - vx[p0];
      const ay = vy[p1] - vy[p0];
      const az = vz[p1] - vz[p0];
      const bx = vx[p3] - vx[p0];
      const by = vy[p3] - vy[p0];
      const bz = vz[p3] - vz[p0];

      let nx = -(ay * bz - az * by);
      let ny = -(az * bx - ax * bz);
      let nz = -(ax * by - ay * bx);

      const length = Math.hypot(nx, ny, nz);
      if (length === 0) continue;
      nx /= length;
      ny /= length;
      nz /= length;
      if (nz <= 0) continue;

      const q = j * columns + i;
      const lambert = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
      depth[q] = (vz[p0] + vz[p1] + vz[p2] + vz[p3]) / 4;
      shade[q] = AMBIENT + (1 - AMBIENT) * lambert;
      facing[seen++] = q;
    }
  }

  const order = facing.subarray(0, seen);
  order.sort((a, b) => depth[a] - depth[b]);

  return { sx, sy, vz, depth, shade, order, columns, rows };
}

/** Corner vertex indices of quad `q`, starting at its north-west node. */
export function quadCorners(frame, q) {
  const i = q % frame.columns;
  const j = (q - i) / frame.columns;
  const p0 = j * (frame.columns + 1) + i;
  return [p0, p0 + 1, p0 + frame.columns + 2, p0 + frame.columns + 1];
}

/**
 * Places arbitrary locations on the same surface as the mesh, reading the
 * radius off it by bilinear interpolation so coastlines follow the displaced
 * ground instead of floating over it. `z` is negative behind the horizon.
 */
export function locator(mesh, radii, cam, points) {
  const { columns, rows } = mesh;
  const point = [0, 0, 0];

  const corner = (p0, fu, fv, axis) =>
    axis[p0] * (1 - fu) * (1 - fv) +
    axis[p0 + 1] * fu * (1 - fv) +
    axis[p0 + columns + 1] * (1 - fu) * fv +
    axis[p0 + columns + 2] * fu * fv;

  return (lon, lat) => {
    const u = ((lon + 180) / 360) * columns;
    const v = ((90 - lat) / 180) * rows;
    const i = Math.min(columns - 1, Math.max(0, Math.floor(u)));
    const j = Math.min(rows - 1, Math.max(0, Math.floor(v)));
    const fu = u - i;
    const fv = v - j;
    const p0 = j * (columns + 1) + i;
    if (points) {
      cam.view(corner(p0, fu, fv, points.x), corner(p0, fu, fv, points.y), corner(p0, fu, fv, points.z), point);
      return { x: cam.screenX(point[0]), y: cam.screenY(point[1]), z: point[2] };
    }

    const r = corner(p0, fu, fv, radii);

    const phi = lat * RADIANS;
    const lambda = lon * RADIANS;
    const cosPhi = Math.cos(phi);
    cam.view(cosPhi * Math.sin(lambda) * r, Math.sin(phi) * r, cosPhi * Math.cos(lambda) * r, point);

    return { x: cam.screenX(point[0]), y: cam.screenY(point[1]), z: point[2] };
  };
}
