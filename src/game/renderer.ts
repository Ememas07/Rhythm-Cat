import {
  GROUND_HEIGHT,
  PLAYFIELD_BOTTOM,
  PLAYFIELD_TOP,
  WORLD_HEIGHT,
} from './physics';
import type { CatSkinDefinition } from './skins';
import type {
  BossRuntimeState,
  CatPhysicsState,
  CollectibleNote,
  ObstacleGate,
} from './types';

export interface Particle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

export interface FloatingPop {
  active: boolean;
  x: number;
  y: number;
  vy: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
  scale: number;
}

const PARTICLE_POOL_SIZE = 160;
const POP_POOL_SIZE = 18;

export class GameRenderer {
  private particles: Particle[];
  private particleCursor = 0;
  private pops: FloatingPop[];
  private popCursor = 0;

  constructor() {
    this.particles = Array.from({ length: PARTICLE_POOL_SIZE }, () => ({
      active: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      maxLife: 1,
      size: 4,
      color: '#FFB830',
    }));
    this.pops = Array.from({ length: POP_POOL_SIZE }, () => ({
      active: false,
      x: 0,
      y: 0,
      vy: -50,
      text: '',
      color: '#FFFFFF',
      life: 0,
      maxLife: 0.7,
      scale: 1,
    }));
  }

  public clearEffects(): void {
    for (const p of this.particles) p.active = false;
    for (const pop of this.pops) pop.active = false;
  }

  public spawnBurst(
    x: number,
    y: number,
    color: string,
    count: number,
    speed = 190,
    size = 4.5,
  ): void {
    for (let i = 0; i < count; i++) {
      const p = this.particles[this.particleCursor];
      this.particleCursor = (this.particleCursor + 1) % PARTICLE_POOL_SIZE;
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
      const spd = speed * (0.45 + Math.random() * 0.75);
      p.active = true;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(angle) * spd;
      p.vy = Math.sin(angle) * spd - 35;
      p.life = 0;
      p.maxLife = 0.28 + Math.random() * 0.28;
      p.size = size * (0.7 + Math.random() * 0.6);
      p.color = color;
    }
  }

  public spawnPop(x: number, y: number, text: string, color: string, scale = 1): void {
    const pop = this.pops[this.popCursor];
    this.popCursor = (this.popCursor + 1) % POP_POOL_SIZE;
    pop.active = true;
    pop.x = x;
    pop.y = y;
    pop.vy = -58;
    pop.text = text;
    pop.color = color;
    pop.life = 0;
    pop.maxLife = 0.72;
    pop.scale = scale;
  }

  public updateEffects(dt: number): void {
    for (const p of this.particles) {
      if (!p.active) continue;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.active = false;
        continue;
      }
      p.vy += 320 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (const pop of this.pops) {
      if (!pop.active) continue;
      pop.life += dt;
      if (pop.life >= pop.maxLife) {
        pop.active = false;
        continue;
      }
      pop.y += pop.vy * dt;
      pop.vy *= Math.exp(-3 * dt);
    }
  }

  public renderFrame(
    ctx: CanvasRenderingContext2D,
    canvasWidth: number,
    canvasHeight: number,
    params: {
      worldWidth: number;
      songTime: number;
      scrollSpeed: number;
      beatProgress: number; // 0..1 within current beat
      catX: number;
      cat: CatPhysicsState;
      skin: CatSkinDefinition;
      gates: ObstacleGate[];
      notes: CollectibleNote[];
      boss: BossRuntimeState | null;
      shakeX: number;
      shakeY: number;
      isPlaying: boolean;
      accentColor: string;
    },
  ): void {
    const {
      worldWidth,
      songTime,
      scrollSpeed,
      beatProgress,
      catX,
      cat,
      skin,
      gates,
      notes,
      boss,
      shakeX,
      shakeY,
      isPlaying,
      accentColor,
    } = params;

    const scale = canvasHeight / WORLD_HEIGHT;

    ctx.save();
    ctx.scale(scale, scale);
    ctx.translate(shakeX, shakeY);

    // Beat pulse curve: sharpest right on the beat (beatProgress near 0 or 1)
    const beatPulse = Math.pow(Math.max(0, 1 - Math.min(beatProgress, 1 - beatProgress) * 4.5), 2);

    this.drawSkyAndParallax(ctx, worldWidth, songTime, scrollSpeed, beatPulse, accentColor);

    if (isPlaying) {
      this.drawGates(ctx, worldWidth, songTime, scrollSpeed, catX, gates, beatPulse, accentColor);
      this.drawNotes(ctx, worldWidth, songTime, scrollSpeed, catX, notes, beatPulse);
    }

    if (boss) {
      this.drawBossAndCombat(ctx, boss, songTime, beatPulse);
    }

    // Gaze-routed subtle beat ring around the sausage cat during gameplay
    if (isPlaying) {
      this.drawCatBeatGuide(ctx, catX, cat.y, beatProgress, beatPulse, accentColor);
    }

    this.drawSausageCat(ctx, cat, skin, songTime, beatPulse);
    this.drawGroundStaff(ctx, worldWidth, songTime, scrollSpeed, beatPulse, accentColor);
    this.drawParticlesAndPops(ctx);

    ctx.restore();
    void canvasWidth;
  }

  private cachedSkyGrad: CanvasGradient | null = null;
  private cachedSkyBottom = 0;

  private drawSkyAndParallax(
    ctx: CanvasRenderingContext2D,
    worldWidth: number,
    songTime: number,
    scrollSpeed: number,
    beatPulse: number,
    accentColor: string,
  ): void {
    // Rich twilight sky gradient (cached to avoid per-frame allocations)
    if (!this.cachedSkyGrad || this.cachedSkyBottom !== PLAYFIELD_BOTTOM) {
      const skyGrad = ctx.createLinearGradient(0, 0, 0, PLAYFIELD_BOTTOM);
      skyGrad.addColorStop(0, '#0F1326');
      skyGrad.addColorStop(0.55, '#19203E');
      skyGrad.addColorStop(1, '#272B4D');
      this.cachedSkyGrad = skyGrad;
      this.cachedSkyBottom = PLAYFIELD_BOTTOM;
    }
    ctx.fillStyle = this.cachedSkyGrad;
    ctx.fillRect(-30, -30, worldWidth + 60, PLAYFIELD_BOTTOM + 40);

    // Subtle beat-reactive ambient horizon glow
    if (beatPulse > 0.02) {
      ctx.save();
      ctx.globalAlpha = 0.08 * beatPulse;
      ctx.fillStyle = accentColor;
      ctx.fillRect(0, PLAYFIELD_BOTTOM - 160, worldWidth, 160);
      ctx.restore();
    }

    // Twinkling stars
    ctx.fillStyle = '#F7F2E7';
    for (let i = 0; i < 28; i++) {
      const sx = ((i * 173 + 47) % (worldWidth + 120)) - ((songTime * 10) % 120);
      const x = ((sx % worldWidth) + worldWidth) % worldWidth;
      const y = 38 + ((i * 89) % 260);
      const twinkle = 0.35 + 0.45 * Math.sin(songTime * 2.2 + i) + 0.2 * beatPulse;
      ctx.globalAlpha = Math.min(0.95, Math.max(0.15, twinkle));
      const r = i % 4 === 0 ? 2.2 : 1.4;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Warm crescent moon in upper right negative space (clean vector crescent, zero dark cutout artifact)
    const moonX = worldWidth * 0.78;
    const moonY = 112;
    ctx.save();
    ctx.globalAlpha = 0.14 + 0.06 * beatPulse;
    ctx.fillStyle = '#FDE68A';
    ctx.beginPath();
    ctx.arc(moonX, moonY, 52 + beatPulse * 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.94;
    ctx.fillStyle = '#FEF3C7';
    ctx.beginPath();
    ctx.arc(moonX, moonY, 33, Math.PI * 0.35, Math.PI * 1.65, false);
    ctx.bezierCurveTo(
      moonX - 18,
      moonY - 18,
      moonX - 18,
      moonY + 18,
      moonX + Math.cos(Math.PI * 0.35) * 33,
      moonY + Math.sin(Math.PI * 0.35) * 33,
    );
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Far skyline silhouette
    const farOffset = (songTime * scrollSpeed * 0.12) % 240;
    ctx.fillStyle = '#141933';
    for (let x = -farOffset - 240; x < worldWidth + 240; x += 120) {
      const idx = Math.round((x + farOffset) / 120);
      const h = 110 + ((Math.abs(idx * 53) % 5) * 32);
      ctx.fillRect(x, PLAYFIELD_BOTTOM - h, 108, h);
    }

    // Midground cozy rooftop townhouses with beat-pulsing lit windows
    const midOffset = (songTime * scrollSpeed * 0.28) % 320;
    for (let x = -midOffset - 320; x < worldWidth + 320; x += 160) {
      const idx = Math.round((x + midOffset) / 160);
      const h = 76 + ((Math.abs(idx * 37) % 4) * 28);
      const topY = PLAYFIELD_BOTTOM - h;
      ctx.fillStyle = '#1D2445';
      ctx.fillRect(x, topY, 144, h);
      // Roof cap
      ctx.fillStyle = '#29325C';
      ctx.fillRect(x - 4, topY - 6, 152, 8);

      // Warm lit windows
      for (let wy = topY + 16; wy < PLAYFIELD_BOTTOM - 22; wy += 26) {
        for (let wx = x + 16; wx < x + 122; wx += 30) {
          const lit = ((idx + wx + wy) % 3) !== 0;
          if (!lit) continue;
          ctx.fillStyle = (wx + idx) % 2 === 0 ? '#FBBF24' : '#FDE68A';
          ctx.globalAlpha = 0.25 + 0.28 * beatPulse;
          ctx.fillRect(wx, wy, 14, 16);
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  private drawGroundStaff(
    ctx: CanvasRenderingContext2D,
    worldWidth: number,
    songTime: number,
    scrollSpeed: number,
    beatPulse: number,
    accentColor: string,
  ): void {
    // Ground base
    ctx.fillStyle = '#101325';
    ctx.fillRect(-30, PLAYFIELD_BOTTOM, worldWidth + 60, GROUND_HEIGHT + 30);

    // Top trim rail
    ctx.fillStyle = '#2B335B';
    ctx.fillRect(-30, PLAYFIELD_BOTTOM, worldWidth + 60, 6);

    // Musical 5-line staff across the ground rail
    ctx.strokeStyle = 'rgba(247, 242, 231, 0.16)';
    ctx.lineWidth = 1.5;
    for (let l = 0; l < 5; l++) {
      const ly = PLAYFIELD_BOTTOM + 20 + l * 11;
      ctx.beginPath();
      ctx.moveTo(0, ly);
      ctx.lineTo(worldWidth, ly);
      ctx.stroke();
    }

    // Scrolling beat tick bars along the musical staff
    const step = 120;
    const offset = (songTime * scrollSpeed) % step;
    for (let x = -offset; x < worldWidth + step; x += step) {
      ctx.strokeStyle = accentColor;
      ctx.globalAlpha = 0.22 + 0.35 * beatPulse;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, PLAYFIELD_BOTTOM + 16);
      ctx.lineTo(x, PLAYFIELD_BOTTOM + 68);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private drawGates(
    ctx: CanvasRenderingContext2D,
    worldWidth: number,
    songTime: number,
    scrollSpeed: number,
    catX: number,
    gates: ObstacleGate[],
    beatPulse: number,
    accentColor: string,
  ): void {
    for (const gate of gates) {
      const gx = catX + (gate.time - songTime) * scrollSpeed;
      if (gx < -120 || gx > worldWidth + 120) continue;

      const left = gx - gate.width / 2;
      const gapTop = gate.gapCenterY - gate.gapHeight / 2;
      const gapBottom = gate.gapCenterY + gate.gapHeight / 2;

      const bodyColor = gate.hit ? '#7F1D1D' : gate.passed ? '#233554' : '#262F54';
      const highlightColor = gate.accented ? accentColor : '#64748B';
      const capHeight = 20;

      // Top organ pipe column
      this.drawPipeColumn(
        ctx,
        left,
        PLAYFIELD_TOP - 24,
        gate.width,
        gapTop - (PLAYFIELD_TOP - 24),
        bodyColor,
        highlightColor,
        'top',
        capHeight,
        beatPulse,
        gate.accented,
      );

      // Bottom organ pipe column
      this.drawPipeColumn(
        ctx,
        left,
        gapBottom,
        gate.width,
        PLAYFIELD_BOTTOM - gapBottom,
        bodyColor,
        highlightColor,
        'bottom',
        capHeight,
        beatPulse,
        gate.accented,
      );
    }
  }

  private drawPipeColumn(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    bodyColor: string,
    rimColor: string,
    side: 'top' | 'bottom',
    capHeight: number,
    beatPulse: number,
    accented: boolean,
  ): void {
    if (h <= 0) return;

    // Main shaft
    ctx.fillStyle = bodyColor;
    ctx.strokeStyle = '#0B0E1D';
    ctx.lineWidth = 3;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);

    // Vertical metallic sheen stripe
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(x + 10, y, 12, h);

    // Pipe collar cap near gap
    const capY = side === 'top' ? y + h - capHeight : y;
    ctx.fillStyle = '#33416E';
    ctx.fillRect(x - 6, capY, w + 12, capHeight);
    ctx.strokeRect(x - 6, capY, w + 12, capHeight);

    // Glowing beat-sync equalizer band on collar
    ctx.fillStyle = rimColor;
    ctx.globalAlpha = accented ? 0.65 + 0.35 * beatPulse : 0.4 + 0.3 * beatPulse;
    ctx.fillRect(x - 2, capY + 6, w + 4, 6);
    ctx.globalAlpha = 1;
  }

  private drawNotes(
    ctx: CanvasRenderingContext2D,
    worldWidth: number,
    songTime: number,
    scrollSpeed: number,
    catX: number,
    notes: CollectibleNote[],
    beatPulse: number,
  ): void {
    for (const note of notes) {
      if (note.collected) continue;
      const nx = catX + (note.time - songTime) * scrollSpeed;
      if (nx < -60 || nx > worldWidth + 60) continue;

      const r = note.radius + beatPulse * 2.5;
      ctx.save();
      ctx.translate(nx, note.y);

      if (note.isHazard) {
        // Red spiky discordant note (clearly distinct shape + color)
        ctx.fillStyle = 'rgba(239, 68, 68, 0.22)';
        ctx.beginPath();
        ctx.arc(0, 0, r + 7, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#EF4444';
        ctx.strokeStyle = '#1F0A0A';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4 + songTime * 2.5;
          const rad = i % 2 === 0 ? r + 3 : r - 4;
          const px = Math.cos(a) * rad;
          const py = Math.sin(a) * rad;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // 'X' glyph inside wrong note
        ctx.strokeStyle = '#FEF2F2';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(-5, -5);
        ctx.lineTo(5, 5);
        ctx.moveTo(5, -5);
        ctx.lineTo(-5, 5);
        ctx.stroke();
      } else {
        // Golden collectible beat note
        ctx.fillStyle = 'rgba(255, 184, 48, 0.22)';
        ctx.beginPath();
        ctx.arc(0, 0, r + 6, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#FFB830';
        ctx.strokeStyle = '#23192D';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Musical eighth-note icon inside
        ctx.fillStyle = '#23192D';
        ctx.beginPath();
        ctx.ellipse(-2, 4, 4.8, 3.5, -0.35, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(1.5, -8, 2.5, 12);
        ctx.beginPath();
        ctx.moveTo(2, -8);
        ctx.quadraticCurveTo(9, -6, 7, 0);
        ctx.lineWidth = 2.4;
        ctx.strokeStyle = '#23192D';
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  private drawCatBeatGuide(
    ctx: CanvasRenderingContext2D,
    catX: number,
    catY: number,
    beatProgress: number,
    beatPulse: number,
    accentColor: string,
  ): void {
    // Shrinking circular ring converging onto the cat right on the beat!
    const ringRadius = 26 + (1 - beatProgress) * 34;
    ctx.save();
    ctx.strokeStyle = beatPulse > 0.45 ? '#FDE047' : accentColor;
    ctx.globalAlpha = 0.22 + beatProgress * 0.35;
    ctx.lineWidth = beatPulse > 0.45 ? 3 : 1.8;
    ctx.beginPath();
    ctx.arc(catX, catY, ringRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawSausageCat(
    ctx: CanvasRenderingContext2D,
    cat: CatPhysicsState,
    skin: CatSkinDefinition,
    songTime: number,
    beatPulse: number,
  ): void {
    const spine = cat.spine;
    if (spine.length < 2) return;

    const hitBlink = cat.invulnTimer > 0 && Math.floor(cat.invulnTimer * 16) % 2 === 1;
    ctx.save();
    if (hitBlink) ctx.globalAlpha = 0.5;

    const head = spine[0];
    const tailBase = spine[spine.length - 1];

    // 1. Wiggling tail extending from the back of the sausage body
    const tailWag = Math.sin(songTime * 11 + beatPulse * 1.5) * 11;
    ctx.lineCap = 'round';
    ctx.strokeStyle = skin.outlineColor;
    ctx.lineWidth = 11;
    ctx.beginPath();
    ctx.moveTo(tailBase.x - 4, tailBase.y);
    ctx.quadraticCurveTo(tailBase.x - 24, tailBase.y - 12 + tailWag, tailBase.x - 36, tailBase.y - 4 - tailWag * 0.7);
    ctx.stroke();

    ctx.strokeStyle = skin.coatColor;
    ctx.lineWidth = 6.5;
    ctx.stroke();

    // 2. Four little stubby paddling paws beneath the sausage torso
    const pawSwing = Math.sin(songTime * 18) * 3.5;
    const rearPawNode = spine[Math.min(spine.length - 1, 4)];
    const frontPawNode = spine[1];
    const drawPaw = (px: number, py: number) => {
      ctx.fillStyle = skin.bellyColor;
      ctx.strokeStyle = skin.outlineColor;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(px, py, 6, 4.5, 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    };
    drawPaw(rearPawNode.x - 2, rearPawNode.y + 14 + pawSwing);
    drawPaw(rearPawNode.x + 7, rearPawNode.y + 13 - pawSwing);
    drawPaw(frontPawNode.x - 4, frontPawNode.y + 14 - pawSwing);
    drawPaw(frontPawNode.x + 5, frontPawNode.y + 13 + pawSwing);

    // 3. Long stretchy sausage torso along spine nodes (with outer ink outline + coat + belly)
    const drawSpinePath = () => {
      ctx.beginPath();
      ctx.moveTo(head.x, head.y);
      for (let i = 1; i < spine.length; i++) {
        ctx.lineTo(spine[i].x, spine[i].y);
      }
    };

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Outer outline
    drawSpinePath();
    ctx.strokeStyle = cat.hitFlashTimer > 0 ? '#FFFFFF' : skin.outlineColor;
    ctx.lineWidth = 37;
    ctx.stroke();

    // Coat fill
    drawSpinePath();
    ctx.strokeStyle = cat.hitFlashTimer > 0 ? '#FCA5A5' : skin.coatColor;
    ctx.lineWidth = 31;
    ctx.stroke();

    // Belly band along lower torso
    ctx.save();
    ctx.translate(0, 6);
    drawSpinePath();
    ctx.strokeStyle = skin.bellyColor;
    ctx.lineWidth = 13;
    ctx.stroke();
    ctx.restore();

    // 4. Coat patterns (stripes, spots, stars, tuxedo, baguette slashes)
    this.drawSkinPattern(ctx, spine, skin);

    // 5. Expressive cat head + ears + face + accessory at spine[0]
    ctx.save();
    ctx.translate(head.x + 2, head.y);
    ctx.rotate(cat.pitch);
    ctx.scale(cat.squashX, cat.squashY);

    // Back & front pointed ears
    const drawEar = (ex: number, ey: number, rot: number) => {
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(rot);
      ctx.fillStyle = skin.coatColor;
      ctx.strokeStyle = skin.outlineColor;
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.moveTo(-8, 4);
      ctx.lineTo(0, -13);
      ctx.lineTo(8, 4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = skin.earInnerColor;
      ctx.beginPath();
      ctx.moveTo(-4, 2);
      ctx.lineTo(0, -7);
      ctx.lineTo(4, 2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };
    drawEar(-4, -14, -0.22);
    drawEar(8, -14, 0.25);

    // Head circle
    ctx.fillStyle = cat.hitFlashTimer > 0 ? '#FCA5A5' : skin.coatColor;
    ctx.strokeStyle = skin.outlineColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(2, -1, 17.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Cheeks / muzzle highlight
    ctx.fillStyle = skin.bellyColor;
    ctx.beginPath();
    ctx.ellipse(9, 4, 8, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Eyes
    if (cat.hitFlashTimer > 0) {
      // Dizzy X eyes
      ctx.strokeStyle = skin.outlineColor;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(4, -7);
      ctx.lineTo(10, -1);
      ctx.moveTo(10, -7);
      ctx.lineTo(4, -1);
      ctx.stroke();
    } else if (cat.happyTimer > 0) {
      // Joyful curved '^' eye on beat jump!
      ctx.strokeStyle = skin.outlineColor;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(8, -3, 4.2, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#1E1B2E';
      ctx.beginPath();
      ctx.arc(8, -4, 3.6, 0, Math.PI * 2);
      ctx.fill();
      // Eye sparkle
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(9.2, -5.2, 1.3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Tiny pink nose + cute mouth
    ctx.fillStyle = '#FB7185';
    ctx.beginPath();
    ctx.arc(14, 2, 2.3, 0, Math.PI * 2);
    ctx.fill();

    // Whiskers
    ctx.strokeStyle = skin.outlineColor;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(13, 4);
    ctx.lineTo(24, 2);
    ctx.moveTo(13, 6);
    ctx.lineTo(23, 8);
    ctx.stroke();

    // Skin accessory
    this.drawCatAccessory(ctx, skin);

    ctx.restore();
    ctx.restore();
  }

  private drawSkinPattern(
    ctx: CanvasRenderingContext2D,
    spine: { x: number; y: number }[],
    skin: CatSkinDefinition,
  ): void {
    ctx.save();
    if (skin.pattern === 'stripes') {
      ctx.strokeStyle = skin.markingColor;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      for (let i = 1; i < spine.length - 1; i++) {
        const n = spine[i];
        ctx.beginPath();
        ctx.moveTo(n.x - 1, n.y - 13);
        ctx.lineTo(n.x + 2, n.y - 4);
        ctx.stroke();
      }
    } else if (skin.pattern === 'spots') {
      ctx.fillStyle = skin.markingColor;
      for (let i = 1; i < spine.length; i++) {
        const n = spine[i];
        const r = i % 2 === 0 ? 5.2 : 4;
        ctx.beginPath();
        ctx.arc(n.x, n.y - 5 + (i % 2) * 5, r, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (skin.pattern === 'stars') {
      ctx.fillStyle = skin.markingColor;
      for (let i = 1; i < spine.length; i++) {
        const n = spine[i];
        ctx.beginPath();
        ctx.arc(n.x - 2, n.y - 6 + (i % 2) * 6, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (skin.pattern === 'baguette') {
      // Diagonal bread score slashes
      ctx.strokeStyle = skin.markingColor;
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      for (let i = 1; i < spine.length - 1; i++) {
        const n = spine[i];
        ctx.beginPath();
        ctx.moveTo(n.x - 5, n.y - 11);
        ctx.lineTo(n.x + 5, n.y - 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawCatAccessory(ctx: CanvasRenderingContext2D, skin: CatSkinDefinition): void {
    switch (skin.accessory) {
      case 'bowtie': {
        ctx.fillStyle = '#EF4444';
        ctx.strokeStyle = '#111827';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-6, 13);
        ctx.lineTo(-14, 9);
        ctx.lineTo(-14, 17);
        ctx.closePath();
        ctx.moveTo(-6, 13);
        ctx.lineTo(2, 9);
        ctx.lineTo(2, 17);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      }
      case 'headphones': {
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.arc(1, -2, 19, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
        ctx.fillStyle = '#FF6B4A';
        ctx.strokeStyle = '#0F172A';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(-2, -1, 5.5, 7.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;
      }
      case 'beret': {
        ctx.fillStyle = '#F43F5E';
        ctx.strokeStyle = '#1E293B';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.ellipse(0, -17, 13, 6, -0.18, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;
      }
      case 'sunglasses': {
        ctx.fillStyle = '#0F172A';
        ctx.strokeStyle = '#FDE047';
        ctx.lineWidth = 1.8;
        ctx.fillRect(2, -8, 13, 7);
        ctx.strokeRect(2, -8, 13, 7);
        break;
      }
      case 'butter': {
        // Little pat of melting butter on the baguette cat's head
        ctx.fillStyle = '#FEF08A';
        ctx.strokeStyle = '#B45309';
        ctx.lineWidth = 2;
        ctx.fillRect(-5, -21, 13, 8);
        ctx.strokeRect(-5, -21, 13, 8);
        break;
      }
      case 'crown': {
        ctx.fillStyle = '#FACC15';
        ctx.strokeStyle = '#78350F';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(-8, -14);
        ctx.lineTo(-10, -27);
        ctx.lineTo(-2, -21);
        ctx.lineTo(2, -29);
        ctx.lineTo(6, -21);
        ctx.lineTo(13, -26);
        ctx.lineTo(10, -14);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      }
      case 'wizard': {
        ctx.fillStyle = '#4F46E5';
        ctx.strokeStyle = '#0F172A';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(-14, -14);
        ctx.lineTo(15, -14);
        ctx.lineTo(2, -37);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#FDE047';
        ctx.beginPath();
        ctx.arc(2, -23, 2.5, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      default:
        break;
    }
  }

  private drawBossAndCombat(
    ctx: CanvasRenderingContext2D,
    boss: BossRuntimeState,
    songTime: number,
    beatPulse: number,
  ): void {
    // 1. Draw player harmonic bolts
    for (const bolt of boss.playerBolts) {
      ctx.save();
      ctx.translate(bolt.x, bolt.y);
      ctx.fillStyle = bolt.isSuper ? '#FDE047' : '#38BDF8';
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, bolt.isSuper ? 10 : 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // 2. Draw boss telegraphs & active projectiles
    for (const p of boss.projectiles) {
      ctx.save();
      if (p.phase === 'windup') {
        const progress = 1 - p.windupTimer / Math.max(0.01, p.windupDuration);
        // Sightline warning across playfield
        ctx.strokeStyle = '#FB7185';
        ctx.globalAlpha = 0.25 + 0.45 * progress;
        ctx.lineWidth = p.kind === 'organ-beam' ? p.height * 0.65 : 3;
        ctx.setLineDash([12, 10]);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(40, p.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Telegraph ring at boss emitter
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = '#FDE047';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 12 + (1 - progress) * 26, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.translate(p.x, p.y);
        if (p.kind === 'vinyl-volley') {
          ctx.rotate(songTime * 14);
          ctx.fillStyle = '#111827';
          ctx.strokeStyle = '#EC4899';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#F472B6';
          ctx.beginPath();
          ctx.arc(0, 0, 6, 0, Math.PI * 2);
          ctx.fill();
        } else if (p.kind === 'organ-beam' || p.kind === 'bass-wave') {
          const halfH = p.height / 2;
          ctx.fillStyle = p.kind === 'organ-beam' ? '#A855F7' : '#EC4899';
          ctx.strokeStyle = '#FDF4FF';
          ctx.lineWidth = 2.5;
          ctx.fillRect(-p.radius, -halfH, p.radius * 2, p.height);
          ctx.strokeRect(-p.radius, -halfH, p.radius * 2, p.height);
        } else {
          ctx.fillStyle = '#F43F5E';
          ctx.strokeStyle = '#FFF1F2';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // 3. Draw Boss character silhouette
    ctx.save();
    ctx.translate(boss.x, boss.y);
    if (boss.isDefeated) {
      ctx.rotate(boss.koTimer * 5);
      ctx.globalAlpha = Math.max(0, 1 - boss.koTimer * 1.4);
    }

    const scaleBoost = 1 + beatPulse * 0.06;
    ctx.scale(scaleBoost, scaleBoost);

    const flash = boss.hitFlashTimer > 0;

    if (boss.id === 'metronome') {
      // Clockwork Brass Owl Metronome
      ctx.fillStyle = flash ? '#FFFFFF' : '#B45309';
      ctx.strokeStyle = '#1E1B2E';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(-42, 46);
      ctx.lineTo(42, 46);
      ctx.lineTo(24, -48);
      ctx.lineTo(-24, -48);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Swinging pendulum arm
      const swing = Math.sin(songTime * 6) * 0.48;
      ctx.save();
      ctx.translate(0, 26);
      ctx.rotate(swing);
      ctx.strokeStyle = '#FDE68A';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -64);
      ctx.stroke();
      ctx.fillStyle = '#FBBF24';
      ctx.beginPath();
      ctx.arc(0, -48, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Owl eyes
      ctx.fillStyle = '#FEF3C7';
      ctx.beginPath();
      ctx.arc(-13, -18, 10, 0, Math.PI * 2);
      ctx.arc(13, -18, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0F172A';
      ctx.beginPath();
      ctx.arc(-15, -18, 4.5, 0, Math.PI * 2);
      ctx.arc(11, -18, 4.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (boss.id === 'hairball') {
      // DJ Hairball: floating turntable phantom cat
      ctx.fillStyle = flash ? '#FFFFFF' : '#DB2777';
      ctx.strokeStyle = '#1E1B2E';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, 46, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Cat ears
      ctx.beginPath();
      ctx.moveTo(-34, -26);
      ctx.lineTo(-42, -58);
      ctx.lineTo(-10, -42);
      ctx.moveTo(10, -42);
      ctx.lineTo(42, -58);
      ctx.lineTo(34, -26);
      ctx.fill();
      ctx.stroke();

      // Turntable visor shades
      ctx.fillStyle = '#0F172A';
      ctx.fillRect(-34, -14, 52, 16);
      ctx.fillStyle = '#38BDF8';
      ctx.fillRect(-28, -9, 16, 6);
      ctx.fillRect(-4, -9, 16, 6);
    } else {
      // Maestro Pipe-Organ Kraken
      ctx.fillStyle = flash ? '#FFFFFF' : '#6D28D9';
      ctx.strokeStyle = '#0F172A';
      ctx.lineWidth = 4;
      // Brass organ pipes crown
      const pipeHeights = [36, 52, 66, 52, 36];
      pipeHeights.forEach((ph, idx) => {
        const px = -30 + idx * 14;
        ctx.fillStyle = flash ? '#FFFFFF' : '#F59E0B';
        ctx.fillRect(px, -30 - ph * 0.55, 10, ph * 0.65);
        ctx.strokeRect(px, -30 - ph * 0.55, 10, ph * 0.65);
      });

      ctx.fillStyle = flash ? '#FFFFFF' : '#7C3AED';
      ctx.beginPath();
      ctx.arc(0, 6, 44, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Glowing eyes
      ctx.fillStyle = '#FDE047';
      ctx.beginPath();
      ctx.arc(-16, 0, 7, 0, Math.PI * 2);
      ctx.arc(8, 0, 7, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  private drawParticlesAndPops(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      if (!p.active) continue;
      const alpha = Math.max(0, 1 - p.life / p.maxLife);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.4 + 0.6 * alpha), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const pop of this.pops) {
      if (!pop.active) continue;
      const t = pop.life / pop.maxLife;
      const alpha = t < 0.2 ? t / 0.2 : Math.max(0, 1 - (t - 0.2) / 0.8);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = `800 ${Math.round(20 * pop.scale)}px "Bricolage Grotesque", sans-serif`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#0F1326';
      ctx.strokeText(pop.text, pop.x, pop.y);
      ctx.fillStyle = pop.color;
      ctx.fillText(pop.text, pop.x, pop.y);
      ctx.restore();
    }
  }
}
