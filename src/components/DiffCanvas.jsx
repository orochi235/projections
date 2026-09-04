import { useEffect, useRef } from 'react';
import { draw } from '../lib/render.js';

/**
 * Owns the drawing surface only. It reports its own pixel size upward so the
 * projections can be fitted to it, reports pointer position so the readout can
 * invert it back to a location on the globe, and reports drag deltas when the
 * mode has something to turn.
 */
export default function DiffCanvas({ size, onResize, onProbe, onDrag, ...state }) {
  const wrapperRef = useRef(null);
  const canvasRef = useRef(null);
  const dragRef = useRef(null);

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
        className={onDrag ? 'is-turnable' : undefined}
        style={{ width: `${size.width}px`, height: `${size.height}px` }}
        onPointerDown={(event) => {
          if (!onDrag) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (drag && onDrag) {
            onDrag(event.clientX - drag.x, event.clientY - drag.y);
            dragRef.current = { x: event.clientX, y: event.clientY };
            return;
          }
          const bounds = event.currentTarget.getBoundingClientRect();
          onProbe([event.clientX - bounds.left, event.clientY - bounds.top]);
        }}
        onPointerUp={(event) => {
          if (dragRef.current) event.currentTarget.releasePointerCapture(event.pointerId);
          dragRef.current = null;
        }}
        onPointerLeave={() => {
          dragRef.current = null;
          onProbe(null);
        }}
      />
    </div>
  );
}
