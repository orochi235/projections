import { useEffect, useRef } from 'react';
import { draw } from '../lib/render.js';

/**
 * Owns the drawing surface only. It reports its own pixel size upward so the
 * projections can be fitted to it, and reports pointer position so the readout
 * can invert it back to a location on the globe.
 */
export default function DiffCanvas({ size, onResize, onProbe, ...state }) {
  const wrapperRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      onResize({ width: Math.round(width), height: Math.round(height) });
    });
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [onResize]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !state.pair || !state.field) return;

    const ratio = window.devicePixelRatio || 1;
    canvas.width = size.width * ratio;
    canvas.height = size.height * ratio;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    draw(ctx, size.width, size.height, state);
  });

  return (
    <div className="canvas-frame" ref={wrapperRef}>
      <canvas
        ref={canvasRef}
        style={{ width: `${size.width}px`, height: `${size.height}px` }}
        onPointerMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          onProbe([event.clientX - bounds.left, event.clientY - bounds.top]);
        }}
        onPointerLeave={() => onProbe(null)}
      />
    </div>
  );
}
