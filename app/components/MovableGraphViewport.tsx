"use client";

import { type PointerEvent, type ReactNode, useRef, useState } from "react";

const MIN_ZOOM = 35;
const MAX_ZOOM = 180;

export function MovableGraphViewport({
  children,
  contentWidth,
  contentHeight,
  label,
}: {
  children: ReactNode;
  contentWidth: number;
  contentHeight: number;
  label: string;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null);
  const [zoom, setZoom] = useState(100);
  const [dragging, setDragging] = useState(false);

  function updateZoom(next: number) {
    const viewport = viewportRef.current;
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
    if (!viewport) {
      setZoom(clamped);
      return;
    }
    const centerX = viewport.scrollLeft + viewport.clientWidth / 2;
    const centerY = viewport.scrollTop + viewport.clientHeight / 2;
    const ratio = clamped / zoom;
    setZoom(clamped);
    requestAnimationFrame(() => {
      viewport.scrollLeft = centerX * ratio - viewport.clientWidth / 2;
      viewport.scrollTop = centerY * ratio - viewport.clientHeight / 2;
    });
  }

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, input, select, textarea, [role='button'], details, summary")) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
    };
    viewport.setPointerCapture(event.pointerId);
    setDragging(true);
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const viewport = viewportRef.current;
    if (!drag || !viewport || drag.pointerId !== event.pointerId) return;
    viewport.scrollLeft = drag.left - (event.clientX - drag.x);
    viewport.scrollTop = drag.top - (event.clientY - drag.y);
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
  }

  function resetView() {
    setZoom(100);
    requestAnimationFrame(() => {
      if (!viewportRef.current) return;
      viewportRef.current.scrollLeft = 0;
      viewportRef.current.scrollTop = 0;
    });
  }

  return (
    <section className="movable-graph-shell" aria-label={label}>
      <div className="movable-graph-toolbar">
        <span>拖动画布 · 滚动查看</span>
        <div>
          <button type="button" aria-label="缩小" title="缩小" onClick={() => updateZoom(zoom - 10)}>−</button>
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step="5"
            value={zoom}
            onChange={(event) => updateZoom(Number(event.target.value))}
            aria-label="图谱缩放"
          />
          <output>{zoom}%</output>
          <button type="button" onClick={resetView}>复位</button>
        </div>
      </div>
      <div
        ref={viewportRef}
        className={`movable-graph-viewport ${dragging ? "dragging" : ""}`}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div
          className="movable-graph-content"
          style={{ width: contentWidth * zoom / 100, height: contentHeight * zoom / 100 }}
        >
          <div style={{ width: contentWidth, height: contentHeight, transform: `scale(${zoom / 100})`, transformOrigin: "top left" }}>
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}
