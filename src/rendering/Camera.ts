import { MAP_WIDTH, MAP_HEIGHT, TILE_SIZE } from '../simulation/types';
import { isoWorldBounds } from './Projection';

export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  private get maxZoom(): number { return this.isometric ? 5 : 3; }
  // Configurable world size (set via setWorldSize for non-default maps)
  worldTilesW = MAP_WIDTH;
  worldTilesH = MAP_HEIGHT;
  isometric = false;
  // Smooth pan target
  private panTargetX: number | null = null;
  private panTargetY: number | null = null;
  private panTargetZoom: number | null = null;

  private get minZoom(): number {
    let worldW: number, worldH: number;
    if (this.isometric) {
      const bounds = isoWorldBounds(this.worldTilesW, this.worldTilesH);
      worldW = bounds.width;
      worldH = bounds.height;
    } else {
      worldW = this.worldTilesW * TILE_SIZE;
      worldH = this.worldTilesH * TILE_SIZE;
    }
    // Iso: tighter minimum (less zoom-out), ortho: 5% padding
    const pad = this.isometric ? 1.25 : 1.10;
    return Math.min(this.canvas.clientWidth / (worldW * pad), this.canvas.clientHeight / (worldH * pad));
  }

  private keys = new Set<string>();
  private abortController = new AbortController();
  private isDragging = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchStartDist = 0;
  private pinchStartZoom = 1;
  private pinchCenterWorld: { x: number; y: number } | null = null;

  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.canvas.style.touchAction = 'none';
    this.setupInputs();
    // Start centered on the map, zoom clamped so full board is always reachable
    this.zoom = Math.max(this.minZoom, this.zoom);
    const worldW = this.worldTilesW * TILE_SIZE;
    const worldH = this.worldTilesH * TILE_SIZE;
    this.x = (worldW - (canvas.clientWidth || canvas.width) / this.zoom) / 2;
    this.y = (worldH - (canvas.clientHeight || canvas.height) / this.zoom) / 2;
  }

  destroy(): void {
    this.abortController.abort();
  }

  private setupInputs(): void {
    const c = this.canvas;
    const sig = { signal: this.abortController.signal };

    c.addEventListener('pointerdown', (e) => {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinchStartDist = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
        this.pinchStartZoom = this.zoom;
        const rect = c.getBoundingClientRect();
        const cx = ((a.x + b.x) / 2) - rect.left;
        const cy = ((a.y + b.y) / 2) - rect.top;
        this.pinchCenterWorld = this.screenToWorld(cx, cy);
        this.isDragging = false;
        return;
      }
      this.isDragging = true;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
    }, sig);

    c.addEventListener('pointermove', (e) => {
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        const dist = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
        const rect = c.getBoundingClientRect();
        const cx = ((a.x + b.x) / 2) - rect.left;
        const cy = ((a.y + b.y) / 2) - rect.top;
        const factor = dist / this.pinchStartDist;
        this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.pinchStartZoom * factor));
        const anchor = this.pinchCenterWorld ?? this.screenToWorld(cx, cy);
        this.x = anchor.x - cx / this.zoom;
        this.y = anchor.y - cy / this.zoom;
        this.clamp();
        return;
      }
      if (!this.isDragging) return;
      const dx = e.clientX - this.lastPointerX;
      const dy = e.clientY - this.lastPointerY;
      this.x -= dx / this.zoom;
      this.y -= dy / this.zoom;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
      this.clamp();
    }, sig);

    const endPointer = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinchCenterWorld = null;
      this.isDragging = false;
    };
    c.addEventListener('pointerup', endPointer, sig);
    c.addEventListener('pointercancel', endPointer, sig);
    c.addEventListener('pointerleave', endPointer, sig);

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      // Manual zoom cancels smooth pan
      this.panTargetX = null;
      this.panTargetY = null;
      this.panTargetZoom = null;
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      const rect = c.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      const worldX = this.x + cursorX / this.zoom;
      const worldY = this.y + cursorY / this.zoom;
      this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * zoomFactor));
      this.x = worldX - cursorX / this.zoom;
      this.y = worldY - cursorY / this.zoom;
      this.clamp();
    }, { passive: false, signal: sig.signal });

    window.addEventListener('keydown', (e) => this.keys.add(e.key.toLowerCase()), sig);
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()), sig);
  }

  private clamp(): void {
    let minX: number, minY: number, maxX: number, maxY: number;
    if (this.isometric) {
      const bounds = isoWorldBounds(this.worldTilesW, this.worldTilesH);
      minX = bounds.minX;
      minY = bounds.minY;
      maxX = bounds.maxX;
      maxY = bounds.maxY;
    } else {
      minX = 0;
      minY = 0;
      maxX = this.worldTilesW * TILE_SIZE;
      maxY = this.worldTilesH * TILE_SIZE;
    }
    const viewW = this.canvas.clientWidth / this.zoom;
    const viewH = this.canvas.clientHeight / this.zoom;
    const margin = 100;
    this.x = Math.max(minX - margin, Math.min(maxX - viewW + margin, this.x));
    this.y = Math.max(minY - margin, Math.min(maxY - viewH + margin, this.y));
  }

  /** Smoothly pan camera to center on a world-pixel position at a given zoom. */
  panTo(worldX: number, worldY: number, targetZoom?: number): void {
    this.panTargetX = worldX - this.canvas.clientWidth / (2 * (targetZoom ?? this.zoom));
    this.panTargetY = worldY - this.canvas.clientHeight / (2 * (targetZoom ?? this.zoom));
    this.panTargetZoom = targetZoom ?? null;
  }

  /** Call once per render frame to apply keyboard panning and smooth camera animation. */
  tick(): void {
    const panSpeed = 8;
    const hasKeyInput = this.keys.has('w') || this.keys.has('arrowup') ||
      this.keys.has('s') || this.keys.has('arrowdown') ||
      this.keys.has('a') || this.keys.has('arrowleft') ||
      this.keys.has('d') || this.keys.has('arrowright');

    if (hasKeyInput || this.isDragging) {
      // Manual input cancels smooth pan
      this.panTargetX = null;
      this.panTargetY = null;
      this.panTargetZoom = null;
    }

    if (this.keys.has('w') || this.keys.has('arrowup')) this.y -= panSpeed / this.zoom;
    if (this.keys.has('s') || this.keys.has('arrowdown')) this.y += panSpeed / this.zoom;
    if (this.keys.has('a') || this.keys.has('arrowleft')) this.x -= panSpeed / this.zoom;
    if (this.keys.has('d') || this.keys.has('arrowright')) this.x += panSpeed / this.zoom;

    // Smooth pan interpolation
    if (this.panTargetX !== null && this.panTargetY !== null) {
      const lerp = 0.12;
      this.x += (this.panTargetX - this.x) * lerp;
      this.y += (this.panTargetY - this.y) * lerp;
      if (this.panTargetZoom !== null) {
        this.zoom += (this.panTargetZoom - this.zoom) * lerp;
      }
      // Stop when close enough
      if (Math.abs(this.panTargetX - this.x) < 0.5 && Math.abs(this.panTargetY - this.y) < 0.5) {
        this.x = this.panTargetX;
        this.y = this.panTargetY;
        if (this.panTargetZoom !== null) this.zoom = this.panTargetZoom;
        this.panTargetX = null;
        this.panTargetY = null;
        this.panTargetZoom = null;
      }
    }

    this.clamp();
  }

  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: this.x + screenX / this.zoom,
      y: this.y + screenY / this.zoom,
    };
  }

  worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    return {
      x: (worldX - this.x) * this.zoom,
      y: (worldY - this.y) * this.zoom,
    };
  }

  applyTransform(ctx: CanvasRenderingContext2D): void {
    const dpr = window.devicePixelRatio || 1;
    const z = this.zoom * dpr;
    ctx.setTransform(z, 0, 0, z, -this.x * z, -this.y * z);
  }
}
