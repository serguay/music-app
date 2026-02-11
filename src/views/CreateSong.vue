<template>
  <div class="cs">
    <!-- Top bar -->
    <header class="cs-topbar" :class="{ 'cs-topbar--playing': isPlaying }">
      <div class="cs-topbar__inner">
        <div class="cs-brand">
          <div class="cs-brand__logo" aria-hidden="true" />
          <div class="cs-brand__meta">
            <div class="cs-brand__title">Crear tu canción</div>
            <div class="cs-brand__subtitle">Proyecto (vacío)</div>
          </div>
        </div>

        <div class="cs-transport" aria-label="Controles">
          <button class="cs-btn" type="button">⏮</button>
          <button class="cs-btn" type="button" @click="togglePlay" :aria-pressed="isPlaying">
            {{ isPlaying ? '⏸' : '▶' }}
          </button>
          <button class="cs-btn" type="button">⏭</button>
          <div class="cs-sep" aria-hidden="true" />
          <div class="cs-pill">BPM —</div>
          <div class="cs-pill">Compás —</div>
        </div>

        <div class="cs-actions">
          <button class="cs-btn" type="button">Guardar</button>
          <button class="cs-btn cs-btn--primary" type="button">Exportar</button>
        </div>
      </div>
    </header>

    <!-- Main layout -->
    <main class="cs-main">
      <!-- Left browser (Ableton-ish) -->
      <aside class="cs-panel cs-panel--library">
        <div class="cs-panel__head">
          <div class="cs-panel__title">Biblioteca</div>
          <div class="cs-chip" aria-hidden="true" />
        </div>

        <div class="cs-panel__body">
          <div class="cs-list" role="list">
            <button
              v-for="s in samples"
              :key="s.id"
              class="cs-item"
              type="button"
              draggable="true"
              @dragstart="onLibraryDragStart(s, $event)"
              @click="openEditor(s)"
              @dblclick="openPlayer(s)"
              :title="s.name"
            >
              <span class="cs-item__icon" aria-hidden="true">♪</span>
              <span class="cs-item__name">{{ s.name }}</span>
              <span class="cs-item__meta">{{ formatBytes(s.size) }}</span>
            </button>

            <div v-if="samples.length === 0" class="cs-list__empty">
              Aún no hay audios. Arrastra un .wav o .mp3 abajo.
            </div>
          </div>

          <div
            class="cs-dropzone"
            :class="{ 'cs-dropzone--active': isDragOver }"
            @dragenter.prevent="onDragEnter"
            @dragover.prevent="onDragOver"
            @dragleave.prevent="onDragLeave"
            @drop.prevent="onDrop"
            @click="filePicker?.click()"
            role="button"
            tabindex="0"
            @keydown.enter.prevent="filePicker?.click()"
            @keydown.space.prevent="filePicker?.click()"
          >
            <div class="cs-dropzone__title">Arrastra samples/instrumentos aquí</div>
            <div class="cs-dropzone__sub">o haz click para elegir archivos (wav/mp3)</div>
            <input
              ref="filePicker"
              class="cs-file"
              type="file"
              accept="audio/*,.wav,.mp3,.m4a,.aac,.ogg,.flac"
              multiple
              @change="onPickFiles"
            />
          </div>

          <div class="cs-editor" aria-label="Editor de audio">
            <div class="cs-editor__head">
              <div>
                <div class="cs-editor__title">Editor</div>
                <div class="cs-editor__sub" v-if="editor.sample">
                  {{ editor.sample.name }} · {{ formatTime(editor.duration || 0) }}
                </div>
                <div class="cs-editor__sub" v-else>
                  Selecciona un audio de la biblioteca para editarlo.
                </div>
              </div>
              <div class="cs-editor__actions" v-if="editor.sample">
                <button class="cs-btn" type="button" @click="editorPlaySelection">▶ Selección</button>
                <button class="cs-btn" type="button" @click="editorReset">Reset</button>
                <button class="cs-btn cs-btn--primary" type="button" @click="editorApply">Aplicar</button>
              </div>
            </div>

            <div class="cs-editor__body" v-if="editor.sample">
              <canvas ref="waveCanvas" class="cs-wave" width="520" height="86" aria-label="Forma de onda" />

              <div class="cs-trim">
                <div class="cs-trim__row">
                  <div class="cs-trim__lbl">Inicio</div>
                  <input class="cs-trim__range" type="range" min="0" max="1000" step="1" v-model.number="editor.start" />
                  <div class="cs-trim__val">{{ formatTime(editorStartSec) }}</div>
                </div>
                <div class="cs-trim__row">
                  <div class="cs-trim__lbl">Fin</div>
                  <input class="cs-trim__range" type="range" min="0" max="1000" step="1" v-model.number="editor.end" />
                  <div class="cs-trim__val">{{ formatTime(editorEndSec) }}</div>
                </div>
              </div>

              <div class="cs-editor__hint">
                Recorte no destructivo (guardamos inicio/fin). Próximo paso: cortar y arrastrar al grid.
              </div>
            </div>
          </div>
        </div>
      </aside>

      <!-- Center: arrangement/grid -->
      <section class="cs-panel cs-panel--arrange">
        <div class="cs-panel__head">
          <div class="cs-panel__title">Arreglo</div>
          <div class="cs-headtools" aria-hidden="true">
            <div class="cs-chip" />
            <div class="cs-chip" />
            <div class="cs-chip" />
          </div>
        </div>

        <div
          ref="gridScroll"
          class="cs-grid"
          @dragover.prevent
          @drop.prevent="onGridDrop"
        >
          <div class="cs-grid__canvas" :style="gridCanvasStyle">
            <!-- grid lanes (visual rows) -->
            <div class="cs-grid__lanes" :style="lanesStyle">
              <div class="cs-grid__lane" v-for="i in grid.lanes" :key="i" />
            </div>

            <!-- Playhead (vertical, neon) inside the grid canvas -->
            <div
              v-show="isPlaying"
              class="cs-playhead"
              :style="{ transform: `translateX(${playheadX}px)` }"
              aria-hidden="true"
            />

            <!-- Clips placed on the grid -->
            <div class="cs-clips" aria-label="Clips">
              <div
                v-for="c in clips"
                :key="c.id"
                class="cs-clip"
                :class="{ 'cs-clip--dragging': drag.clipId === c.id }"
                :style="clipStyle(c)"
                @pointerdown.prevent="onClipPointerDown(c, $event)"
                @contextmenu.prevent="removeClip(c)"
                @mouseenter="onClipHover(c)"
                @mouseleave="onClipHoverEnd"
                role="button"
                tabindex="0"
              >
                <canvas
                  class="cs-clip__wave"
                  :data-clip-id="c.id"
                  :width="c.w * 2"
                  :height="grid.laneHeight * 2"
                  aria-hidden="true"
                />
                <div class="cs-clip__overlay">
                  <div class="cs-clip__name">{{ sampleName(c.sampleId) }}</div>
                  <div class="cs-clip__meta">{{ formatTime(c.startSec) }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Bottom: mixer/device rack (Ableton-ish) -->
        <div class="cs-subpanel">
          <div class="cs-panel__head cs-panel__head--sub">
            <div class="cs-panel__title">Mezclador / Dispositivos</div>
            <div class="cs-headtools" aria-hidden="true">
              <div class="cs-chip" />
              <div class="cs-chip" />
            </div>
          </div>

          <div class="cs-mixer">
            <div class="cs-mixer__tracks">
              <div class="cs-strip" v-for="t in 8" :key="t">
                <div class="cs-strip__name" aria-hidden="true" />
                <div class="cs-strip__meter" aria-hidden="true" />
                <div class="cs-strip__knobs">
                  <div class="cs-knob" aria-hidden="true" />
                  <div class="cs-knob" aria-hidden="true" />
                  <div class="cs-knob" aria-hidden="true" />
                  <div class="cs-knob" aria-hidden="true" />
                </div>
                <div class="cs-strip__fader" aria-hidden="true" />
              </div>
            </div>

            <div class="cs-mixer__rack">
              <div class="cs-rack">
                <div class="cs-rack__head">
                  <div class="cs-rack__title">Rack</div>
                  <div class="cs-chip" aria-hidden="true" />
                </div>

                <div class="cs-rack__chain">
                  <div class="cs-device" v-for="d in 3" :key="d" aria-hidden="true" />
                </div>

                <div class="cs-dropzone cs-dropzone--small">
                  Aquí van efectos/instrumentos (placeholder)
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>

    <!-- Mini player (fixed) -->
    <div v-if="player.open" class="cs-player" role="dialog" aria-label="Reproductor">
      <div class="cs-player__head">
        <div class="cs-player__title" :title="player.sample?.name || ''">
          {{ player.sample?.name || '' }}
        </div>
        <button class="cs-player__close" type="button" @click="closePlayer">✕</button>
      </div>

      <audio
        ref="audioEl"
        class="cs-player__audio"
        :src="player.sample?.url || ''"
        controls
      />
      <audio ref="auditionEl" class="cs-audition" preload="metadata" />
    </div>
  </div>
</template>

<script>
const DB_NAME = 'connected-music';
const DB_VERSION = 2; // ← bumped version to force migration
const STORE = 'samples';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
      // If upgrading from v1 we keep the same store structure;
      // the new code simply writes ArrayBuffer instead of Blob.
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}

async function dbPut(sample) {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put(sample);
  await txDone(tx);
  db.close();
}

async function dbGetAll() {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readonly');
  const req = tx.objectStore(STORE).getAll();
  const out = await new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  await txDone(tx);
  db.close();
  return out;
}

async function dbDelete(id) {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).delete(id);
  await txDone(tx);
  db.close();
}

function isAudioFile(f) {
  const name = (f.name || '').toLowerCase();
  return (
    (f.type && f.type.startsWith('audio/')) ||
    name.endsWith('.wav') ||
    name.endsWith('.mp3') ||
    name.endsWith('.m4a') ||
    name.endsWith('.aac') ||
    name.endsWith('.ogg') ||
    name.endsWith('.flac')
  );
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Safely extract an ArrayBuffer from whatever was stored in IndexedDB.
 * Old records may contain a Blob (v1), new ones store ArrayBuffer (v2).
 */
async function toArrayBuffer(stored) {
  if (!stored) return null;
  if (stored instanceof ArrayBuffer) return stored;
  if (stored instanceof Blob) {
    try {
      return await stored.arrayBuffer();
    } catch (_) {
      return null;
    }
  }
  // Uint8Array or other typed array
  if (stored.buffer instanceof ArrayBuffer) return stored.buffer;
  return null;
}

/**
 * Decode a Blob into an AudioBuffer, then downsample to N peak values.
 * Used to draw mini-waveforms inside grid clips.
 */
async function computePeaks(blob, numPeaks = 256) {
  if (!blob) return [];
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return [];
    const ctx = new AC();
    const raw = await blob.arrayBuffer();
    const audioBuf = await ctx.decodeAudioData(raw.slice(0));
    const ch = audioBuf.getChannelData(0);
    const step = Math.max(1, Math.floor(ch.length / numPeaks));
    const peaks = [];
    for (let i = 0; i < numPeaks; i++) {
      const start = i * step;
      const end = Math.min(ch.length, start + step);
      let max = 0;
      for (let j = start; j < end; j++) {
        const v = Math.abs(ch[j]);
        if (v > max) max = v;
      }
      peaks.push(max);
    }
    try { await ctx.close(); } catch (_) {}
    return peaks;
  } catch (_) {
    return [];
  }
}

export default {
  name: 'CreateSong',

  data() {
    return {
      isDragOver: false,
      isPlaying: false,
      samples: [],
      clips: [],
      grid: {
        cell: 64,
        laneHeight: 64,
        lanes: 6,
        cols: 48,
        bpm: 120,
        cellBeats: 1
      },
      gridViewportHeight: 0,
      transport: {
        sec: 0,
        raf: 0,
        lastTs: 0,
        prevX: 0,
        fired: new Set()
      },
      playheadX: 0,
      drag: {
        clipId: null,
        startX: 0,
        startY: 0,
        originX: 0,
        originY: 0,
        pointerId: null
      },
      lastAuditionSampleId: null,
      player: {
        open: false,
        sample: null
      },
      editor: {
        sample: null,
        start: 0,
        end: 1000,
        duration: 0,
        peaks: [],
        loading: false
      }
    };
  },

  computed: {
    gridCanvasStyle() {
      const baseH = this.grid.lanes * this.grid.laneHeight;
      const h = Math.max(baseH, this.gridViewportHeight || 0);
      return {
        width: `${this.grid.cols * this.grid.cell}px`,
        height: `${h}px`
      };
    },
    lanesStyle() {
      const baseH = this.grid.lanes * this.grid.laneHeight;
      const h = Math.max(baseH, this.gridViewportHeight || 0);
      return {
        gridTemplateRows: `repeat(${this.grid.lanes}, ${this.grid.laneHeight}px)`,
        height: `${h}px`
      };
    },
    editorStartSec() {
      if (!this.editor.sample) return 0;
      const d = this.editor.duration || 0;
      const a = Math.min(this.editor.start, this.editor.end);
      return (a / 1000) * d;
    },
    editorEndSec() {
      if (!this.editor.sample) return 0;
      const d = this.editor.duration || 0;
      const b = Math.max(this.editor.start, this.editor.end);
      return (b / 1000) * d;
    }
  },

  watch: {
    'editor.start'() { this.drawWaveform(); },
    'editor.end'() { this.drawWaveform(); },
    clips: {
      deep: true,
      handler() { this.$nextTick(() => this.drawClipWaveforms()); }
    }
  },

  async mounted() {
    // Load persisted samples from IndexedDB
    const stored = await dbGetAll();
    const loaded = [];

    for (const s of stored) {
      try {
        // Handle both old (Blob) and new (ArrayBuffer) stored data
        const rawData = s.data || s.blob; // v2 uses 'data', v1 used 'blob'
        const arrayBuffer = await toArrayBuffer(rawData);

        if (!arrayBuffer) {
          console.warn(`Skipping sample "${s.name}" – could not read stored data.`);
          continue;
        }

        const type = s.type || 'audio/*';
        const blob = new Blob([arrayBuffer], { type });
        const url = URL.createObjectURL(blob);

        loaded.push({
          id: s.id,
          name: s.name,
          type,
          size: s.size,
          createdAt: s.createdAt,
          trimStart: s.trimStart,
          trimEnd: s.trimEnd,
          blob,
          url,
          peaks: [] // will be filled below
        });
      } catch (err) {
        console.warn(`Failed to load sample "${s.name}":`, err);
      }
    }

    this.samples = loaded.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    this.playheadX = 0;
    this.updateGridViewport();
    window.addEventListener('resize', this.updateGridViewport);
    window.addEventListener('pointermove', this.onClipPointerMove);
    window.addEventListener('pointerup', this.onClipPointerUp);

    // Compute peaks for all loaded samples in background
    for (const sample of this.samples) {
      computePeaks(sample.blob).then((peaks) => {
        sample.peaks = peaks;
        this.$nextTick(() => this.drawClipWaveforms());
      });
    }
  },

  beforeUnmount() {
    this.samples.forEach((s) => {
      if (s.url) URL.revokeObjectURL(s.url);
    });
    window.removeEventListener('resize', this.updateGridViewport);
    this.stopTransport();
    window.removeEventListener('pointermove', this.onClipPointerMove);
    window.removeEventListener('pointerup', this.onClipPointerUp);
    this.stopAudition();
  },

  methods: {
    updateGridViewport() {
      const el = this.$refs.gridScroll;
      this.gridViewportHeight = el ? el.clientHeight : 0;
    },

    getTrim(sample) {
      const start = Math.max(0, Number(sample.trimStart || 0));
      const endRaw = sample.trimEnd;
      const end = endRaw == null ? null : Math.max(0, Number(endRaw));
      return { start, end };
    },

    async openEditor(sample) {
      this.editor.sample = sample;
      const trimStart = Number(sample.trimStart || 0);
      const trimEnd = sample.trimEnd == null ? null : Number(sample.trimEnd);

      this.editor.start = 0;
      this.editor.end = 1000;
      this.editor.duration = 0;
      this.editor.peaks = [];

      await this.loadWaveform(sample);

      const d = this.editor.duration || 0;
      if (d > 0) {
        const s = Math.max(0, Math.min(d, trimStart));
        const e = trimEnd == null ? d : Math.max(0, Math.min(d, trimEnd));
        this.editor.start = Math.round((s / d) * 1000);
        this.editor.end = Math.round((e / d) * 1000);
      }
    },

    async loadWaveform(sample) {
      if (!sample || !sample.blob) return;
      this.editor.loading = true;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ctx = new AC();
        const buf = await sample.blob.arrayBuffer();
        const audioBuf = await ctx.decodeAudioData(buf.slice(0));
        const ch0 = audioBuf.getChannelData(0);
        const n = 512;
        const step = Math.max(1, Math.floor(ch0.length / n));
        const peaks = new Array(n).fill(0).map((_, i) => {
          const start = i * step;
          const end = Math.min(ch0.length, start + step);
          let m = 0;
          for (let j = start; j < end; j++) {
            const v = Math.abs(ch0[j]);
            if (v > m) m = v;
          }
          return m;
        });
        this.editor.duration = audioBuf.duration;
        this.editor.peaks = peaks;
        this.$nextTick(() => this.drawWaveform());
        try { await ctx.close(); } catch (_) {}
      } catch (err) {
        console.warn('loadWaveform error:', err);
      } finally {
        this.editor.loading = false;
      }
    },

    drawWaveform() {
      const c = this.$refs.waveCanvas;
      if (!c) return;
      const ctx = c.getContext('2d');
      if (!ctx) return;

      const w = c.width;
      const h = c.height;
      ctx.clearRect(0, 0, w, h);

      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      ctx.fillRect(0, 0, w, h);

      const peaks = this.editor.peaks || [];
      if (peaks.length === 0) return;

      const mid = h / 2;
      const barW = w / peaks.length;

      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      for (let i = 0; i < peaks.length; i++) {
        const p = peaks[i];
        const y = Math.max(1, p * (h * 0.42));
        const x = i * barW;
        ctx.fillRect(x, mid - y, Math.max(1, barW * 0.9), y * 2);
      }

      const s = Math.min(this.editor.start, this.editor.end) / 1000;
      const e = Math.max(this.editor.start, this.editor.end) / 1000;
      ctx.fillStyle = 'rgba(16,185,129,0.10)';
      ctx.fillRect(s * w, 0, (e - s) * w, h);
      ctx.strokeStyle = 'rgba(16,185,129,0.75)';
      ctx.lineWidth = 2;
      ctx.strokeRect(s * w, 1, (e - s) * w, h - 2);
    },

    /**
     * Draw waveforms inside all clip canvases on the grid.
     * Looks up each clip's sample peaks and renders a filled waveform.
     */
    drawClipWaveforms() {
      const el = this.$el;
      if (!el) return;

      for (const clip of this.clips) {
        const canvas = el.querySelector(`canvas[data-clip-id="${clip.id}"]`);
        if (!canvas) continue;

        const sample = this.sampleById(clip.sampleId);
        const peaks = sample?.peaks || [];

        const ctx = canvas.getContext('2d');
        if (!ctx) continue;

        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        if (peaks.length === 0) continue;

        const mid = h / 2;
        const barW = w / peaks.length;

        // Gradient fill for the waveform
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, 'rgba(16, 185, 129, 0.05)');
        grad.addColorStop(0.3, 'rgba(16, 185, 129, 0.55)');
        grad.addColorStop(0.5, 'rgba(16, 185, 129, 0.70)');
        grad.addColorStop(0.7, 'rgba(16, 185, 129, 0.55)');
        grad.addColorStop(1, 'rgba(16, 185, 129, 0.05)');

        // Draw filled waveform (mirrored)
        ctx.beginPath();
        ctx.moveTo(0, mid);
        for (let i = 0; i < peaks.length; i++) {
          const x = i * barW;
          const amp = peaks[i] * (h * 0.45);
          ctx.lineTo(x, mid - amp);
        }
        ctx.lineTo(w, mid);
        for (let i = peaks.length - 1; i >= 0; i--) {
          const x = i * barW;
          const amp = peaks[i] * (h * 0.45);
          ctx.lineTo(x, mid + amp);
        }
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();

        // Thin center line
        ctx.beginPath();
        ctx.moveTo(0, mid);
        for (let i = 0; i < peaks.length; i++) {
          const x = i * barW;
          const amp = peaks[i] * (h * 0.45);
          ctx.lineTo(x, mid - amp);
        }
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.85)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Mirror stroke
        ctx.beginPath();
        ctx.moveTo(0, mid);
        for (let i = 0; i < peaks.length; i++) {
          const x = i * barW;
          const amp = peaks[i] * (h * 0.45);
          ctx.lineTo(x, mid + amp);
        }
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.50)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    },

    editorPlaySelection() {
      if (!this.editor.sample) return;
      const s = this.editorStartSec;
      const e = this.editorEndSec;
      this.playUrlSegment(this.editor.sample.url, s, e, 0.95);
    },

    editorReset() {
      if (!this.editor.sample) return;
      this.editor.start = 0;
      this.editor.end = 1000;
      this.drawWaveform();
    },

    async editorApply() {
      const sample = this.editor.sample;
      if (!sample) return;
      const start = this.editorStartSec;
      const end = this.editorEndSec;

      const idx = this.samples.findIndex((s) => s.id === sample.id);
      if (idx < 0) return;

      const updated = { ...this.samples[idx], trimStart: start, trimEnd: end };
      this.samples.splice(idx, 1, updated);
      this.editor.sample = updated;

      // Convert blob to ArrayBuffer for safe IndexedDB storage
      let arrayBuffer;
      try {
        arrayBuffer = await updated.blob.arrayBuffer();
      } catch (_) {
        console.warn('editorApply: could not convert blob to ArrayBuffer');
        return;
      }

      await dbPut({
        id: updated.id,
        name: updated.name,
        type: updated.type,
        size: updated.size,
        createdAt: updated.createdAt,
        data: arrayBuffer, // ← ArrayBuffer, not Blob
        trimStart: updated.trimStart,
        trimEnd: updated.trimEnd
      });

      this.drawWaveform();
    },

    playUrlSegment(url, startSec = 0, endSec = null, volume = 0.95) {
      try {
        const a = new Audio(url);
        a.volume = volume;
        a.currentTime = Math.max(0, startSec || 0);
        if (endSec != null) {
          const stopAt = Math.max(0, endSec);
          a.ontimeupdate = () => {
            if (a.currentTime >= stopAt) {
              a.pause();
              a.currentTime = 0;
              a.ontimeupdate = null;
            }
          };
        }
        const p = a.play();
        if (p && p.catch) p.catch(() => {});
      } catch (_) {}
    },

    togglePlay() {
      if (this.isPlaying) {
        this.stopTransport();
      } else {
        this.startTransport();
      }
    },

    cellSeconds() {
      const bpm = this.grid.bpm || 120;
      const beats = this.grid.cellBeats || 1;
      return (60 / bpm) * beats;
    },

    gridWidthPx() {
      return this.grid.cols * this.grid.cell;
    },

    startTransport() {
      this.isPlaying = true;
      this.transport.sec = 0;
      this.transport.prevX = 0;
      this.transport.fired = new Set();
      this.playheadX = 0;
      this.transport.lastTs = performance.now();

      const tick = (ts) => {
        if (!this.isPlaying) return;

        const dt = Math.max(0, (ts - this.transport.lastTs) / 1000);
        this.transport.lastTs = ts;
        this.transport.sec += dt;

        const width = this.gridWidthPx();
        const cell = this.grid.cell;
        const secsPerCell = this.cellSeconds();
        const totalCells = width > 0 ? Math.max(1, Math.floor(width / cell)) : 1;
        const loopSec = totalCells * secsPerCell;

        const prevX = this.playheadX;

        if (this.transport.sec >= loopSec) {
          this.transport.sec = this.transport.sec % loopSec;
          this.transport.fired = new Set();
        }

        const nextX = width > 0 ? (this.transport.sec / loopSec) * width : 0;
        this.playheadX = nextX;

        this.triggerClips(prevX, nextX, prevX > nextX);

        this.transport.raf = requestAnimationFrame(tick);
      };

      this.transport.raf = requestAnimationFrame(tick);
    },

    stopTransport() {
      this.isPlaying = false;
      if (this.transport.raf) {
        cancelAnimationFrame(this.transport.raf);
        this.transport.raf = 0;
      }
      this.transport.lastTs = 0;
    },

    triggerClips(prevX, nextX, looped) {
      if (!this.clips || this.clips.length === 0) return;

      for (const clip of this.clips) {
        const startX = clip.x;
        if (this.transport.fired.has(clip.id)) continue;

        const crossed = looped
          ? (startX >= prevX || startX <= nextX)
          : (startX >= prevX && startX <= nextX);

        if (crossed) {
          this.transport.fired.add(clip.id);
          this.playClip(clip);
        }
      }
    },

    playClip(clip) {
      const s = this.sampleById(clip.sampleId);
      if (!s || !s.url) return;
      const trim = this.getTrim(s);
      this.playUrlSegment(s.url, trim.start, trim.end, 0.95);
    },

    onLibraryDragStart(sample, e) {
      try {
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', sample.id);
      } catch (_) {}
    },

    sampleById(id) {
      return this.samples.find((s) => s.id === id) || null;
    },

    sampleName(id) {
      const s = this.sampleById(id);
      return s ? s.name : 'Sample';
    },

    formatTime(sec) {
      const s = Math.max(0, Math.floor(sec || 0));
      const m = Math.floor(s / 60);
      const r = s % 60;
      return `${m}:${String(r).padStart(2, '0')}`;
    },

    clipStyle(c) {
      return {
        transform: `translate(${c.x}px, ${c.y}px)`,
        width: `${c.w}px`,
        height: `${this.grid.laneHeight}px`
      };
    },

    snap(v) {
      const cell = this.grid.cell;
      return Math.max(0, Math.round(v / cell) * cell);
    },

    snapLane(y) {
      const h = this.grid.laneHeight;
      const max = (this.grid.lanes - 1) * h;
      const snapped = Math.round(y / h) * h;
      return Math.max(0, Math.min(max, snapped));
    },

    onGridDrop(e) {
      const sampleId = (e.dataTransfer && e.dataTransfer.getData('text/plain')) || '';
      const s = this.sampleById(sampleId);
      if (!s) return;

      const scrollEl = this.$refs.gridScroll;
      if (!scrollEl) return;

      const rect = scrollEl.getBoundingClientRect();
      const px = e.clientX - rect.left + scrollEl.scrollLeft;
      const py = e.clientY - rect.top + scrollEl.scrollTop;

      const x = this.snap(px);
      const y = this.snapLane(py);

      const clip = {
        id: uid(),
        sampleId: s.id,
        x,
        y,
        w: this.grid.cell * 3,
        startSec: 0
      };

      this.clips.push(clip);

      this.$nextTick(() => {
        const pad = 80;
        if (x - scrollEl.scrollLeft > scrollEl.clientWidth - pad) scrollEl.scrollLeft = Math.max(0, x - (scrollEl.clientWidth - pad));
        if (y - scrollEl.scrollTop > scrollEl.clientHeight - pad) scrollEl.scrollTop = Math.max(0, y - (scrollEl.clientHeight - pad));
      });
    },

    onClipPointerDown(clip, e) {
      this.drag.clipId = clip.id;
      this.drag.pointerId = e.pointerId;
      this.drag.startX = e.clientX;
      this.drag.startY = e.clientY;
      this.drag.originX = clip.x;
      this.drag.originY = clip.y;

      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
    },

    onClipPointerMove(e) {
      if (!this.drag.clipId) return;
      if (this.drag.pointerId != null && e.pointerId !== this.drag.pointerId) return;

      const dx = e.clientX - this.drag.startX;
      const dy = e.clientY - this.drag.startY;

      const idx = this.clips.findIndex((c) => c.id === this.drag.clipId);
      if (idx < 0) return;

      const nextX = this.snap(this.drag.originX + dx);
      const nextY = this.snapLane(this.drag.originY + dy);

      const updated = { ...this.clips[idx], x: nextX, y: nextY };
      this.clips.splice(idx, 1, updated);
    },

    onClipPointerUp(e) {
      if (!this.drag.clipId) return;
      if (this.drag.pointerId != null && e.pointerId !== this.drag.pointerId) return;
      this.drag.clipId = null;
      this.drag.pointerId = null;
    },

    removeClip(clip) {
      this.clips = this.clips.filter((c) => c.id !== clip.id);
    },

    onClipHover(clip) {
      const s = this.sampleById(clip.sampleId);
      if (!s || !s.url) return;
      this.audition(s);
    },

    onClipHoverEnd() {
      this.stopAudition();
    },

    audition(sample) {
      const el = this.$refs.auditionEl;
      if (!el) return;

      const trim = this.getTrim(sample);

      if (this.lastAuditionSampleId === sample.id && !el.paused) return;
      this.lastAuditionSampleId = sample.id;

      try {
        el.ontimeupdate = null;
        el.src = sample.url;
        el.currentTime = trim.start;
        el.volume = 0.85;
        if (trim.end != null) {
          const stopAt = trim.end;
          el.ontimeupdate = () => {
            if (el.currentTime >= stopAt) {
              el.pause();
              el.currentTime = trim.start;
              el.ontimeupdate = null;
            }
          };
        }
        const p = el.play();
        if (p && p.catch) p.catch(() => {});
      } catch (_) {}
    },

    stopAudition() {
      const el = this.$refs.auditionEl;
      if (!el) return;
      try {
        el.pause();
        el.currentTime = 0;
        el.ontimeupdate = null;
      } catch (_) {}
    },

    onDragEnter() {
      this.isDragOver = true;
    },
    onDragOver() {
      this.isDragOver = true;
    },
    onDragLeave(e) {
      if (e && e.currentTarget && e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return;
      this.isDragOver = false;
    },

    async onDrop(e) {
      this.isDragOver = false;
      const files = Array.from(e.dataTransfer?.files || []);
      await this.importFiles(files);
    },

    async onPickFiles(e) {
      const files = Array.from(e.target?.files || []);
      e.target.value = '';
      await this.importFiles(files);
    },

    async importFiles(files) {
      const audios = files.filter(isAudioFile);
      if (audios.length === 0) return;

      for (const f of audios) {
        const id = uid();
        const type = f.type || 'audio/*';

        // ✅ FIX: Read file as ArrayBuffer for safe IndexedDB storage
        let arrayBuffer;
        try {
          arrayBuffer = await f.arrayBuffer();
        } catch (err) {
          console.warn(`Could not read file "${f.name}":`, err);
          continue;
        }

        const sample = {
          id,
          name: f.name,
          type,
          size: f.size,
          createdAt: Date.now(),
          data: arrayBuffer
        };

        // Persist to IndexedDB
        await dbPut(sample);

        // Create a fresh Blob + URL for the UI
        const blob = new Blob([arrayBuffer], { type });
        const url = URL.createObjectURL(blob);

        // Compute waveform peaks for clip display
        const peaks = await computePeaks(blob);

        this.samples.push({
          id,
          name: f.name,
          type,
          size: f.size,
          createdAt: sample.createdAt,
          blob,
          url,
          peaks
        });
      }
    },

    openPlayer(sample) {
      this.stopAudition();
      this.player.open = true;
      this.player.sample = sample;

      this.$nextTick(() => {
        const el = this.$refs.audioEl;
        if (el && el.play) {
          try { el.play(); } catch (_) {}
        }
      });
    },

    closePlayer() {
      const el = this.$refs.audioEl;
      if (el && el.pause) {
        try { el.pause(); } catch (_) {}
      }
      this.player.open = false;
      this.player.sample = null;
    },

    formatBytes(bytes) {
      if (!bytes && bytes !== 0) return '';
      const units = ['B', 'KB', 'MB', 'GB'];
      let v = bytes;
      let i = 0;
      while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i++;
      }
      return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
    },

    async removeSample(sample) {
      await dbDelete(sample.id);
      if (sample.url) URL.revokeObjectURL(sample.url);
      this.samples = this.samples.filter((s) => s.id !== sample.id);
      if (this.player.sample?.id === sample.id) this.closePlayer();
    }
  }
};
</script>

<style scoped>
/* Ableton-ish layout (sin Tailwind) */
.cs {
  --bg: #0b0f16;
  --panel: rgba(255, 255, 255, 0.05);
  --panel2: rgba(11, 15, 22, 0.40);
  --stroke: rgba(255, 255, 255, 0.10);
  --stroke2: rgba(255, 255, 255, 0.15);
  --text: rgba(255, 255, 255, 0.92);
  --muted: rgba(255, 255, 255, 0.65);
  --muted2: rgba(255, 255, 255, 0.45);
  --chip: rgba(255, 255, 255, 0.10);
  --chip2: rgba(255, 255, 255, 0.07);
  --primary: rgba(16, 185, 129, 0.90);

  min-height: 100vh;
  background: radial-gradient(1200px 700px at 20% -10%, rgba(99, 102, 241, 0.10), transparent 55%),
    radial-gradient(900px 650px at 100% 0%, rgba(16, 185, 129, 0.08), transparent 60%),
    var(--bg);
  color: var(--text);
}

/* Topbar */
.cs-topbar {
  position: relative;
  position: sticky;
  top: 0;
  z-index: 20;
  border-bottom: 1px solid var(--stroke);
  background: rgba(11, 15, 22, 0.78);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
}

.cs-topbar--playing::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  background: linear-gradient(90deg, rgba(16,185,129,0.0), rgba(16,185,129,0.9), rgba(59,130,246,0.9), rgba(16,185,129,0.0));
  box-shadow: 0 0 18px rgba(16,185,129,0.55), 0 0 18px rgba(59,130,246,0.35);
}

.cs-topbar__inner {
  max-width: 1120px;
  margin: 0 auto;
  padding: 12px 16px;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 12px;
}

.cs-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.cs-brand__logo {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.cs-brand__meta {
  min-width: 0;
}

.cs-brand__title {
  font-size: 13px;
  font-weight: 700;
  line-height: 1.1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cs-brand__subtitle {
  margin-top: 2px;
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cs-transport {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
}

.cs-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: flex-end;
}

.cs-btn {
  appearance: none;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.08);
  color: var(--text);
  padding: 8px 10px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: transform 120ms ease, background 120ms ease, border-color 120ms ease;
}

.cs-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.12);
  transform: translateY(-1px);
}

.cs-btn:active {
  transform: translateY(0px);
}

.cs-btn--primary {
  background: var(--primary);
  border-color: rgba(16, 185, 129, 0.55);
  color: #07130f;
  font-weight: 800;
}

.cs-btn--primary:hover {
  background: rgba(16, 185, 129, 1);
}

.cs-pill {
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 12px;
  color: var(--muted);
}

.cs-sep {
  width: 1px;
  height: 22px;
  background: var(--stroke);
  margin: 0 6px;
}

/* Main layout */
.cs-main {
  max-width: 1120px;
  margin: 0 auto;
  padding: 16px;
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 16px;
}

.cs-panel {
  border: 1px solid var(--stroke);
  background: var(--panel);
  border-radius: 14px;
  overflow: hidden;
}

.cs-panel__head {
  padding: 12px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--stroke);
}

.cs-panel__head--sub {
  border-top: 1px solid var(--stroke);
  border-bottom: 1px solid var(--stroke);
}

.cs-panel__title {
  font-size: 12px;
  font-weight: 800;
  color: rgba(255, 255, 255, 0.82);
  letter-spacing: 0.2px;
}

.cs-panel__body {
  padding: 14px;
}

.cs-chip {
  width: 76px;
  height: 28px;
  border-radius: 10px;
  background: var(--chip);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.cs-headtools {
  display: flex;
  gap: 8px;
}

/* Library */
.cs-list {
  display: grid;
  gap: 10px;
}

.cs-list__row {
  height: 36px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.cs-list__empty {
  padding: 10px 4px 0;
  color: var(--muted2);
  font-size: 12px;
}

.cs-item {
  width: 100%;
  display: grid;
  grid-template-columns: 22px 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 10px 10px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.06);
  color: var(--text);
  cursor: pointer;
  text-align: left;
  transition: background 120ms ease, border-color 120ms ease, transform 120ms ease;
}

.cs-item:hover {
  background: rgba(255, 255, 255, 0.09);
  border-color: rgba(255, 255, 255, 0.12);
  transform: translateY(-1px);
}

.cs-item:active {
  transform: translateY(0px);
}

.cs-item__icon {
  width: 22px;
  height: 22px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 12px;
}

.cs-item__name {
  font-weight: 700;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cs-item__meta {
  font-size: 11px;
  color: var(--muted);
}

.cs-dropzone {
  margin-top: 14px;
  border-radius: 12px;
  border: 1px dashed var(--stroke2);
  background: rgba(255, 255, 255, 0.05);
  color: var(--muted);
  font-size: 12px;
  padding: 12px;
  cursor: pointer;
  user-select: none;
  transition: background 120ms ease, border-color 120ms ease, transform 120ms ease;
}

.cs-dropzone:hover {
  background: rgba(255, 255, 255, 0.07);
  border-color: rgba(255, 255, 255, 0.18);
}

.cs-dropzone--active {
  background: rgba(16, 185, 129, 0.10);
  border-color: rgba(16, 185, 129, 0.55);
  transform: translateY(-1px);
}

.cs-dropzone__title {
  font-weight: 800;
  color: rgba(255, 255, 255, 0.85);
}

.cs-dropzone__sub {
  margin-top: 4px;
  color: var(--muted);
}

.cs-dropzone--small {
  margin-top: 12px;
}

.cs-file {
  display: none;
}

/* Arrangement grid */
.cs-grid {
  position: relative;
  height: 46vh;
  min-height: 360px;
  background: rgba(11, 15, 22, 0.22);
  overflow: auto;
}

/* nicer scrollbars */
.cs-grid::-webkit-scrollbar { height: 10px; width: 10px; }
.cs-grid::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,0.12);
  border-radius: 999px;
}
.cs-grid::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.18); }

.cs-grid__canvas {
  position: relative;
  min-height: 100%;
}

/* draw the grid lines on the canvas, not the viewport */
.cs-grid__canvas::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(to right, rgba(255, 255, 255, 0.10) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(255, 255, 255, 0.08) 1px, transparent 1px),
    linear-gradient(to right, rgba(255, 255, 255, 0.18) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(255, 255, 255, 0.14) 1px, transparent 1px);
  background-size:
    64px 64px,
    64px 64px,
    256px 256px,
    256px 256px;
  opacity: 0.75;
}

.cs-grid__lanes {
  position: absolute;
  inset: 0;
  display: grid;
}

.cs-grid__lane {
  border-bottom: 1px solid rgba(255,255,255,0.08);
}

.cs-grid__lanes {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-rows: repeat(6, 1fr);
}

.cs-grid__lane {
  border-bottom: 1px solid var(--stroke);
}

.cs-grid__empty {
  position: relative;
  height: 100%;
  display: grid;
  place-items: center;
  padding: 18px;
}

.cs-emptycard {
  max-width: 520px;
  width: 100%;
  border-radius: 14px;
  border: 1px dashed var(--stroke2);
  background: rgba(11, 15, 22, 0.35);
  padding: 16px;
  text-align: center;
}

.cs-emptycard__title {
  font-size: 14px;
  font-weight: 800;
}

.cs-emptycard__sub {
  margin-top: 6px;
  font-size: 12px;
  color: var(--muted);
}

/* Bottom mixer */
.cs-subpanel {
  margin-top: 14px;
}

.cs-mixer {
  padding: 12px;
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: 12px;
}

.cs-mixer__tracks {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 8px;
}

.cs-strip {
  min-width: 140px;
  border-radius: 14px;
  border: 1px solid var(--stroke);
  background: rgba(11, 15, 22, 0.42);
  padding: 12px;
}

.cs-strip__name {
  height: 14px;
  width: 80px;
  border-radius: 6px;
  background: var(--chip);
}

.cs-strip__meter {
  margin-top: 10px;
  height: 96px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
}

.cs-strip__knobs {
  margin-top: 12px;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.cs-knob {
  height: 40px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
}

.cs-strip__fader {
  margin-top: 12px;
  height: 76px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
}

.cs-mixer__rack {
  min-width: 0;
}

.cs-rack {
  border-radius: 14px;
  border: 1px solid var(--stroke);
  background: rgba(11, 15, 22, 0.42);
  padding: 12px;
}

.cs-rack__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.cs-rack__title {
  font-size: 12px;
  font-weight: 800;
  color: rgba(255, 255, 255, 0.82);
}

.cs-rack__chain {
  margin-top: 10px;
  display: grid;
  gap: 10px;
}

.cs-device {
  height: 48px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

/* Mini player */
.cs-player {
  position: fixed;
  right: 18px;
  bottom: 18px;
  width: min(420px, calc(100vw - 36px));
  border-radius: 14px;
  border: 1px solid var(--stroke);
  background: rgba(11, 15, 22, 0.82);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.45);
  padding: 12px;
  z-index: 50;
}

.cs-player__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.cs-player__title {
  font-size: 12px;
  font-weight: 800;
  color: rgba(255, 255, 255, 0.9);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cs-player__close {
  appearance: none;
  border: 1px solid rgba(255, 255, 255, 0.10);
  background: rgba(255, 255, 255, 0.08);
  color: var(--text);
  width: 32px;
  height: 32px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 120ms ease, transform 120ms ease;
}

.cs-player__close:hover {
  background: rgba(255, 255, 255, 0.12);
  transform: translateY(-1px);
}

.cs-player__close:active {
  transform: translateY(0px);
}

.cs-player__audio {
  width: 100%;
}

/* Responsive */
@media (max-width: 980px) {
  .cs-topbar__inner {
    grid-template-columns: 1fr;
    justify-items: stretch;
  }

  .cs-transport {
    justify-content: flex-start;
    flex-wrap: wrap;
  }

  .cs-actions {
    justify-content: flex-start;
  }

  .cs-main {
    grid-template-columns: 1fr;
  }

  .cs-mixer {
    grid-template-columns: 1fr;
  }
}

/* Clips overlay and blocks */
.cs-clips {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 5;
}

.cs-clip {
  position: absolute;
  top: 0;
  left: 0;
  border-radius: 12px;
  border: 1px solid rgba(16, 185, 129, 0.35);
  background: rgba(16, 185, 129, 0.08);
  cursor: grab;
  user-select: none;
  pointer-events: auto;
  box-sizing: border-box;
  overflow: hidden;
  transition: box-shadow 120ms ease, border-color 120ms ease, background 120ms ease;
}

.cs-clip:hover {
  border-color: rgba(59, 130, 246, 0.55);
  background: rgba(59, 130, 246, 0.10);
  box-shadow: 0 0 22px rgba(59,130,246,0.25), 0 0 22px rgba(16,185,129,0.20);
}

.cs-clip:hover .cs-clip__wave {
  opacity: 0.65;
}

.cs-clip--dragging {
  cursor: grabbing;
  box-shadow: 0 10px 30px rgba(0,0,0,0.35), 0 0 22px rgba(16,185,129,0.25);
}

.cs-clip__wave {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  opacity: 0.85;
  transition: opacity 120ms ease;
}

.cs-clip__overlay {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 6px 10px;
  height: 100%;
  box-sizing: border-box;
}

.cs-clip__name {
  font-size: 11px;
  font-weight: 800;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  text-shadow: 0 1px 4px rgba(0,0,0,0.6);
}

.cs-clip__meta {
  font-size: 10px;
  color: rgba(255,255,255,0.7);
  flex: 0 0 auto;
  text-shadow: 0 1px 4px rgba(0,0,0,0.6);
}

.cs-audition {
  display: none;
}

.cs-editor {
  margin-top: 14px;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,0.10);
  background: rgba(11, 15, 22, 0.32);
  overflow: hidden;
}

.cs-editor__head {
  padding: 12px;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
  border-bottom: 1px solid rgba(255,255,255,0.08);
}

.cs-editor__title {
  font-size: 12px;
  font-weight: 800;
  color: rgba(255,255,255,0.85);
}

.cs-editor__sub {
  margin-top: 6px;
  font-size: 12px;
  color: rgba(255,255,255,0.60);
  line-height: 1.35;
  max-width: 240px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cs-editor__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.cs-editor__body {
  padding: 12px;
}

.cs-wave {
  width: 100%;
  height: 86px;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.10);
  background: rgba(255,255,255,0.03);
}

.cs-trim {
  margin-top: 10px;
  display: grid;
  gap: 8px;
}

.cs-trim__row {
  display: grid;
  grid-template-columns: 54px 1fr 64px;
  align-items: center;
  gap: 10px;
}

.cs-trim__lbl {
  font-size: 11px;
  color: rgba(255,255,255,0.65);
  font-weight: 700;
}

.cs-trim__val {
  font-size: 11px;
  color: rgba(255,255,255,0.75);
  text-align: right;
}

.cs-trim__range {
  width: 100%;
}

.cs-editor__hint {
  margin-top: 8px;
  font-size: 11px;
  color: rgba(255,255,255,0.50);
}

/* Playhead (vertical neon line inside grid) */
.cs-playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  left: 0;
  background: linear-gradient(
    to bottom,
    rgba(16, 185, 129, 0.0),
    rgba(16, 185, 129, 0.95),
    rgba(59, 130, 246, 0.95),
    rgba(16, 185, 129, 0.0)
  );
  box-shadow: 0 0 16px rgba(16, 185, 129, 0.55), 0 0 18px rgba(59, 130, 246, 0.45);
  pointer-events: none;
  z-index: 6;
}
</style>