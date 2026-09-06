(() => {
  'use strict';

  // ---- 설정값 (docs/01-dino-game-analysis.md 기준 원작 수치) ----
  const CONFIG = {
    WIDTH: 600,
    HEIGHT: 200,
    GROUND_LINE_Y: 177,
    GROUND_LINE_HEIGHT: 12,
    GROUND_BASE_Y: 190,
    FPS: 60,

    SPEED: 6,
    ACCELERATION: 0.001,
    MAX_SPEED: 13,

    GRAVITY: 0.6,
    JUMP_VELOCITY: -10,
    JUMP_CUTOFF_VELOCITY: -4,
    SPEED_DROP_COEFFICIENT: 3,

    TREX_X: 50,
    TREX_WIDTH: 34,
    TREX_HEIGHT: 36,
    TREX_WIDTH_DUCK: 46,
    TREX_HEIGHT_DUCK: 19,

    GAP_COEFFICIENT: 0.6,
    MAX_OBSTACLE_LENGTH: 3,
    MAX_OBSTACLE_DUPLICATION: 2,
    PTERODACTYL_MIN_SPEED: 8.5,
    MIN_OBSTACLE_GAP_FRAMES: 50, // 착지 후 재점프까지 최소 반응 시간 보장 (점프 궤적 ~24프레임 + 여유)

    MAX_HEARTS: 5,
    INVINCIBLE_FRAMES: 90, // 하트를 잃은 뒤 잠깐 무적 (연속으로 같은 장애물에 맞지 않도록)
    INVINCIBLE_ITEM_FRAMES: 420, // 무적 아이템: 7초
    INVINCIBLE_SCALE: 3, // 무적일 때 캐릭터를 이만큼 크게 그림
    WINGS_ITEM_FRAMES: 600, // 날개 아이템: 10초
    FLY_UP_SPEED: 2.4,
    FLY_FALL_SPEED: 0.9,
    DRONE_ITEM_FRAMES: 420, // 드론 아이템: 7초
    DRONE_FIRE_INTERVAL_FRAMES: 20, // 미사일 발사 간격

    HEART_SPAWN_INTERVAL_FRAMES: 900, // 하트 아이템: 15초마다 하나

    TANK_COIN_THRESHOLD: 28, // 코인 28개 이상 모으면 탱크 변신 (무적+드론)
    JET_COIN_THRESHOLD: 40, // 코인 40개 이상 모으면 전투기 변신 (날개+드론)
    COMBO_DURATION_FRAMES: 600, // 변신 지속시간: 10초

    SCORE_COEFFICIENT: 0.025,
    ACHIEVEMENT_DISTANCE: 100,

    NIGHT_MODE_ENABLED: false, // 밤 전환이 너무 잦다는 피드백으로 우선 비활성화, 항상 낮 유지
    INVERT_DISTANCE: 700,
    FADE_SPEED: 0.035,

    MAX_CLOUDS: 6,
    CLOUD_MIN_GAP: 100,
    CLOUD_MAX_GAP: 400,
    CLOUD_MIN_SKY_Y: 30,
    CLOUD_MAX_SKY_Y: 110,
    CLOUD_SPEED: 0.6,

    GAMEOVER_CLEAR_TIME: 750,
  };

  const OBSTACLE_TYPES = [
    { type: 'CACTUS_SMALL', width: 17, height: 35, y: 155, minGap: 120, minSpeed: 0, multipleSpeed: 4 },
    { type: 'CACTUS_LARGE', width: 25, height: 50, y: 140, minGap: 120, minSpeed: 0, multipleSpeed: 7 },
    { type: 'PTERODACTYL', width: 46, height: 40, y: [150, 125, 100], minGap: 150, minSpeed: 8.5, multipleSpeed: 999 },
  ];

  // 동전: 값이 클수록 반지름이 큼. y는 세 가지 높이(달리기/한번점프/풀점프) 중 하나
  const COIN_TYPES = [
    { value: 1, radius: 7 },
    { value: 3, radius: 10 },
    { value: 5, radius: 13 },
  ];
  const COIN_LANES_Y = [170, 130, 85];
  const COIN_SPAWN_INTERVAL_FRAMES = 600; // 10초(60fps 기준)마다 한 무리
  const COIN_BATCH_SIZE = 5;
  const COIN_OBSTACLE_MARGIN = 150; // 장애물 근처에는 이 거리 안에 동전을 스폰하지 않음
  const MAX_COINS_ON_SCREEN = 20;

  // 아이템: 무적(★, 보라) / 날개(◆, 파랑) / 드론(기관총, 회색) / 하트(빨강, 별도 타이머)
  const ITEM_KINDS = ['invincible', 'wings', 'drone'];
  const ITEM_SPAWN_INTERVAL_FRAMES = 900; // 15초마다 하나
  const ITEM_OBSTACLE_MARGIN = 130;
  const MAX_ITEMS_ON_SCREEN = 2;

  const rand = (min, max) => Math.random() * (max - min) + min;
  const randInt = (min, max) => Math.floor(rand(min, max + 1));

  // ---- 사운드 (Web Audio API 비프음, 외부 파일 불필요) ----
  const Sound = {
    ctx: null,
    ensureCtx() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },
    beep(freq, duration, type, volume) {
      this.beepAt(freq, duration, type, volume, this.ensureCtx().currentTime);
    },
    beepAt(freq, duration, type, volume, time) {
      try {
        const ctx = this.ensureCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(volume, time);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
        osc.connect(gain).connect(ctx.destination);
        osc.start(time);
        osc.stop(time + duration);
      } catch (e) { /* 오디오 미지원 환경은 조용히 무시 */ }
    },
    jump() { this.beep(520, 0.09, 'square', 0.12); },
    achievement() {
      this.beep(880, 0.1, 'square', 0.13);
      setTimeout(() => this.beep(1320, 0.12, 'square', 0.12), 90);
    },
    hit() { this.beep(110, 0.28, 'sawtooth', 0.18); },
    hurt() { this.beep(220, 0.15, 'sawtooth', 0.15); },
    machineGun() {
      const ctx = this.ensureCtx();
      const now = ctx.currentTime;
      for (let i = 0; i < 4; i++) {
        this.beepAt(130 + Math.random() * 50, 0.02, 'square', 0.09, now + i * 0.025);
      }
    },
    explode() { this.beep(90, 0.2, 'sawtooth', 0.14); },
    smash() {
      const ctx = this.ensureCtx();
      const now = ctx.currentTime;
      this.beepAt(200, 0.05, 'square', 0.15, now);
      this.beepAt(100, 0.09, 'sawtooth', 0.13, now + 0.03);
    },
    heal() {
      const ctx = this.ensureCtx();
      const now = ctx.currentTime;
      this.beepAt(659.25, 0.1, 'sine', 0.15, now);
      this.beepAt(880.0, 0.14, 'sine', 0.16, now + 0.1);
    },
    vehicle() {
      const ctx = this.ensureCtx();
      const now = ctx.currentTime;
      this.beepAt(110, 0.12, 'sawtooth', 0.15, now);
      this.beepAt(220, 0.12, 'sawtooth', 0.15, now + 0.1);
      this.beepAt(440, 0.18, 'square', 0.16, now + 0.2);
    },
    starJingle() {
      // 무적 아이템: 빠르게 오르내리는 8비트 스타 파워 느낌의 팡파레
      const ctx = this.ensureCtx();
      const now = ctx.currentTime;
      const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5, 1568.0];
      notes.forEach((f, i) => this.beepAt(f, 0.075, 'square', 0.15, now + i * 0.06));
    },
    powerup() {
      const ctx = this.ensureCtx();
      const now = ctx.currentTime;
      this.beepAt(392.0, 0.09, 'triangle', 0.15, now);
      this.beepAt(523.25, 0.09, 'triangle', 0.15, now + 0.08);
      this.beepAt(659.25, 0.09, 'triangle', 0.15, now + 0.16);
      this.beepAt(880.0, 0.16, 'triangle', 0.16, now + 0.24);
    },
    coin() {
      // 띠리링: 짧게 세 음이 위로 올라가는 소리
      const ctx = this.ensureCtx();
      const now = ctx.currentTime;
      this.beepAt(1046.5, 0.08, 'square', 0.14, now);
      this.beepAt(1318.5, 0.08, 'square', 0.14, now + 0.05);
      this.beepAt(1568.0, 0.12, 'square', 0.14, now + 0.1);
    },

    // ---- 신나는 배경음악 루프 (룩어헤드 스텝 시퀀서) ----
    music: {
      playing: false,
      timerId: null,
      step: 0,
      nextNoteTime: 0,
      mode: 'normal',
      normalBpm: 168,
      normalBass: [130.81, null, 130.81, 196.00, 130.81, null, 174.61, 196.00],
      normalLead: [523.25, 659.25, 783.99, 659.25, 523.25, 587.33, 523.25, 392.00],
      // 무적(별) 상태: 훨씬 빠르고 들뜬 반복 아르페지오
      starBpm: 260,
      starBass: [261.63, 261.63, 329.63, 392.00, 523.25, 392.00, 329.63, 261.63],
      starLead: [523.25, 659.25, 783.99, 1046.5, 783.99, 659.25, 523.25, 659.25],
      bpm: 168,
      bass: null,
      lead: null,
      setMode(mode) {
        if (this.mode === mode) return;
        this.mode = mode;
        this.bpm = mode === 'star' ? this.starBpm : this.normalBpm;
        this.bass = mode === 'star' ? this.starBass : this.normalBass;
        this.lead = mode === 'star' ? this.starLead : this.normalLead;
      },
      start() {
        if (this.playing) return;
        this.playing = true;
        this.mode = 'normal';
        this.bpm = this.normalBpm;
        this.bass = this.normalBass;
        this.lead = this.normalLead;
        const ctx = Sound.ensureCtx();
        this.step = 0;
        this.nextNoteTime = ctx.currentTime + 0.05;
        this.tick();
      },
      tick() {
        if (!this.playing) return;
        const ctx = Sound.ctx;
        const stepDur = 60 / this.bpm / 2;
        while (this.nextNoteTime < ctx.currentTime + 0.15) {
          const b = this.bass[this.step % this.bass.length];
          const l = this.lead[this.step % this.lead.length];
          if (b) Sound.beepAt(b, stepDur * 0.85, 'triangle', 0.05, this.nextNoteTime);
          if (l) Sound.beepAt(l, stepDur * 0.7, 'square', 0.045, this.nextNoteTime);
          this.nextNoteTime += stepDur;
          this.step++;
        }
        this.timerId = setTimeout(() => this.tick(), 30);
      },
      stop() {
        this.playing = false;
        this.mode = 'normal';
        if (this.timerId) clearTimeout(this.timerId);
      },
    },
  };

  // ---- T-Rex ----
  class Trex {
    constructor() {
      this.reset();
    }

    reset() {
      this.x = CONFIG.TREX_X;
      this.y = CONFIG.GROUND_BASE_Y - CONFIG.TREX_HEIGHT;
      this.velocityY = 0;
      this.jumping = false;
      this.ducking = false;
      this.crashed = false;
      this.groundY = () => CONFIG.GROUND_BASE_Y - (this.ducking ? CONFIG.TREX_HEIGHT_DUCK : CONFIG.TREX_HEIGHT);
      this.animTimer = 0;
      this.legFrame = 0;
      this.blinkTimer = 0;
      this.blinking = false;
      this.doubleJumpUsed = false;
      this.flying = false;
    }

    get width() { return this.ducking ? CONFIG.TREX_WIDTH_DUCK : CONFIG.TREX_WIDTH; }
    get height() { return this.ducking ? CONFIG.TREX_HEIGHT_DUCK : CONFIG.TREX_HEIGHT; }

    startJump() {
      if (this.crashed) return false;
      if (!this.jumping) {
        this.jumping = true;
        this.ducking = false;
        this.velocityY = CONFIG.JUMP_VELOCITY;
        this.doubleJumpUsed = false;
        return true;
      }
      if (!this.doubleJumpUsed) {
        // 2단 점프: 공중에서 한 번 더 점프 버튼을 누르면 추가 도약
        this.doubleJumpUsed = true;
        this.ducking = false;
        this.velocityY = CONFIG.JUMP_VELOCITY;
        return true;
      }
      return false;
    }

    endJump() {
      // 짧게 탭하면 상승 속도를 깎아 점프 높이를 줄인다 (가변 점프 높이)
      if (this.jumping && this.velocityY < CONFIG.JUMP_CUTOFF_VELOCITY) {
        this.velocityY = CONFIG.JUMP_CUTOFF_VELOCITY;
      }
    }

    setDuck(isDucking) {
      if (this.crashed) return;
      this.ducking = isDucking;
    }

    crash() {
      this.crashed = true;
      this.jumping = false;
      this.ducking = false;
      this.velocityY = 0;
      this.y = CONFIG.GROUND_BASE_Y - CONFIG.TREX_HEIGHT;
    }

    update(frames, duckHeld, jumpHeld) {
      if (this.crashed) return;

      if (this.flying) {
        if (jumpHeld) {
          this.y -= CONFIG.FLY_UP_SPEED * frames;
        } else {
          this.y += CONFIG.FLY_FALL_SPEED * frames;
        }
        const minY = 8;
        const maxY = CONFIG.GROUND_BASE_Y - CONFIG.TREX_HEIGHT;
        if (this.y < minY) this.y = minY;
        if (this.y > maxY) this.y = maxY;
        this.jumping = this.y < maxY;
        this.velocityY = 0;
        this.ducking = false;
        this.doubleJumpUsed = false;
        this.animTimer += frames;
        if (this.animTimer >= 5) {
          this.animTimer = 0;
          this.legFrame = this.legFrame === 0 ? 1 : 0;
        }
        return;
      }

      if (this.jumping) {
        let g = CONFIG.GRAVITY;
        if (duckHeld && this.velocityY > 0) {
          g *= CONFIG.SPEED_DROP_COEFFICIENT; // 공중에서 숙이기 = 급강하
        }
        this.velocityY += g * frames;
        this.y += this.velocityY * frames;
        const floorY = CONFIG.GROUND_BASE_Y - CONFIG.TREX_HEIGHT;
        if (this.y >= floorY) {
          this.y = floorY;
          this.jumping = false;
          this.velocityY = 0;
          this.ducking = duckHeld;
          this.doubleJumpUsed = false;
        }
      } else {
        this.y = CONFIG.GROUND_BASE_Y - this.height;
      }

      // 애니메이션
      if (!this.jumping) {
        this.animTimer += frames;
        const rate = 5; // frame 단위 (속도에 비례해 체감상 빨라짐은 게임 스크롤 속도로 표현)
        if (this.animTimer >= rate) {
          this.animTimer = 0;
          this.legFrame = this.legFrame === 0 ? 1 : 0;
        }
      }

      this.blinkTimer += frames;
      if (this.blinkTimer > 180) {
        this.blinking = true;
        if (this.blinkTimer > 190) {
          this.blinking = false;
          this.blinkTimer = 0;
        }
      }
    }

    getHitbox() {
      const inset = this.ducking ? 3 : 4;
      return {
        x: this.x + inset,
        y: this.y + inset,
        w: this.width - inset * 2,
        h: this.height - inset * 2,
      };
    }

    draw(ctx, isWaiting, scale = 1) {
      const { x, y, width: w, height: h } = this;
      ctx.save();
      if (scale !== 1) {
        const cx = x + w / 2;
        const cy = y + h; // 발 위치를 기준으로 확대(땅에 붙어서 커지는 느낌)
        ctx.translate(cx, cy);
        ctx.scale(scale, scale);
        ctx.translate(-cx, -cy);
      }
      ctx.fillStyle = COLORS.fg();
      ctx.strokeStyle = COLORS.fg();

      if (this.ducking) {
        // 몸통 (낮고 긴 자세)
        const bodyY = y + h * 0.25;
        ctx.fillRect(x + w * 0.03, bodyY, w * 0.62, h * 0.6);
        // 머리
        ctx.fillRect(x + w * 0.6, y, w * 0.35, h * 0.55);
        // 눈
        ctx.fillStyle = COLORS.bg();
        ctx.fillRect(x + w * 0.85, y + h * 0.12, w * 0.06, h * 0.12);
        ctx.fillStyle = COLORS.fg();
        // 다리 (달리기 애니메이션)
        const legUp = this.legFrame === 0;
        ctx.fillRect(x + w * 0.12, y + h * 0.85, w * 0.12, h * (legUp ? 0.15 : 0.2));
        ctx.fillRect(x + w * 0.4, y + h * 0.85, w * 0.12, h * (legUp ? 0.2 : 0.15));
        // 꼬리
        ctx.beginPath();
        ctx.moveTo(x, bodyY + h * 0.1);
        ctx.lineTo(x - w * 0.08, bodyY);
        ctx.lineTo(x, bodyY + h * 0.35);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        return;
      }

      // 몸통
      ctx.fillRect(x + w * 0.15, y + h * 0.35, w * 0.55, h * 0.5);
      // 머리/목
      ctx.fillRect(x + w * 0.5, y, w * 0.42, h * 0.42);
      // 팔
      ctx.fillRect(x + w * 0.45, y + h * 0.55, w * 0.14, h * 0.1);
      // 꼬리
      ctx.beginPath();
      ctx.moveTo(x + w * 0.15, y + h * 0.4);
      ctx.lineTo(x - w * 0.1, y + h * 0.25);
      ctx.lineTo(x + w * 0.15, y + h * 0.6);
      ctx.closePath();
      ctx.fill();

      // 눈
      if (this.crashed) {
        ctx.strokeStyle = COLORS.bg();
        ctx.lineWidth = 2;
        const ex = x + w * 0.82, ey = y + h * 0.12;
        ctx.beginPath();
        ctx.moveTo(ex - 3, ey - 3); ctx.lineTo(ex + 3, ey + 3);
        ctx.moveTo(ex + 3, ey - 3); ctx.lineTo(ex - 3, ey + 3);
        ctx.stroke();
      } else if (!this.blinking && !isWaiting) {
        ctx.fillStyle = COLORS.bg();
        ctx.fillRect(x + w * 0.8, y + h * 0.1, w * 0.07, h * 0.12);
      } else if (isWaiting || this.blinking) {
        ctx.fillStyle = COLORS.bg();
        ctx.fillRect(x + w * 0.8, y + h * 0.1, w * 0.07, this.blinking ? 1 : h * 0.12);
      }

      // 다리
      if (this.jumping) {
        ctx.fillStyle = COLORS.fg();
        ctx.fillRect(x + w * 0.25, y + h * 0.82, w * 0.16, h * 0.18);
        ctx.fillRect(x + w * 0.55, y + h * 0.82, w * 0.16, h * 0.18);
      } else {
        const legUp = this.legFrame === 0;
        ctx.fillRect(x + w * 0.22, y + h * 0.82, w * 0.16, h * (legUp ? 0.12 : 0.18));
        ctx.fillRect(x + w * 0.58, y + h * 0.82, w * 0.16, h * (legUp ? 0.18 : 0.12));
      }
      ctx.restore();
    }
  }

  // ---- 장애물 ----
  class Obstacle {
    constructor(def, speed) {
      this.def = def;
      this.width = def.width * (def.type !== 'PTERODACTYL' ? this.pickSize(def, speed) : 1);
      this.size = def.type !== 'PTERODACTYL' ? this.pickSize(def, speed) : 1;
      this.width = def.width * this.size;
      this.height = def.height;
      this.y = Array.isArray(def.y) ? def.y[randInt(0, def.y.length - 1)] : def.y;
      this.x = CONFIG.WIDTH;
      this.wingFrame = 0;
      this.wingTimer = 0;
      this.gap = randInt(0, this.size > 1 ? 8 : 0);
    }

    pickSize(def, speed) {
      if (speed >= def.multipleSpeed && Math.random() < 0.5) {
        return randInt(2, CONFIG.MAX_OBSTACLE_LENGTH);
      }
      return 1;
    }

    update(frames, speedPx) {
      this.x -= speedPx * frames;
      if (this.def.type === 'PTERODACTYL') {
        this.wingTimer += frames;
        if (this.wingTimer > 10) {
          this.wingTimer = 0;
          this.wingFrame = this.wingFrame === 0 ? 1 : 0;
        }
      }
    }

    isOffscreen() {
      return this.x + this.width < 0;
    }

    getHitbox() {
      const inset = 3;
      return { x: this.x + inset, y: this.y + inset, w: this.width - inset * 2, h: this.height - inset * 2 };
    }

    draw(ctx) {
      ctx.fillStyle = COLORS.fg();
      if (this.def.type === 'PTERODACTYL') {
        this.drawPterodactyl(ctx);
      } else {
        this.drawCactusCluster(ctx);
      }
    }

    drawCactusCluster(ctx) {
      const unitW = this.def.width;
      for (let i = 0; i < this.size; i++) {
        this.drawCactus(ctx, this.x + i * (unitW + 2), this.y, unitW, this.height);
      }
    }

    drawCactus(ctx, x, y, w, h) {
      ctx.fillRect(x + w * 0.3, y, w * 0.4, h);
      ctx.fillRect(x, y + h * 0.35, w * 0.35, h * 0.22);
      ctx.fillRect(x, y + h * 0.15, w * 0.15, h * 0.4);
      ctx.fillRect(x + w * 0.65, y + h * 0.5, w * 0.35, h * 0.22);
      ctx.fillRect(x + w * 0.85, y + h * 0.3, w * 0.15, h * 0.4);
    }

    drawPterodactyl(ctx) {
      const { x, y, width: w, height: h } = this;
      ctx.beginPath();
      ctx.ellipse(x + w * 0.5, y + h * 0.55, w * 0.32, h * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
      // 부리
      ctx.beginPath();
      ctx.moveTo(x + w * 0.82, y + h * 0.5);
      ctx.lineTo(x + w, y + h * 0.45);
      ctx.lineTo(x + w * 0.82, y + h * 0.62);
      ctx.closePath();
      ctx.fill();
      // 날개
      const wingUp = this.wingFrame === 0;
      ctx.beginPath();
      if (wingUp) {
        ctx.moveTo(x + w * 0.5, y + h * 0.5);
        ctx.lineTo(x + w * 0.15, y);
        ctx.lineTo(x + w * 0.55, y + h * 0.45);
      } else {
        ctx.moveTo(x + w * 0.5, y + h * 0.5);
        ctx.lineTo(x + w * 0.15, y + h);
        ctx.lineTo(x + w * 0.55, y + h * 0.55);
      }
      ctx.closePath();
      ctx.fill();
    }
  }

  // ---- 구름 ----
  class Cloud {
    constructor(x) {
      this.x = x;
      this.y = rand(CONFIG.CLOUD_MIN_SKY_Y, CONFIG.CLOUD_MAX_SKY_Y);
      this.width = 46;
      this.height = 14;
    }
    update(frames) { this.x -= CONFIG.CLOUD_SPEED * frames; }
    isOffscreen() { return this.x + this.width < 0; }
    draw(ctx) {
      ctx.fillStyle = COLORS.cloud();
      const { x, y, width: w, height: h } = this;
      ctx.beginPath();
      ctx.ellipse(x + w * 0.3, y + h * 0.6, w * 0.3, h * 0.4, 0, 0, Math.PI * 2);
      ctx.ellipse(x + w * 0.55, y + h * 0.4, w * 0.28, h * 0.4, 0, 0, Math.PI * 2);
      ctx.ellipse(x + w * 0.78, y + h * 0.6, w * 0.24, h * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---- 동전 ----
  class Coin {
    constructor(x) {
      this.def = COIN_TYPES[randInt(0, COIN_TYPES.length - 1)];
      this.value = this.def.value;
      this.radius = this.def.radius;
      this.x = x;
      this.y = COIN_LANES_Y[randInt(0, COIN_LANES_Y.length - 1)];
      this.bob = Math.random() * Math.PI * 2;
    }

    update(frames, speedPx) {
      this.x -= speedPx * frames;
      this.bob += 0.1 * frames;
    }

    isOffscreen() { return this.x + this.radius < 0; }

    getHitbox() {
      return { x: this.x - this.radius, y: this.y - this.radius, w: this.radius * 2, h: this.radius * 2 };
    }

    draw(ctx) {
      const wobble = Math.sin(this.bob) * 2;
      const y = this.y + wobble;
      ctx.fillStyle = '#e8c33d';
      ctx.strokeStyle = '#a8791a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.x, y, this.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#7a5610';
      ctx.font = `bold ${Math.round(this.radius * 1.1)}px "Courier New", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(this.value), this.x, y + 1);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }
  }

  // ---- 아이템: 무적 / 날개 ----
  class Item {
    constructor(x, kind) {
      this.kind = kind; // 'invincible' | 'wings' | 'drone' | 'heart'
      this.radius = 13;
      this.x = x;
      this.y = COIN_LANES_Y[randInt(0, COIN_LANES_Y.length - 1)];
      this.bob = Math.random() * Math.PI * 2;
    }

    update(frames, speedPx) {
      this.x -= speedPx * frames;
      this.bob += 0.08 * frames;
    }

    isOffscreen() { return this.x + this.radius < 0; }

    getHitbox() {
      return { x: this.x - this.radius, y: this.y - this.radius, w: this.radius * 2, h: this.radius * 2 };
    }

    draw(ctx) {
      const wobble = Math.sin(this.bob) * 2;
      const y = this.y + wobble;
      const colors = {
        invincible: ['#9b59b6', '#663399'],
        wings: ['#3498db', '#1f618d'],
        drone: ['#7f8c8d', '#4d5656'],
        heart: ['#e74c3c', '#a93226'],
      };
      const [fill, stroke] = colors[this.kind];
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.x, y, this.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff';
      if (this.kind === 'invincible') {
        this.drawStar(ctx, this.x, y, this.radius * 0.65, this.radius * 0.3);
      } else if (this.kind === 'wings') {
        this.drawWings(ctx, this.x, y, this.radius * 0.8);
      } else if (this.kind === 'drone') {
        this.drawDroneIcon(ctx, this.x, y, this.radius * 0.75);
      } else {
        this.drawHeartIcon(ctx, this.x, y, this.radius * 0.75);
      }
    }

    drawHeartIcon(ctx, cx, cy, size) {
      ctx.beginPath();
      ctx.moveTo(cx, cy + size * 0.7);
      ctx.bezierCurveTo(cx - size * 1.1, cy - size * 0.3, cx - size * 0.4, cy - size * 1.1, cx, cy - size * 0.3);
      ctx.bezierCurveTo(cx + size * 0.4, cy - size * 1.1, cx + size * 1.1, cy - size * 0.3, cx, cy + size * 0.7);
      ctx.closePath();
      ctx.fill();
    }

    drawDroneIcon(ctx, cx, cy, size) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([dx, dy]) => {
        const ax = cx + dx * size * 0.7;
        const ay = cy + dy * size * 0.7;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(ax, ay);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(ax, ay, size * 0.28, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.32, 0, Math.PI * 2);
      ctx.fill();
    }

    drawStar(ctx, cx, cy, outerR, innerR) {
      ctx.beginPath();
      const points = 5;
      for (let i = 0; i < points * 2; i++) {
        const r = i % 2 === 0 ? outerR : innerR;
        const angle = (Math.PI / points) * i - Math.PI / 2;
        const x = cx + r * Math.cos(angle);
        const py = cy + r * Math.sin(angle);
        if (i === 0) ctx.moveTo(x, py); else ctx.lineTo(x, py);
      }
      ctx.closePath();
      ctx.fill();
    }

    drawWings(ctx, cx, cy, size) {
      ctx.beginPath();
      ctx.ellipse(cx - size * 0.55, cy, size * 0.55, size * 0.32, -0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx + size * 0.55, cy, size * 0.55, size * 0.32, 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---- 드론의 미사일 & 폭발 이펙트 ----
  class Missile {
    constructor(x, y, targetX, targetY) {
      this.x = x;
      this.y = y;
      this.targetX = targetX;
      this.targetY = targetY;
      this.t = 0;
      this.duration = 8;
      this.exploded = false;
    }
    update(frames) { this.t += frames; }
    isDone() { return this.t >= this.duration; }
    draw(ctx) {
      const p = Math.min(1, this.t / this.duration);
      const x = this.x + (this.targetX - this.x) * p;
      const y = this.y + (this.targetY - this.y) * p;
      ctx.fillStyle = '#555';
      ctx.beginPath();
      ctx.ellipse(x, y, 5, 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ff8c00';
      ctx.beginPath();
      ctx.arc(x - 6, y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  class Explosion {
    constructor(x, y) {
      this.x = x;
      this.y = y;
      this.t = 0;
      this.duration = 18;
    }
    update(frames) { this.t += frames; }
    isDone() { return this.t >= this.duration; }
    draw(ctx) {
      const p = this.t / this.duration;
      const r = 6 + p * 16;
      ctx.globalAlpha = Math.max(0, 1 - p);
      ctx.fillStyle = '#ff4500';
      ctx.beginPath();
      ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath();
      ctx.arc(this.x, this.y, r * 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // 무적 상태로 장애물을 들이받아 부술 때 나오는 파편 이펙트
  class SmashEffect {
    constructor(x, y) {
      this.x = x;
      this.y = y;
      this.t = 0;
      this.duration = 16;
      this.pieces = Array.from({ length: 6 }, (_, i) => ({
        angle: (Math.PI * 2 / 6) * i + Math.random() * 0.5,
        dist: 0,
        speed: 1.5 + Math.random() * 1.5,
      }));
    }
    update(frames) {
      this.t += frames;
      this.pieces.forEach((p) => { p.dist += p.speed * frames; });
    }
    isDone() { return this.t >= this.duration; }
    draw(ctx) {
      const p = this.t / this.duration;
      ctx.globalAlpha = Math.max(0, 1 - p);
      ctx.fillStyle = '#8b5a2b';
      this.pieces.forEach((piece) => {
        const x = this.x + Math.cos(piece.angle) * piece.dist;
        const y = this.y + Math.sin(piece.angle) * piece.dist;
        ctx.fillRect(x - 2, y - 2, 4, 4);
      });
      ctx.globalAlpha = 1;
    }
  }

  // ---- 색상 테마 (낮/밤) ----
  const COLORS = {
    nightAlpha: 0,
    bg() {
      const a = this.nightAlpha;
      const c = Math.round(255 - a * 225);
      return `rgb(${c},${c},${c})`;
    },
    fg() {
      const a = this.nightAlpha;
      const c = Math.round(83 - a * 63);
      return `rgb(${c},${c},${c})`;
    },
    cloud() {
      const a = this.nightAlpha;
      const c = Math.round(200 - a * 60);
      return `rgb(${c},${c},${c})`;
    },
  };

  // ---- Horizon (지평선 + 구름 + 장애물 + 밤낮) ----
  class Horizon {
    constructor() {
      this.reset();
    }

    reset() {
      this.groundOffset = 0;
      this.obstacles = [];
      this.clouds = [];
      this.coins = [];
      this.items = [];
      this.obstacleTimer = 60;
      this.cloudTimer = 0;
      this.coinTimer = 90;
      this.itemTimer = 300;
      this.lastItemKind = null;
      this.heartTimer = 450;
      this.distance = 0;
      this.nightSegment = 0;
      this.isNight = false;
      COLORS.nightAlpha = 0;
    }

    computeGapFrames(def, speed) {
      const variance = 1 + CONFIG.GAP_COEFFICIENT * Math.random();
      const baseFrames = (def.minGap / speed) * variance;
      return Math.max(CONFIG.MIN_OBSTACLE_GAP_FRAMES, baseFrames);
    }

    update(frames, speedPx, speed) {
      this.distance += speedPx * frames;
      this.groundOffset = (this.groundOffset - speedPx * frames) % CONFIG.WIDTH;

      // 장애물 (시간=프레임 기준 간격 → 속도가 올라도 최소 반응 시간은 보장)
      this.obstacleTimer -= frames;
      if (this.obstacleTimer <= 0) {
        const candidates = OBSTACLE_TYPES.filter((o) => speed >= o.minSpeed);
        const def = candidates[randInt(0, candidates.length - 1)];
        const ob = new Obstacle(def, speed);
        this.obstacles.push(ob);
        this.obstacleTimer = this.computeGapFrames(def, speed);
      }
      this.obstacles.forEach((o) => o.update(frames, speedPx));
      this.obstacles = this.obstacles.filter((o) => !o.isOffscreen());

      // 구름
      this.cloudTimer -= frames;
      if (this.cloudTimer <= 0 && this.clouds.length < CONFIG.MAX_CLOUDS) {
        this.clouds.push(new Cloud(CONFIG.WIDTH + rand(0, 50)));
        this.cloudTimer = rand(CONFIG.CLOUD_MIN_GAP, CONFIG.CLOUD_MAX_GAP) / 4;
      }
      this.clouds.forEach((c) => c.update(frames));
      this.clouds = this.clouds.filter((c) => !c.isOffscreen());

      // 동전: 10초마다 3개씩 무리로 스폰. 장애물 근처면 잠깐 미뤘다가 다시 시도
      this.coinTimer -= frames;
      if (this.coinTimer <= 0) {
        const spawnStart = CONFIG.WIDTH + 20;
        const spawnEnd = spawnStart + (COIN_BATCH_SIZE - 1) * 55 + COIN_OBSTACLE_MARGIN;
        const blocked = this.obstacles.some((o) => o.x + o.width > spawnStart - COIN_OBSTACLE_MARGIN && o.x < spawnEnd);
        if (!blocked && this.coins.length < MAX_COINS_ON_SCREEN) {
          for (let i = 0; i < COIN_BATCH_SIZE; i++) {
            this.coins.push(new Coin(spawnStart + i * 55));
          }
          this.coinTimer = COIN_SPAWN_INTERVAL_FRAMES;
        } else {
          this.coinTimer = 20; // 막혀 있으면 잠깐 뒤 다시 시도
        }
      }
      this.coins.forEach((c) => c.update(frames, speedPx));
      this.coins = this.coins.filter((c) => !c.isOffscreen());

      // 아이템: 15초마다 무적/날개/드론 중 하나 (직전과 같은 종류는 피함). 장애물 근처면 잠깐 미뤘다가 다시 시도
      this.itemTimer -= frames;
      if (this.itemTimer <= 0) {
        const spawnStart = CONFIG.WIDTH + 20;
        const blocked = this.obstacles.some((o) => o.x + o.width > spawnStart - ITEM_OBSTACLE_MARGIN && o.x < spawnStart + ITEM_OBSTACLE_MARGIN);
        if (!blocked && this.items.length < MAX_ITEMS_ON_SCREEN) {
          const candidates = ITEM_KINDS.filter((k) => k !== this.lastItemKind);
          const kind = candidates[randInt(0, candidates.length - 1)];
          this.lastItemKind = kind;
          this.items.push(new Item(spawnStart, kind));
          this.itemTimer = ITEM_SPAWN_INTERVAL_FRAMES;
        } else {
          this.itemTimer = 25;
        }
      }

      // 하트: 15초마다 하나 (별도 타이머). 장애물 근처면 잠깐 미뤘다가 다시 시도
      this.heartTimer -= frames;
      if (this.heartTimer <= 0) {
        const spawnStart = CONFIG.WIDTH + 20;
        const blocked = this.obstacles.some((o) => o.x + o.width > spawnStart - ITEM_OBSTACLE_MARGIN && o.x < spawnStart + ITEM_OBSTACLE_MARGIN);
        if (!blocked && this.items.length < MAX_ITEMS_ON_SCREEN + 1) {
          this.items.push(new Item(spawnStart, 'heart'));
          this.heartTimer = CONFIG.HEART_SPAWN_INTERVAL_FRAMES;
        } else {
          this.heartTimer = 25;
        }
      }

      this.items.forEach((it) => it.update(frames, speedPx));
      this.items = this.items.filter((it) => !it.isOffscreen());

      // 밤/낮 (현재 비활성화 — 항상 낮 유지)
      if (CONFIG.NIGHT_MODE_ENABLED) {
        const seg = Math.floor(this.distance / CONFIG.INVERT_DISTANCE);
        if (seg !== this.nightSegment) {
          this.nightSegment = seg;
          this.isNight = seg % 2 === 1;
        }
        const target = this.isNight ? 1 : 0;
        if (COLORS.nightAlpha < target) COLORS.nightAlpha = Math.min(target, COLORS.nightAlpha + CONFIG.FADE_SPEED * frames);
        if (COLORS.nightAlpha > target) COLORS.nightAlpha = Math.max(target, COLORS.nightAlpha - CONFIG.FADE_SPEED * frames);
      }
    }

    drawGround(ctx) {
      ctx.strokeStyle = COLORS.fg();
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, CONFIG.GROUND_LINE_Y);
      ctx.lineTo(CONFIG.WIDTH, CONFIG.GROUND_LINE_Y);
      ctx.stroke();

      ctx.lineWidth = 1;
      for (let x = this.groundOffset % 20; x < CONFIG.WIDTH; x += 20) {
        ctx.beginPath();
        ctx.moveTo(x, CONFIG.GROUND_LINE_Y + 4);
        ctx.lineTo(x + 8, CONFIG.GROUND_LINE_Y + 4);
        ctx.stroke();
      }
    }

    drawNightDecor(ctx) {
      if (COLORS.nightAlpha <= 0.05) return;
      ctx.globalAlpha = COLORS.nightAlpha;
      ctx.fillStyle = COLORS.fg();
      ctx.beginPath();
      ctx.arc(CONFIG.WIDTH - 60, 30, 10, 0, Math.PI * 2);
      ctx.fill();
      for (let i = 0; i < 2; i++) {
        ctx.beginPath();
        ctx.arc(CONFIG.WIDTH - 150 - i * 80, 25 + i * 15, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    draw(ctx) {
      this.clouds.forEach((c) => c.draw(ctx));
      this.drawNightDecor(ctx);
      this.drawGround(ctx);
      this.coins.forEach((c) => c.draw(ctx));
      this.items.forEach((it) => it.draw(ctx));
      this.obstacles.forEach((o) => o.draw(ctx));
    }
  }

  // ---- 점수판 ----
  class DistanceMeter {
    constructor() {
      this.best = Number(localStorage.getItem('dinoRunnerHighScore') || 0);
      this.flashTimer = 0;
      this.flashOn = true;
      this.lastAchievement = 0;
    }

    update(frames, score) {
      if (Math.floor(score / CONFIG.ACHIEVEMENT_DISTANCE) > this.lastAchievement) {
        this.lastAchievement = Math.floor(score / CONFIG.ACHIEVEMENT_DISTANCE);
        this.flashTimer = 750;
        Sound.achievement();
      }
      if (this.flashTimer > 0) {
        this.flashTimer -= frames * (1000 / CONFIG.FPS);
        this.flashOn = Math.floor(this.flashTimer / 125) % 2 === 0;
      } else {
        this.flashOn = true;
      }
    }

    commitBest(score) {
      if (score > this.best) {
        this.best = score;
        localStorage.setItem('dinoRunnerHighScore', String(this.best));
      }
    }

    draw(ctx, score) {
      ctx.font = '14px "Courier New", monospace';
      ctx.textBaseline = 'top';
      ctx.fillStyle = COLORS.fg();
      const scoreStr = String(Math.floor(score)).padStart(5, '0');
      const bestStr = String(Math.floor(this.best)).padStart(5, '0');
      const text = this.best > 0 ? `HI ${bestStr}   ${scoreStr}` : scoreStr;
      if (this.flashOn) {
        ctx.textAlign = 'right';
        ctx.fillText(text, CONFIG.WIDTH - 12, 10);
        ctx.textAlign = 'left';
      }
    }
  }

  // ---- 메인 러너 ----
  class Runner {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.trex = new Trex();
      this.horizon = new Horizon();
      this.meter = new DistanceMeter();
      this.state = 'WAITING'; // WAITING | PLAYING | CRASHED
      this.speed = CONFIG.SPEED;
      this.score = 0;
      this.coinCount = 0;
      this.hearts = CONFIG.MAX_HEARTS;
      this.invincibleTimer = 0;
      this.wingsTimer = 0;
      this.droneTimer = 0;
      this.droneFireTimer = 0;
      this.missiles = [];
      this.explosions = [];
      this.tankTimer = 0;
      this.jetTimer = 0;
      this.tankTriggered = false;
      this.jetTriggered = false;
      this.lastTime = 0;
      this.gameOverTimer = 0;
      this.duckHeld = false;
      this.jumpHeld = false;

      this.heartsEl = document.getElementById('hearts-display');
      this.coinEl = document.getElementById('coin-display');
      this.buffEl = document.getElementById('buff-display');

      this.resize();
      window.addEventListener('resize', () => this.resize());
      this.bindInput();
      this.updateStatusBar();
      requestAnimationFrame((t) => this.loop(t));
    }

    resize() {
      const dpr = window.devicePixelRatio || 1;
      const cssWidth = this.canvas.getBoundingClientRect().width || CONFIG.WIDTH;
      const scale = Math.min(3, (cssWidth / CONFIG.WIDTH) * dpr);
      this.canvas.width = CONFIG.WIDTH * scale;
      this.canvas.height = CONFIG.HEIGHT * scale;
      this.ctx.setTransform(scale, 0, 0, scale, 0, 0);
    }

    start() {
      this.requestFullscreen();
      this.state = 'PLAYING';
      this.speed = CONFIG.SPEED;
      this.score = 0;
      this.coinCount = 0;
      this.hearts = CONFIG.MAX_HEARTS;
      this.invincibleTimer = 0;
      this.wingsTimer = 0;
      this.droneTimer = 0;
      this.droneFireTimer = 0;
      this.missiles = [];
      this.explosions = [];
      this.tankTimer = 0;
      this.jetTimer = 0;
      this.tankTriggered = false;
      this.jetTriggered = false;
      this.trex.reset();
      this.horizon.reset();
      Sound.music.start();
      this.updateStatusBar();
    }

    restart() {
      this.start();
    }

    requestFullscreen() {
      // 이미 전체화면이면 다시 요청하지 않음
      if (document.fullscreenElement || document.webkitFullscreenElement) return;
      const el = document.documentElement;
      const request = el.requestFullscreen || el.webkitRequestFullscreen;
      if (request) {
        const result = request.call(el);
        if (result && result.catch) result.catch(() => {});
      }
    }

    onGameOver() {
      this.state = 'CRASHED';
      this.trex.crash();
      this.meter.commitBest(this.score);
      this.gameOverTimer = CONFIG.GAMEOVER_CLEAR_TIME;
      Sound.music.stop();
      Sound.hit();
    }

    updateStatusBar() {
      if (this.heartsEl) {
        this.heartsEl.textContent = '♥'.repeat(this.hearts) + '♡'.repeat(CONFIG.MAX_HEARTS - this.hearts);
      }
      if (this.coinEl) {
        this.coinEl.textContent = `COIN ${this.coinCount}`;
      }
      if (this.buffEl) {
        const parts = [];
        if (this.tankTimer > 0) {
          parts.push(`<span style="color:#556b2f">🚙탱크 ${Math.ceil(this.tankTimer / CONFIG.FPS)}초</span>`);
        }
        if (this.jetTimer > 0) {
          parts.push(`<span style="color:#34495e">✈️전투기 ${Math.ceil(this.jetTimer / CONFIG.FPS)}초</span>`);
        }
        // 피격 무적(짧음)이 아니라 아이템 무적(긺)일 때만 표시
        if (this.tankTimer <= 0 && this.invincibleTimer > CONFIG.INVINCIBLE_FRAMES) {
          parts.push(`<span style="color:#9b59b6">무적 ${Math.ceil(this.invincibleTimer / CONFIG.FPS)}초</span>`);
        }
        if (this.jetTimer <= 0 && this.wingsTimer > 0) {
          parts.push(`<span style="color:#3498db">날개 ${Math.ceil(this.wingsTimer / CONFIG.FPS)}초</span>`);
        }
        if (this.tankTimer <= 0 && this.jetTimer <= 0 && this.droneTimer > 0) {
          parts.push(`<span style="color:#4d5656">드론 ${Math.ceil(this.droneTimer / CONFIG.FPS)}초</span>`);
        }
        this.buffEl.innerHTML = parts.join(' ');
      }
    }

    handleJumpPress() {
      if (this.state === 'WAITING') { this.start(); return; }
      if (this.state === 'CRASHED') {
        if (this.gameOverTimer <= 0) this.restart();
        return;
      }
      if (this.trex.startJump()) Sound.jump();
    }

    handleJumpRelease() {
      this.trex.endJump();
    }

    handleDuck(isDown) {
      this.duckHeld = isDown;
      if (this.state === 'PLAYING') this.trex.setDuck(isDown && !this.trex.jumping ? true : this.trex.ducking);
    }

    bindInput() {
      window.addEventListener('keydown', (e) => {
        if (e.code === 'Space' || e.code === 'ArrowUp') {
          e.preventDefault();
          this.jumpHeld = true;
          if (!e.repeat) this.handleJumpPress();
        } else if (e.code === 'ArrowDown') {
          e.preventDefault();
          this.duckHeld = true;
          if (this.state === 'PLAYING' && !this.trex.jumping) this.trex.setDuck(true);
        }
      });
      window.addEventListener('keyup', (e) => {
        if (e.code === 'Space' || e.code === 'ArrowUp') {
          this.jumpHeld = false;
          this.handleJumpRelease();
        } else if (e.code === 'ArrowDown') {
          this.duckHeld = false;
          this.trex.setDuck(false);
        }
      });

      const canvas = this.canvas;
      canvas.addEventListener('touchstart', (e) => { e.preventDefault(); this.jumpHeld = true; this.handleJumpPress(); }, { passive: false });
      canvas.addEventListener('touchend', (e) => { e.preventDefault(); this.jumpHeld = false; this.handleJumpRelease(); }, { passive: false });
      canvas.addEventListener('mousedown', () => { this.jumpHeld = true; this.handleJumpPress(); });
      canvas.addEventListener('mouseup', () => { this.jumpHeld = false; this.handleJumpRelease(); });

      const jumpBtn = document.getElementById('btn-jump');
      const duckBtn = document.getElementById('btn-duck');
      const pressJump = (e) => { e.preventDefault(); this.jumpHeld = true; this.handleJumpPress(); };
      const releaseJump = (e) => { e.preventDefault(); this.jumpHeld = false; this.handleJumpRelease(); };
      const pressDuck = (e) => { e.preventDefault(); this.duckHeld = true; if (this.state === 'PLAYING' && !this.trex.jumping) this.trex.setDuck(true); };
      const releaseDuck = (e) => { e.preventDefault(); this.duckHeld = false; this.trex.setDuck(false); };
      jumpBtn.addEventListener('touchstart', pressJump, { passive: false });
      jumpBtn.addEventListener('touchend', releaseJump, { passive: false });
      jumpBtn.addEventListener('mousedown', pressJump);
      jumpBtn.addEventListener('mouseup', releaseJump);
      duckBtn.addEventListener('touchstart', pressDuck, { passive: false });
      duckBtn.addEventListener('touchend', releaseDuck, { passive: false });
      duckBtn.addEventListener('mousedown', pressDuck);
      duckBtn.addEventListener('mouseup', releaseDuck);
    }

    checkCollision() {
      const t = this.trex.getHitbox();
      for (const o of this.horizon.obstacles) {
        const b = o.getHitbox();
        if (t.x < b.x + b.w && t.x + t.w > b.x && t.y < b.y + b.h && t.y + t.h > b.y) {
          return o;
        }
      }
      return null;
    }

    collectCoins() {
      const t = this.trex.getHitbox();
      const remaining = [];
      for (const c of this.horizon.coins) {
        const b = c.getHitbox();
        const overlap = t.x < b.x + b.w && t.x + t.w > b.x && t.y < b.y + b.h && t.y + t.h > b.y;
        if (overlap) {
          this.coinCount += c.value;
          Sound.coin();
        } else {
          remaining.push(c);
        }
      }
      this.horizon.coins = remaining;
    }

    collectItems() {
      const t = this.trex.getHitbox();
      const remaining = [];
      for (const it of this.horizon.items) {
        const b = it.getHitbox();
        const overlap = t.x < b.x + b.w && t.x + t.w > b.x && t.y < b.y + b.h && t.y + t.h > b.y;
        if (overlap) {
          if (it.kind === 'invincible') {
            this.invincibleTimer = CONFIG.INVINCIBLE_ITEM_FRAMES;
            Sound.starJingle();
            Sound.music.setMode('star');
          } else if (it.kind === 'wings') {
            this.wingsTimer = CONFIG.WINGS_ITEM_FRAMES;
            Sound.powerup();
          } else if (it.kind === 'drone') {
            this.droneTimer = CONFIG.DRONE_ITEM_FRAMES;
            this.droneFireTimer = 0;
            Sound.powerup();
          } else {
            this.hearts = Math.min(CONFIG.MAX_HEARTS, this.hearts + 1);
            this.updateStatusBar();
            Sound.heal();
          }
        } else {
          remaining.push(it);
        }
      }
      this.horizon.items = remaining;
    }

    drawDrone(ctx) {
      const dx = this.trex.x + this.trex.width / 2;
      const dy = this.trex.y - 20 + Math.sin(this.droneTimer * 0.15) * 2;
      ctx.strokeStyle = '#4d5656';
      ctx.lineWidth = 1.5;
      ctx.fillStyle = '#7f8c8d';
      [[-1, -0.6], [1, -0.6], [-1, 0.6], [1, 0.6]].forEach(([dx2, dy2]) => {
        const ax = dx + dx2 * 12;
        const ay = dy + dy2 * 5;
        ctx.beginPath();
        ctx.moveTo(dx, dy);
        ctx.lineTo(ax, ay);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(ax, ay, 4, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.fillStyle = '#4d5656';
      ctx.beginPath();
      ctx.arc(dx, dy, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e74c3c';
      ctx.beginPath();
      ctx.arc(dx, dy - 2, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    drawTank(ctx, x, y, w, h) {
      const bodyY = y + h * 0.35;
      ctx.fillStyle = '#556b2f';
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 1.5;
      // 몸체
      ctx.fillRect(x - w * 0.15, bodyY, w * 1.3, h * 0.5);
      ctx.strokeRect(x - w * 0.15, bodyY, w * 1.3, h * 0.5);
      // 포탑
      ctx.beginPath();
      ctx.arc(x + w * 0.55, bodyY, h * 0.28, Math.PI, 0);
      ctx.fill();
      ctx.stroke();
      // 포신
      ctx.fillRect(x + w * 0.85, bodyY - h * 0.1, w * 0.55, h * 0.12);
      // 바퀴
      ctx.fillStyle = '#222';
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(x - w * 0.05 + w * 0.34 * i, y + h * 0.9, h * 0.15, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    drawJet(ctx, x, y, w, h) {
      const cy = y + h * 0.5;
      ctx.fillStyle = '#34495e';
      // 동체
      ctx.beginPath();
      ctx.moveTo(x + w * 1.4, cy);
      ctx.lineTo(x, y + h * 0.2);
      ctx.lineTo(x + w * 0.35, cy);
      ctx.lineTo(x, y + h * 0.8);
      ctx.closePath();
      ctx.fill();
      // 날개(위/아래)
      ctx.beginPath();
      ctx.moveTo(x + w * 0.55, cy - h * 0.05);
      ctx.lineTo(x + w * 0.05, y - h * 0.25);
      ctx.lineTo(x + w * 0.7, cy - h * 0.05);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x + w * 0.55, cy + h * 0.05);
      ctx.lineTo(x + w * 0.05, y + h * 1.25);
      ctx.lineTo(x + w * 0.7, cy + h * 0.05);
      ctx.closePath();
      ctx.fill();
      // 조종석
      ctx.fillStyle = '#aed6f1';
      ctx.beginPath();
      ctx.ellipse(x + w * 0.95, cy, w * 0.18, h * 0.14, 0, 0, Math.PI * 2);
      ctx.fill();
      // 엔진 불꽃
      ctx.fillStyle = '#ff8c00';
      ctx.beginPath();
      ctx.moveTo(x, y + h * 0.35);
      ctx.lineTo(x - w * 0.3, cy);
      ctx.lineTo(x, y + h * 0.65);
      ctx.closePath();
      ctx.fill();
    }

    updateDrone(frames) {
      if (this.droneTimer > 0) {
        this.droneTimer -= frames;
        this.droneFireTimer -= frames;
        if (this.droneFireTimer <= 0) {
          const target = this.horizon.obstacles
            .filter((o) => o.x > this.trex.x)
            .sort((a, b) => a.x - b.x)[0];
          if (target) {
            const tx = target.x + target.width / 2;
            const ty = target.y + target.height / 2;
            const droneX = this.trex.x + this.trex.width / 2;
            const droneY = this.trex.y - 22;
            this.missiles.push(new Missile(droneX, droneY, tx, ty));
            this.horizon.obstacles = this.horizon.obstacles.filter((o) => o !== target);
            Sound.machineGun();
          }
          this.droneFireTimer = CONFIG.DRONE_FIRE_INTERVAL_FRAMES;
        }
      }
      this.missiles.forEach((m) => {
        m.update(frames);
        if (!m.exploded && m.isDone()) {
          m.exploded = true;
          this.explosions.push(new Explosion(m.targetX, m.targetY));
          Sound.explode();
        }
      });
      this.missiles = this.missiles.filter((m) => !m.exploded);
      this.explosions.forEach((e) => e.update(frames));
      this.explosions = this.explosions.filter((e) => !e.isDone());
    }

    update(frames) {
      if (this.state === 'PLAYING') {
        this.speed = Math.min(CONFIG.MAX_SPEED, this.speed + CONFIG.ACCELERATION * frames);
        const speedPx = this.speed;
        this.trex.flying = this.wingsTimer > 0;
        this.trex.update(frames, this.duckHeld, this.jumpHeld);
        this.horizon.update(frames, speedPx, this.speed);
        this.score = this.horizon.distance * CONFIG.SCORE_COEFFICIENT;
        this.meter.update(frames, this.score);
        this.collectCoins();
        this.collectItems();

        // 코인 28개: 탱크 변신(무적+드론), 코인 40개: 전투기 변신(날개+드론) — 게임당 1회씩
        if (!this.tankTriggered && this.coinCount >= CONFIG.TANK_COIN_THRESHOLD) {
          this.tankTriggered = true;
          this.tankTimer = CONFIG.COMBO_DURATION_FRAMES;
          this.invincibleTimer = Math.max(this.invincibleTimer, CONFIG.COMBO_DURATION_FRAMES);
          this.droneTimer = Math.max(this.droneTimer, CONFIG.COMBO_DURATION_FRAMES);
          this.droneFireTimer = 0;
          Sound.vehicle();
        }
        if (!this.jetTriggered && this.coinCount >= CONFIG.JET_COIN_THRESHOLD) {
          this.jetTriggered = true;
          this.jetTimer = CONFIG.COMBO_DURATION_FRAMES;
          this.wingsTimer = Math.max(this.wingsTimer, CONFIG.COMBO_DURATION_FRAMES);
          this.droneTimer = Math.max(this.droneTimer, CONFIG.COMBO_DURATION_FRAMES);
          this.droneFireTimer = 0;
          Sound.vehicle();
        }
        if (this.tankTimer > 0) this.tankTimer -= frames;
        if (this.jetTimer > 0) this.jetTimer -= frames;

        this.updateDrone(frames);

        if (this.wingsTimer > 0) this.wingsTimer -= frames;

        if (this.invincibleTimer > 0) {
          this.invincibleTimer -= frames;
          Sound.music.setMode(this.invincibleTimer > CONFIG.INVINCIBLE_FRAMES ? 'star' : 'normal');
          const hitObstacle = this.checkCollision();
          if (hitObstacle) {
            // 무적 상태: 장애물을 부수고 그대로 통과 (하트 안 깎임)
            this.horizon.obstacles = this.horizon.obstacles.filter((o) => o !== hitObstacle);
            this.explosions.push(new SmashEffect(hitObstacle.x + hitObstacle.width / 2, hitObstacle.y + hitObstacle.height / 2));
            Sound.smash();
          }
        } else {
          Sound.music.setMode('normal');
          const hitObstacle = this.checkCollision();
          if (hitObstacle) {
            this.horizon.obstacles = this.horizon.obstacles.filter((o) => o !== hitObstacle);
            this.hearts -= 1;
            if (this.hearts <= 0) {
              this.onGameOver();
            } else {
              this.invincibleTimer = CONFIG.INVINCIBLE_FRAMES;
              Sound.hurt();
            }
          }
        }
        this.updateStatusBar();
      } else if (this.state === 'CRASHED') {
        if (this.gameOverTimer > 0) this.gameOverTimer -= frames * (1000 / CONFIG.FPS);
      } else {
        this.trex.update(frames, false);
      }
    }

    draw() {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, CONFIG.WIDTH, CONFIG.HEIGHT);
      ctx.fillStyle = COLORS.bg();
      ctx.fillRect(0, 0, CONFIG.WIDTH, CONFIG.HEIGHT);

      this.horizon.draw(ctx);
      this.explosions.forEach((e) => e.draw(ctx));
      this.missiles.forEach((m) => m.draw(ctx));

      if (this.tankTimer > 0) {
        this.drawTank(ctx, this.trex.x, this.trex.y, this.trex.width, this.trex.height);
      } else if (this.jetTimer > 0) {
        this.drawJet(ctx, this.trex.x, this.trex.y, this.trex.width, this.trex.height);
      } else {
        const flickerHidden = this.invincibleTimer > 0 && Math.floor(this.invincibleTimer / 6) % 2 === 0;
        const bigScale = this.invincibleTimer > CONFIG.INVINCIBLE_FRAMES ? CONFIG.INVINCIBLE_SCALE : 1;
        if (!flickerHidden) {
          this.trex.draw(ctx, this.state === 'WAITING', bigScale);
        }
      }
      if (this.droneTimer > 0) {
        this.drawDrone(ctx);
      }
      this.meter.draw(ctx, this.score);

      ctx.fillStyle = COLORS.fg();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (this.state === 'WAITING') {
        ctx.font = '13px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
        ctx.fillText('스페이스 / 탭 으로 시작', CONFIG.WIDTH / 2, CONFIG.HEIGHT / 2 - 20);
      } else if (this.state === 'CRASHED') {
        ctx.font = 'bold 20px "Courier New", monospace';
        ctx.fillText('GAME OVER', CONFIG.WIDTH / 2, CONFIG.HEIGHT / 2 - 15);
        if (this.gameOverTimer <= 0) {
          ctx.font = '13px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
          ctx.fillText('스페이스 / 탭 으로 재시작', CONFIG.WIDTH / 2, CONFIG.HEIGHT / 2 + 10);
        }
      }
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }

    loop(time) {
      if (!this.lastTime) this.lastTime = time;
      let dt = time - this.lastTime;
      dt = Math.min(dt, 100);
      this.lastTime = time;
      const frames = dt / (1000 / CONFIG.FPS);

      this.update(frames);
      this.draw();

      requestAnimationFrame((t) => this.loop(t));
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('game-canvas');
    new Runner(canvas);
  });
})();
