import { getSafeTop } from '../ui/SafeArea';

export interface Scene {
  enter(): void;
  exit(): void;
  update(dt: number): void;
  render(ctx: CanvasRenderingContext2D): void;
  /** If true, SceneManager skips its own update/render (scene runs its own loop). */
  ownsLoop?: boolean;
}

interface ToastParticle {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  size: number;
  color: string;
  type: 'spark' | 'star' | 'glow' | 'confetti';
  rot?: number;       // confetti rotation
  rotSpeed?: number;  // confetti spin speed
  wobble?: number;    // confetti horizontal wobble phase
}

interface Toast {
  text: string;
  subtext: string;
  timer: number;       // ms remaining
  fadeIn: number;       // 0→1
  particles: ToastParticle[];
  burstSpawned: boolean;
  glowPhase: number;
}

const TOAST_DURATION = 5000;
const TOAST_FADE_IN = 400;
const TOAST_FADE_OUT = 600;

const GOLD_COLORS = ['#ffd740', '#ffab00', '#ffe082', '#fff176', '#ffca28'];
const STAR_COLORS = ['#fff', '#ffd740', '#ffe082', '#ffeb3b'];
const CONFETTI_COLORS = ['#ff4081', '#448aff', '#ffd740', '#69f0ae', '#ea80fc', '#ff6e40', '#40c4ff', '#ffff00'];

export class SceneManager {
  private currentScene: Scene | null = null;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private running = false;
  private lastTime = 0;
  private scenes = new Map<string, Scene>();
  private currentName = '';
  private toasts: Toast[] = [];
  private onToastShow: (() => void) | null = null;
  private toastSlideY = -70; // current toast Y for hit-testing

  private resizeHandler = () => this.resizeCanvas();
  private toastClickHandler = (e: MouseEvent) => this.dismissToastAt(e.clientX, e.clientY);
  private toastTouchHandler = (e: TouchEvent) => {
    const t = e.touches[0] ?? e.changedTouches[0];
    if (t && this.dismissToastAt(t.clientX, t.clientY)) e.preventDefault();
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.resizeCanvas();
    window.addEventListener('resize', this.resizeHandler);
    this.canvas.addEventListener('click', this.toastClickHandler);
    this.canvas.addEventListener('touchstart', this.toastTouchHandler, { passive: false });
  }

  dispose(): void {
    this.running = false;
    window.removeEventListener('resize', this.resizeHandler);
    this.canvas.removeEventListener('click', this.toastClickHandler);
    this.canvas.removeEventListener('touchstart', this.toastTouchHandler);
  }

  private resizeCanvas(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(window.innerWidth * dpr);
    const h = Math.round(window.innerHeight * dpr);
    // Only set dimensions when they actually change — setting canvas.width
    // clears the buffer, which would blank the screen every frame.
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.style.width = window.innerWidth + 'px';
      this.canvas.style.height = window.innerHeight + 'px';
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  register(name: string, scene: Scene): void {
    this.scenes.set(name, scene);
  }

  switchTo(name: string): void {
    if (this.currentScene) {
      this.currentScene.exit();
    }
    this.currentScene = this.scenes.get(name) ?? null;
    this.currentName = name;
    if (this.currentScene) {
      this.currentScene.enter();
    }
  }

  get active(): string {
    return this.currentName;
  }

  /** Register a callback invoked when a toast first appears (for sound). */
  setOnToastShow(cb: () => void): void {
    this.onToastShow = cb;
  }

  showToast(text: string, subtext = ''): void {
    this.toasts.push({
      text, subtext,
      timer: TOAST_DURATION,
      fadeIn: 0,
      particles: [],
      burstSpawned: false,
      glowPhase: 0,
    });
  }

  private dismissToastAt(clientX: number, clientY: number): boolean {
    if (this.toasts.length === 0) return false;
    const rect = this.canvas.getBoundingClientRect();
    const cx = clientX - rect.left;
    const cy = clientY - rect.top;
    const W = this.canvas.clientWidth;
    const toastW = Math.min(460, W - 40);
    const toastH = 70;
    const toastX = (W - toastW) / 2;
    const pad = 10;
    if (cx >= toastX - pad && cx <= toastX + toastW + pad &&
        cy >= this.toastSlideY - pad && cy <= this.toastSlideY + toastH + pad) {
      // Trigger quick fade-out
      const toast = this.toasts[0];
      if (toast.timer > TOAST_FADE_OUT) {
        toast.timer = TOAST_FADE_OUT;
      }
      return true;
    }
    return false;
  }

  start(initialScene: string): void {
    this.switchTo(initialScene);
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  private loop(time: number): void {
    if (!this.running) return;
    const dt = Math.min(time - this.lastTime, 200);
    this.lastTime = time;

    this.resizeCanvas();

    if (this.currentScene && !this.currentScene.ownsLoop) {
      // Apply DPR base transform before every render so scenes draw in CSS-pixel coords
      const dpr = window.devicePixelRatio || 1;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.currentScene.update(dt);
      this.currentScene.render(this.ctx);
    }

    // ── Toast overlay ──
    this.updateAndRenderToasts(dt);

    requestAnimationFrame((t) => this.loop(t));
  }

  private spawnBurst(toast: Toast, cx: number, cy: number, w: number): void {
    // Big initial burst of sparks and stars
    for (let i = 0; i < 28; i++) {
      const angle = (Math.PI * 2 * i) / 28 + (Math.random() - 0.5) * 0.4;
      const speed = 60 + Math.random() * 120;
      const sparkLife = 800 + Math.random() * 600;
      toast.particles.push({
        x: cx + (Math.random() - 0.5) * w * 0.6,
        y: cy + (Math.random() - 0.5) * 20,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 30,
        life: sparkLife, maxLife: sparkLife,
        size: 2 + Math.random() * 3,
        color: GOLD_COLORS[Math.floor(Math.random() * GOLD_COLORS.length)],
        type: 'spark',
      });
    }
    // Star particles
    for (let i = 0; i < 8; i++) {
      const starLife = 1200 + Math.random() * 800;
      toast.particles.push({
        x: cx + (Math.random() - 0.5) * w * 0.8,
        y: cy + (Math.random() - 0.5) * 30,
        vx: (Math.random() - 0.5) * 60,
        vy: -40 - Math.random() * 80,
        life: starLife, maxLife: starLife,
        size: 6 + Math.random() * 6,
        color: STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)],
        type: 'star',
      });
    }
    // Glow orbs
    for (let i = 0; i < 5; i++) {
      const glowLife = 1500 + Math.random() * 500;
      toast.particles.push({
        x: cx + (Math.random() - 0.5) * w * 0.4,
        y: cy,
        vx: (Math.random() - 0.5) * 30,
        vy: -20 - Math.random() * 40,
        life: glowLife, maxLife: glowLife,
        size: 10 + Math.random() * 8,
        color: '#ffd740',
        type: 'glow',
      });
    }
    // Confetti burst
    for (let i = 0; i < 40; i++) {
      const angle = (Math.random() - 0.5) * Math.PI * 1.4 - Math.PI / 2;
      const speed = 80 + Math.random() * 200;
      const confLife = 2500 + Math.random() * 1500;
      toast.particles.push({
        x: cx + (Math.random() - 0.5) * w * 0.3,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 60,
        life: confLife, maxLife: confLife,
        size: 4 + Math.random() * 4,
        color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
        type: 'confetti',
        rot: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 12,
        wobble: Math.random() * Math.PI * 2,
      });
    }
  }

  private spawnAmbientSparkles(toast: Toast, cx: number, cy: number, w: number, h: number, dt: number): void {
    // Continuous trickle of sparkles while visible (~18/sec, frame-rate independent)
    if (Math.random() < 1 - Math.pow(0.7, dt / 16.67)) {
      const ambLife = 600 + Math.random() * 400;
      toast.particles.push({
        x: cx + (Math.random() - 0.5) * w,
        y: cy + (Math.random() - 0.5) * h,
        vx: (Math.random() - 0.5) * 20,
        vy: -15 - Math.random() * 25,
        life: ambLife, maxLife: ambLife,
        size: 1.5 + Math.random() * 2,
        color: GOLD_COLORS[Math.floor(Math.random() * GOLD_COLORS.length)],
        type: 'spark',
      });
    }
  }

  private updateAndRenderToasts(dt: number): void {
    if (this.toasts.length === 0) return;

    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const W = this.canvas.clientWidth;
    const toastW = Math.min(460, W - 40);
    const toastH = 70;
    const toastX = (W - toastW) / 2;

    // Only show the first toast at a time
    const toast = this.toasts[0];
    toast.timer -= dt;
    toast.fadeIn = Math.min(1, toast.fadeIn + dt / TOAST_FADE_IN);
    toast.glowPhase += dt * 0.003;

    const safeTop = getSafeTop();

    // Fire sound + burst on first visible frame
    if (!toast.burstSpawned && toast.fadeIn > 0) {
      toast.burstSpawned = true;
      const cx = W / 2;
      const cy = safeTop + 12 + toastH / 2;
      this.spawnBurst(toast, cx, cy, toastW);
      this.onToastShow?.();
    }

    // Calculate opacity: fade in, hold, fade out
    let alpha: number;
    if (toast.timer <= 0) {
      alpha = 0;
    } else if (toast.timer < TOAST_FADE_OUT) {
      alpha = toast.timer / TOAST_FADE_OUT;
    } else {
      alpha = toast.fadeIn;
    }

    if (toast.timer <= 0) {
      this.toasts.shift();
      return;
    }

    // Slide down from top with bounce
    const slideProgress = Math.min(1, toast.fadeIn * 1.2);
    const bounce = slideProgress < 1
      ? 1 - Math.pow(1 - slideProgress, 3) * (1 + 2.5 * (1 - slideProgress))
      : 1;
    const toastRestY = safeTop + 12;
    const slideY = -toastH + (toastRestY + toastH) * bounce;
    this.toastSlideY = slideY;

    const cx = toastX + toastW / 2;
    const cy = slideY + toastH / 2;

    // Spawn ambient sparkles
    if (alpha > 0.5) {
      this.spawnAmbientSparkles(toast, cx, cy, toastW, toastH, dt);
    }

    // Update particles
    const dtSec = dt / 1000;
    toast.particles = toast.particles.filter(p => {
      p.life -= dt;
      if (p.life <= 0) return false;
      p.x += p.vx * dtSec;
      p.y += p.vy * dtSec;
      if (p.type === 'confetti') {
        p.vy += 80 * dtSec;  // heavier gravity for confetti
        p.vx *= 0.99;
        p.vx += Math.sin(p.wobble! + p.life * 0.005) * 30 * dtSec; // lateral wobble
        p.rot! += p.rotSpeed! * dtSec;
      } else {
        p.vy += 40 * dtSec;
        p.vx *= 0.995;
      }
      return true;
    });

    // ── Render particles behind toast ──
    ctx.save();
    for (const p of toast.particles) {
      const pAlpha = (p.life / p.maxLife) * alpha;
      if (pAlpha < 0.01) continue;

      ctx.globalAlpha = pAlpha;

      if (p.type === 'glow') {
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
        grad.addColorStop(0, p.color);
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === 'star') {
        ctx.fillStyle = p.color;
        this.drawStar(ctx, p.x, p.y, p.size * 0.4, p.size, 4);
      } else if (p.type === 'confetti') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot!);
        // Flatten based on rotation to simulate 3D tumble
        const scaleX = Math.abs(Math.cos(p.rot! * 2));
        ctx.scale(Math.max(0.2, scaleX), 1);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6);
        ctx.restore();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    // ── Render toast panel ──
    ctx.save();
    ctx.globalAlpha = alpha;

    // Outer glow
    const glowIntensity = 0.15 + 0.1 * Math.sin(toast.glowPhase);
    const glow = ctx.createRadialGradient(cx, cy, toastW * 0.2, cx, cy, toastW * 0.7);
    glow.addColorStop(0, `rgba(255, 215, 64, ${glowIntensity})`);
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.fillRect(toastX - 40, slideY - 30, toastW + 80, toastH + 60);

    // Background with slight gradient
    const bgGrad = ctx.createLinearGradient(toastX, slideY, toastX, slideY + toastH);
    bgGrad.addColorStop(0, 'rgba(45, 35, 20, 0.95)');
    bgGrad.addColorStop(1, 'rgba(30, 22, 12, 0.95)');
    ctx.fillStyle = bgGrad;
    ctx.beginPath();
    ctx.roundRect(toastX, slideY, toastW, toastH, 12);
    ctx.fill();

    // Gold border with glow pulse
    const borderAlpha = 0.7 + 0.3 * Math.sin(toast.glowPhase * 1.5);
    ctx.strokeStyle = `rgba(255, 215, 64, ${borderAlpha})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(toastX, slideY, toastW, toastH, 12);
    ctx.stroke();

    // Inner highlight line at top
    ctx.strokeStyle = 'rgba(255, 235, 150, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(toastX + 2, slideY + 2, toastW - 4, toastH - 4, 10);
    ctx.stroke();

    // Star icon with pulse
    const starScale = 1 + 0.08 * Math.sin(toast.glowPhase * 2);
    const starX = toastX + 24;
    const starY = slideY + toastH / 2;
    ctx.fillStyle = '#ffd740';
    ctx.save();
    ctx.translate(starX, starY);
    ctx.scale(starScale, starScale);
    this.drawStar(ctx, 0, 0, 6, 14, 5);
    ctx.restore();

    // Title text
    ctx.font = 'bold 20px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffd740';
    ctx.fillText(toast.text, toastX + 50, slideY + (toast.subtext ? 24 : toastH / 2));

    // Subtext
    if (toast.subtext) {
      ctx.font = '14px monospace';
      ctx.fillStyle = '#c8b88a';
      ctx.fillText(toast.subtext, toastX + 50, slideY + 48);
    }

    ctx.restore();
  }

  private drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, innerR: number, outerR: number, points: number): void {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const angle = (Math.PI * i) / points - Math.PI / 2;
      const r = i % 2 === 0 ? outerR : innerR;
      if (i === 0) ctx.moveTo(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
      else ctx.lineTo(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
    }
    ctx.closePath();
    ctx.fill();
  }
}
