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
          <button class="cs-btn" type="button" @click="rewindTransport">⏮</button>
          <button class="cs-btn" type="button" @click="togglePlay" :aria-pressed="isPlaying">
            {{ isPlaying ? '⏸' : '▶' }}
          </button>
          <button class="cs-btn" type="button">⏭</button>
          <div class="cs-sep" aria-hidden="true" />
          <div class="cs-pill cs-pill--edit">
            <span class="cs-pill__label">BPM</span>
            <input
              class="cs-pill__input"
              type="number"
              min="20"
              max="300"
              step="1"
              v-model.number="grid.bpm"
              @keydown.enter="$event.target.blur()"
            />
          </div>
          <div class="cs-pill cs-pill--edit">
            <span class="cs-pill__label">Compás</span>
            <select class="cs-pill__select" v-model="timeSig">
              <option value="4/4">4/4</option>
              <option value="3/4">3/4</option>
              <option value="6/8">6/8</option>
              <option value="2/4">2/4</option>
              <option value="5/4">5/4</option>
              <option value="7/8">7/8</option>
            </select>
          </div>
          <div class="cs-pill cs-pill--edit">
            <span class="cs-pill__label">Snap</span>
            <select class="cs-pill__select cs-pill__select--snap" v-model="snapMode">
              <option value="none">(none)</option>
              <option value="1/4beat">¼ beat</option>
              <option value="1/2beat">½ beat</option>
              <option value="beat">Beat</option>
              <option value="bar">Bar</option>
            </select>
          </div>
          <div class="cs-sep" aria-hidden="true" />
          <div class="cs-pill cs-pill--info">
            {{ transportTimeDisplay }}
          </div>
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
            <div
              v-for="s in samples"
              :key="s.id"
              class="cs-item"
              draggable="true"
              @dragstart="onLibraryDragStart(s, $event)"
              @click="openEditor(s)"
              @dblclick="openPlayer(s)"
              :title="s.name"
            >
              <span class="cs-item__icon" aria-hidden="true">♪</span>
              <span class="cs-item__name">{{ s.name }}</span>
              <span class="cs-item__meta">{{ formatBytes(s.size) }}</span>
              <button
                class="cs-item__dots"
                type="button"
                title="Opciones"
                @click.stop="openSampleMenu(s, $event)"
                @pointerdown.stop
              >⋯</button>
            </div>

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
          :class="['cs-grid', { 'cs-grid--paste': pasteArmed && clipboard }]"
          @dragover.prevent
          @drop.prevent="onGridDrop"
          @click="onGridClick"
        >
          <!-- Ruler (bar numbers) -->
          <div class="cs-ruler" :style="{ width: gridCanvasStyle.width }">
            <div
              class="cs-ruler__bar"
              v-for="b in totalBars"
              :key="b"
              :style="{ width: barWidthPx + 'px' }"
            >
              <span class="cs-ruler__num">{{ b }}</span>
              <div class="cs-ruler__beats">
                <div
                  class="cs-ruler__beat"
                  v-for="bt in beatsPerBar"
                  :key="bt"
                  :style="{ width: beatWidthPx + 'px' }"
                >
                  <span v-if="bt > 1" class="cs-ruler__tick">{{ bt }}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="cs-grid__canvas" :style="gridCanvasStyle">
            <!-- Dynamic grid lines via inline style -->
            <div class="cs-grid__lines" :style="gridLinesStyle" />

            <!-- grid lanes (visual rows) -->
            <div class="cs-grid__lanes" :style="lanesStyle">
              <div class="cs-grid__lane" v-for="i in grid.lanes" :key="i" />
            </div>

            <!-- Playhead -->
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
                :class="{
                  'cs-clip--dragging': drag.clipId === c.id,
                  'cs-clip--selected': selectedClipId === c.id,
                  'cs-clip--active': activeClipIds.has(c.id)
                }"
                :style="clipStyle(c)"
                @pointerdown.prevent="onClipPointerDown(c, $event)"
                @click.stop="onClipClick(c)"
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
                  <div class="cs-clip__info">
                    <div class="cs-clip__name">{{ sampleName(c.sampleId) }}</div>
                    <div class="cs-clip__meta">
                      <span>{{ formatTime(c.startSec) }}</span>
                      <span class="cs-clip__ch" :style="channelBadgeStyle(c.channel)">CH {{ c.channel }}</span>
                    </div>
                  </div>
                  <!-- 3-dot menu button -->
                  <button
                    class="cs-clip__menu"
                    type="button"
                    title="Asignar canal mixer"
                    @click.stop="openChannelPopup(c, $event)"
                    @pointerdown.stop
                  >⋯</button>
                </div>
                <div
                  class="cs-clip__resize"
                  title="Arrastra para alargar"
                  @pointerdown.stop.prevent="onClipResizePointerDown(c, $event)"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- Channel assignment popup -->
        <Teleport to="body">
          <div
            v-if="channelPopup.open"
            class="cs-chpopup-backdrop"
            @click="closeChannelPopup"
          />
          <div
            v-if="channelPopup.open"
            class="cs-chpopup"
            :style="channelPopupStyle"
          >
            <div class="cs-chpopup__head">
              <div class="cs-chpopup__title">Canal Mixer</div>
              <div class="cs-chpopup__sample">{{ channelPopupClipName }}</div>
            </div>
            <div class="cs-chpopup__grid">
              <button
                v-for="ch in mixerChannelCount"
                :key="ch - 1"
                class="cs-chpopup__btn"
                :class="{ 'cs-chpopup__btn--active': channelPopup.clip && channelPopup.clip.channel === (ch - 1) }"
                :style="channelPopupBtnStyle(ch - 1)"
                type="button"
                @click="assignChannel(ch - 1)"
              >
                {{ ch - 1 }}
              </button>
            </div>
          </div>
        </Teleport>

        <!-- Sample context menu popup -->
        <Teleport to="body">
          <div
            v-if="sampleMenu.open"
            class="cs-chpopup-backdrop"
            @click="closeSampleMenu"
          />
          <div
            v-if="sampleMenu.open"
            class="cs-samplemenu"
            :style="sampleMenuStyle"
          >
            <div class="cs-samplemenu__name">{{ sampleMenu.sample?.name || '' }}</div>
            <button
              class="cs-samplemenu__btn cs-samplemenu__btn--danger"
              type="button"
              @click="confirmDeleteSample"
            >
              <span class="cs-samplemenu__icon">🗑</span>
              Eliminar audio
            </button>
          </div>
        </Teleport>

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
              <div
                class="cs-strip"
                v-for="t in mixerChannelCount"
                :key="t"
                :class="{ 'cs-strip--active': mixerSignals[t - 1] > 0 }"
              >
                <div class="cs-strip__head">
                  <div class="cs-strip__name-label">CH {{ t - 1 }}</div>
                  <div class="cs-strip__clip-name" :title="channelClipNames(t - 1)">
                    {{ channelClipNames(t - 1) || '—' }}
                  </div>
                </div>
                <div class="cs-strip__meter-wrap">
                  <div class="cs-strip__meter">
                    <div
                      class="cs-strip__meter-fill"
                      :style="meterFillStyle(t - 1)"
                    />
                    <div
                      class="cs-strip__meter-peak"
                      :style="meterPeakStyle(t - 1)"
                    />
                    <!-- dB marks -->
                    <div class="cs-strip__meter-marks">
                      <div class="cs-strip__meter-mark" style="bottom: 95%"><span>0</span></div>
                      <div class="cs-strip__meter-mark" style="bottom: 70%"><span>-6</span></div>
                      <div class="cs-strip__meter-mark" style="bottom: 45%"><span>-18</span></div>
                      <div class="cs-strip__meter-mark" style="bottom: 15%"><span>-36</span></div>
                    </div>
                  </div>
                  <div class="cs-strip__meter">
                    <div
                      class="cs-strip__meter-fill"
                      :style="meterFillStyleR(t - 1)"
                    />
                    <div
                      class="cs-strip__meter-peak"
                      :style="meterPeakStyleR(t - 1)"
                    />
                  </div>
                </div>
                <div class="cs-strip__knobs">
                  <div class="cs-strip__knob-group">
                    <div class="cs-knob" aria-hidden="true" />
                    <span class="cs-knob__label">Pan</span>
                  </div>
                  <div class="cs-strip__knob-group">
                    <div class="cs-knob" aria-hidden="true" />
                    <span class="cs-knob__label">Send</span>
                  </div>
                </div>
                <div class="cs-strip__fader-wrap">
                  <div class="cs-strip__fader" aria-hidden="true">
                    <div class="cs-strip__fader-track" />
                    <div class="cs-strip__fader-thumb" />
                  </div>
                </div>
                <div
                  class="cs-strip__signal-glow"
                  :style="signalGlowStyle(t - 1)"
                />
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
const DB_VERSION = 2;
const STORE = 'samples';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
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
  if (stored.buffer instanceof ArrayBuffer) return stored.buffer;
  return null;
}

async function computePeaks(blob, numPeaks = 256) {
  if (!blob) return { peaks: [], duration: 0 };
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return { peaks: [], duration: 0 };
    const ctx = new AC();
    const raw = await blob.arrayBuffer();
    const audioBuf = await ctx.decodeAudioData(raw.slice(0));
    const duration = audioBuf.duration;
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
    return { peaks, duration };
  } catch (_) {
    return { peaks: [], duration: 0 };
  }
}

// Channel color palette
const CHANNEL_COLORS = [
  { h: 160, s: 80, l: 50 }, // green-teal
  { h: 220, s: 85, l: 60 }, // blue
  { h: 280, s: 70, l: 60 }, // purple
  { h: 35,  s: 90, l: 55 }, // orange
  { h: 340, s: 75, l: 58 }, // pink
  { h: 55,  s: 85, l: 52 }, // yellow
  { h: 190, s: 80, l: 50 }, // cyan
  { h: 0,   s: 75, l: 55 }, // red
];

function chColor(ch, alpha = 1) {
  const c = CHANNEL_COLORS[ch % CHANNEL_COLORS.length];
  return `hsla(${c.h}, ${c.s}%, ${c.l}%, ${alpha})`;
}

export default {
  name: 'CreateSong',

  data() {
    return {
      isDragOver: false,
      isPlaying: false,
      samples: [],
      clips: [],
      selectedClipId: null,
      clipboard: null,
      pasteArmed: false,
      timeSig: '4/4',
      snapMode: 'beat',
      mixerChannelCount: 8,
      grid: {
        cell: 64,
        laneHeight: 64,
        lanes: 6,
        cols: 64,
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
        mode: null,
        startX: 0,
        startY: 0,
        originX: 0,
        originY: 0,
        originW: 0,
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
      },
      // Mixer signal state
      mixerSignals: new Array(8).fill(0),       // 0..1 current signal level per channel
      mixerPeaks: new Array(8).fill(0),          // peak hold values
      mixerPeakDecay: new Array(8).fill(0),      // timestamps for peak decay
      activeClipIds: new Set(),                   // clips currently under playhead
      playingAudios: new Map(),                    // clip.id -> Audio element

      // Channel assignment popup
      channelPopup: {
        open: false,
        clip: null,
        x: 0,
        y: 0
      },

      // Sample context menu
      sampleMenu: {
        open: false,
        sample: null,
        x: 0,
        y: 0
      }
    };
  },

  computed: {
    beatsPerBar() {
      const parts = this.timeSig.split('/');
      return parseInt(parts[0]) || 4;
    },
    beatDenominator() {
      const parts = this.timeSig.split('/');
      return parseInt(parts[1]) || 4;
    },
    beatWidthPx() {
      return this.grid.cell;
    },
    barWidthPx() {
      return this.beatsPerBar * this.beatWidthPx;
    },
    totalBars() {
      return Math.ceil((this.grid.cols * this.grid.cell) / this.barWidthPx);
    },
    gridCanvasStyle() {
      const totalW = this.totalBars * this.barWidthPx;
      const baseH = this.grid.lanes * this.grid.laneHeight;
      const h = Math.max(baseH, this.gridViewportHeight || 0);
      return {
        width: `${totalW}px`,
        height: `${h}px`
      };
    },
    gridLinesStyle() {
      const beat = this.beatWidthPx;
      const bar = this.barWidthPx;
      const lane = this.grid.laneHeight;
      return {
        position: 'absolute',
        inset: '0',
        pointerEvents: 'none',
        backgroundImage: [
          `linear-gradient(to right, rgba(255,255,255,0.08) 1px, transparent 1px)`,
          `linear-gradient(to right, rgba(255,255,255,0.22) 1px, transparent 1px)`,
          `linear-gradient(to bottom, rgba(255,255,255,0.08) 1px, transparent 1px)`
        ].join(','),
        backgroundSize: [
          `${beat}px ${lane}px`,
          `${bar}px ${lane}px`,
          `${beat}px ${lane}px`
        ].join(',')
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
    transportTimeDisplay() {
      const sec = this.transport.sec || 0;
      const bpm = this.grid.bpm || 120;
      const bpb = this.beatsPerBar;
      const totalBeats = sec * (bpm / 60);
      const bar = Math.floor(totalBeats / bpb) + 1;
      const beat = Math.floor(totalBeats % bpb) + 1;
      const tick = Math.floor((totalBeats % 1) * 100);
      return `${bar}.${beat}.${String(tick).padStart(2, '0')}`;
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
    },
    channelPopupStyle() {
      return {
        position: 'fixed',
        left: `${this.channelPopup.x}px`,
        top: `${this.channelPopup.y}px`,
        zIndex: 9999
      };
    },
    channelPopupClipName() {
      if (!this.channelPopup.clip) return '';
      return this.sampleName(this.channelPopup.clip.sampleId);
    },
    sampleMenuStyle() {
      return {
        position: 'fixed',
        left: `${this.sampleMenu.x}px`,
        top: `${this.sampleMenu.y}px`,
        zIndex: 9999
      };
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
    const stored = await dbGetAll();
    const loaded = [];

    for (const s of stored) {
      try {
        const rawData = s.data || s.blob;
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
          peaks: []
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

    for (const sample of this.samples) {
      computePeaks(sample.blob).then(({ peaks, duration }) => {
        sample.peaks = peaks;
        sample._peaksDuration = duration;
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
    // ── Channel colors ──
    channelBadgeStyle(ch) {
      return {
        background: chColor(ch, 0.22),
        color: chColor(ch, 0.95),
        borderColor: chColor(ch, 0.35)
      };
    },

    channelPopupBtnStyle(ch) {
      const isActive = this.channelPopup.clip && this.channelPopup.clip.channel === ch;
      return {
        '--ch-color': chColor(ch, 1),
        '--ch-bg': chColor(ch, isActive ? 0.25 : 0.08),
        '--ch-border': chColor(ch, isActive ? 0.65 : 0.2)
      };
    },

    channelClipNames(ch) {
      const names = this.clips
        .filter(c => c.channel === ch)
        .map(c => this.sampleName(c.sampleId));
      const unique = [...new Set(names)];
      return unique.join(', ');
    },

    // ── Mixer signal styles ──
    meterFillStyle(ch) {
      const level = this.mixerSignals[ch] || 0;
      const pct = Math.min(100, level * 100);
      const color = chColor(ch, 0.9);
      const colorDim = chColor(ch, 0.4);
      return {
        height: `${pct}%`,
        background: `linear-gradient(to top, ${colorDim}, ${color})`,
        boxShadow: level > 0.5 ? `0 0 10px ${chColor(ch, 0.4)}` : 'none'
      };
    },

    meterFillStyleR(ch) {
      // Slightly offset for stereo feel
      const level = Math.max(0, (this.mixerSignals[ch] || 0) - 0.03 + Math.random() * 0.06);
      const pct = Math.min(100, level * 100);
      const color = chColor(ch, 0.85);
      const colorDim = chColor(ch, 0.35);
      return {
        height: `${pct}%`,
        background: `linear-gradient(to top, ${colorDim}, ${color})`
      };
    },

    meterPeakStyle(ch) {
      const peak = this.mixerPeaks[ch] || 0;
      const pct = Math.min(100, peak * 100);
      return {
        bottom: `${pct}%`,
        background: peak > 0.85 ? '#ef4444' : chColor(ch, 1),
        opacity: peak > 0.02 ? 1 : 0
      };
    },

    meterPeakStyleR(ch) {
      const peak = Math.max(0, (this.mixerPeaks[ch] || 0) - 0.02);
      const pct = Math.min(100, peak * 100);
      return {
        bottom: `${pct}%`,
        background: peak > 0.85 ? '#ef4444' : chColor(ch, 1),
        opacity: peak > 0.02 ? 1 : 0
      };
    },

    signalGlowStyle(ch) {
      const level = this.mixerSignals[ch] || 0;
      if (level < 0.01) return { opacity: 0 };
      return {
        opacity: level * 0.7,
        background: `radial-gradient(ellipse at center bottom, ${chColor(ch, 0.35)}, transparent 70%)`,
        boxShadow: `0 0 20px ${chColor(ch, 0.15)}`
      };
    },

    // ── Sample context menu ──
    openSampleMenu(sample, event) {
      const rect = event.target.getBoundingClientRect();
      let x = rect.right + 6;
      let y = rect.top - 4;
      if (x + 180 > window.innerWidth) x = rect.left - 186;
      if (y + 60 > window.innerHeight) y = window.innerHeight - 70;
      if (y < 10) y = 10;
      this.sampleMenu.open = true;
      this.sampleMenu.sample = sample;
      this.sampleMenu.x = x;
      this.sampleMenu.y = y;
    },

    closeSampleMenu() {
      this.sampleMenu.open = false;
      this.sampleMenu.sample = null;
    },

    async confirmDeleteSample() {
      const sample = this.sampleMenu.sample;
      if (!sample) return;
      this.closeSampleMenu();
      // Stop audio for clips that use this sample
      for (const c of this.clips) {
        if (c.sampleId === sample.id) {
          const a = this.playingAudios.get(c.id);
          if (a) { try { a.pause(); } catch (_) {} this.playingAudios.delete(c.id); }
        }
      }
      // Remove clips that use this sample
      this.clips = this.clips.filter(c => c.sampleId !== sample.id);
      // Clear editor if showing this sample
      if (this.editor.sample?.id === sample.id) {
        this.editor.sample = null;
        this.editor.peaks = [];
      }
      await this.removeSample(sample);
    },

    // ── Channel popup ──
    openChannelPopup(clip, event) {
      const rect = event.target.getBoundingClientRect();
      // Position popup near the button
      let x = rect.right + 6;
      let y = rect.top - 10;
      // Keep in viewport
      if (x + 240 > window.innerWidth) x = rect.left - 246;
      if (y + 160 > window.innerHeight) y = window.innerHeight - 170;
      if (y < 10) y = 10;

      this.channelPopup.open = true;
      this.channelPopup.clip = clip;
      this.channelPopup.x = x;
      this.channelPopup.y = y;
    },

    closeChannelPopup() {
      this.channelPopup.open = false;
      this.channelPopup.clip = null;
    },

    assignChannel(ch) {
      if (!this.channelPopup.clip) return;
      const idx = this.clips.findIndex(c => c.id === this.channelPopup.clip.id);
      if (idx < 0) return;
      const updated = { ...this.clips[idx], channel: ch };
      this.clips.splice(idx, 1, updated);
      this.channelPopup.clip = updated;
      // Close after a tiny delay so user sees the selection
      setTimeout(() => this.closeChannelPopup(), 180);
    },

    // ── Grid viewport ──
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

    drawClipWaveforms() {
      const el = this.$el;
      if (!el) return;

      for (const clip of this.clips) {
        const canvas = el.querySelector(`canvas[data-clip-id="${clip.id}"]`);
        if (!canvas) continue;

        const sample = this.sampleById(clip.sampleId);
        const allPeaks = sample?.peaks || [];

        const ctx = canvas.getContext('2d');
        if (!ctx) continue;

        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        if (allPeaks.length === 0) continue;

        const duration = sample._peaksDuration || 1;
        const trimStart = Number(sample.trimStart || 0);
        const trimEnd = sample.trimEnd != null ? Number(sample.trimEnd) : duration;

        const startFrac = Math.max(0, Math.min(1, trimStart / duration));
        const endFrac = Math.max(0, Math.min(1, trimEnd / duration));

        const iStart = Math.floor(startFrac * allPeaks.length);
        const iEnd = Math.ceil(endFrac * allPeaks.length);
        const peaks = allPeaks.slice(iStart, Math.max(iStart + 1, iEnd));

        const mid = h / 2;
        const barW = w / peaks.length;

        // Use channel color for clip waveform
        const chIdx = clip.channel || 0;
        const baseColor = chColor(chIdx, 0.70);
        const dimColor = chColor(chIdx, 0.05);
        const brightColor = chColor(chIdx, 0.55);
        const strokeColor = chColor(chIdx, 0.85);
        const strokeDim = chColor(chIdx, 0.50);

        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, dimColor);
        grad.addColorStop(0.3, brightColor);
        grad.addColorStop(0.5, baseColor);
        grad.addColorStop(0.7, brightColor);
        grad.addColorStop(1, dimColor);

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

        ctx.beginPath();
        ctx.moveTo(0, mid);
        for (let i = 0; i < peaks.length; i++) {
          const x = i * barW;
          const amp = peaks[i] * (h * 0.45);
          ctx.lineTo(x, mid - amp);
        }
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, mid);
        for (let i = 0; i < peaks.length; i++) {
          const x = i * barW;
          const amp = peaks[i] * (h * 0.45);
          ctx.lineTo(x, mid + amp);
        }
        ctx.strokeStyle = strokeDim;
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
        data: arrayBuffer,
        trimStart: updated.trimStart,
        trimEnd: updated.trimEnd
      });

      this.drawWaveform();
      this.$nextTick(() => this.drawClipWaveforms());
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
      return this.totalBars * this.barWidthPx;
    },

    rewindTransport() {
      this.transport.sec = 0;
      this.transport.fired = new Set();
      this.playheadX = 0;
      // Stop all playing clip audios
      for (const [id, a] of this.playingAudios) {
        try { a.pause(); a.currentTime = 0; } catch (_) {}
      }
      this.playingAudios.clear();
      // Reset mixer signals
      this.mixerSignals = new Array(this.mixerChannelCount).fill(0);
      this.mixerPeaks = new Array(this.mixerChannelCount).fill(0);
      this.activeClipIds = new Set();
    },

    startTransport() {
      this.isPlaying = true;
      this.transport.sec = 0;
      this.transport.prevX = 0;
      this.transport.fired = new Set();
      this.playheadX = 0;
      this.transport.lastTs = performance.now();
      this.mixerSignals = new Array(this.mixerChannelCount).fill(0);
      this.mixerPeaks = new Array(this.mixerChannelCount).fill(0);

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

        // Update mixer signals based on which clips the playhead overlaps
        this.updateMixerSignals(nextX, ts);

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
      // Stop all playing clip audios
      for (const [id, a] of this.playingAudios) {
        try { a.pause(); a.currentTime = 0; } catch (_) {}
      }
      this.playingAudios.clear();
      // Decay signals to 0
      this.mixerSignals = new Array(this.mixerChannelCount).fill(0);
      this.mixerPeaks = new Array(this.mixerChannelCount).fill(0);
      this.activeClipIds = new Set();
    },

    /**
     * Update mixer signal levels: check which clips the playhead is inside
     * and set signal levels on their assigned channels.
     */
    updateMixerSignals(headX, ts) {
      const newSignals = new Array(this.mixerChannelCount).fill(0);
      const newActive = new Set();

      for (const clip of this.clips) {
        const clipStart = clip.x;
        const clipEnd = clip.x + clip.w;

        if (headX >= clipStart && headX <= clipEnd) {
          const ch = clip.channel || 0;
          if (ch < this.mixerChannelCount) {
            // Calculate a pseudo-signal based on sample peaks at current position
            const progress = (headX - clipStart) / (clipEnd - clipStart);
            const sample = this.sampleById(clip.sampleId);
            let level = 0.75; // default level

            if (sample && sample.peaks && sample.peaks.length > 0) {
              const peakIdx = Math.floor(progress * sample.peaks.length);
              const peak = sample.peaks[Math.min(peakIdx, sample.peaks.length - 1)] || 0;
              level = 0.15 + peak * 0.85; // scale to 0.15..1.0
            }

            // Add a bit of randomness for realism
            level += (Math.random() - 0.5) * 0.08;
            level = Math.max(0.1, Math.min(1.0, level));

            // Sum/max across clips on same channel
            newSignals[ch] = Math.min(1.0, Math.max(newSignals[ch], level));
            newActive.add(clip.id);
          }
        }
      }

      // Update peak hold
      const newPeaks = [...this.mixerPeaks];
      for (let i = 0; i < this.mixerChannelCount; i++) {
        if (newSignals[i] > newPeaks[i]) {
          newPeaks[i] = newSignals[i];
          this.mixerPeakDecay[i] = ts;
        } else {
          // Decay peak after 600ms hold
          const elapsed = ts - (this.mixerPeakDecay[i] || 0);
          if (elapsed > 600) {
            newPeaks[i] = Math.max(newSignals[i], newPeaks[i] - 0.025);
          }
        }
      }

      this.mixerSignals = newSignals;
      this.mixerPeaks = newPeaks;
      this.activeClipIds = newActive;
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
      // Stop previous audio for this clip if still playing
      const prev = this.playingAudios.get(clip.id);
      if (prev) { try { prev.pause(); prev.currentTime = 0; } catch (_) {} }
      
      const a = new Audio(s.url);
      a.volume = 0.95;
      a.currentTime = Math.max(0, trim.start || 0);
      if (trim.end != null) {
        const stopAt = Math.max(0, trim.end);
        a.ontimeupdate = () => {
          if (a.currentTime >= stopAt) {
            a.pause();
            a.currentTime = 0;
            a.ontimeupdate = null;
            this.playingAudios.delete(clip.id);
          }
        };
      }
      a.onended = () => { this.playingAudios.delete(clip.id); };
      this.playingAudios.set(clip.id, a);
      const p = a.play();
      if (p && p.catch) p.catch(() => {});
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

    clipWidthForSample(sample) {
      // Calculate clip width in pixels based on audio duration
      const trim = this.getTrim(sample);
      const duration = sample._peaksDuration || 0;
      const trimStart = trim.start || 0;
      const trimEnd = trim.end != null ? trim.end : duration;
      const audioDur = Math.max(0, trimEnd - trimStart);
      
      if (audioDur <= 0) return this.grid.cell * 3; // fallback

      const secsPerCell = this.cellSeconds();
      const cells = Math.max(1, Math.ceil(audioDur / secsPerCell));
      return cells * this.grid.cell;
    },

    clipStyle(c) {
      const chIdx = c.channel || 0;
      const borderColor = chColor(chIdx, 0.4);
      const bgColor = chColor(chIdx, 0.08);
      return {
        transform: `translate(${c.x}px, ${c.y}px)`,
        width: `${c.w}px`,
        height: `${this.grid.laneHeight}px`,
        borderColor,
        background: bgColor
      };
    },

    snap(v) {
      if (this.snapMode === 'none') return Math.max(0, Math.round(v));
      let gridPx;
      switch (this.snapMode) {
        case '1/4beat': gridPx = this.grid.cell / 4; break;
        case '1/2beat': gridPx = this.grid.cell / 2; break;
        case 'bar':     gridPx = this.barWidthPx; break;
        case 'beat':
        default:        gridPx = this.grid.cell; break;
      }
      return Math.max(0, Math.round(v / gridPx) * gridPx);
    },

    snapLane(y) {
      if (this.snapMode === 'none') {
        const h = this.grid.laneHeight;
        const max = (this.grid.lanes - 1) * h;
        return Math.max(0, Math.min(max, Math.round(y)));
      }
      const h = this.grid.laneHeight;
      const max = (this.grid.lanes - 1) * h;
      const snapped = Math.round(y / h) * h;
      return Math.max(0, Math.min(max, snapped));
    },

    onClipClick(clip) {
      if (this.selectedClipId === clip.id) {
        this.clipboard = { ...clip };
        this.pasteArmed = true;
        return;
      }
      this.selectedClipId = clip.id;
      this.pasteArmed = false;
    },

    onGridClick(e) {
      // Close channel popup if open
      if (this.channelPopup.open) {
        this.closeChannelPopup();
        return;
      }

      const scrollEl = this.$refs.gridScroll;
      if (!scrollEl) return;

      if (this.pasteArmed && this.clipboard) {
        const rect = scrollEl.getBoundingClientRect();
        const px = e.clientX - rect.left + scrollEl.scrollLeft;
        const py = e.clientY - rect.top + scrollEl.scrollTop;

        const x = this.snap(px);
        const y = this.snapLane(py);

        const pasted = {
          ...this.clipboard,
          id: uid(),
          x,
          y
        };

        this.clips.push(pasted);
        this.selectedClipId = pasted.id;
        this.pasteArmed = false;
        return;
      }

      this.selectedClipId = null;
      this.pasteArmed = false;
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

      // Auto-assign channel based on lane
      const lane = Math.round(y / this.grid.laneHeight);
      const channel = lane % this.mixerChannelCount;

      const clip = {
        id: uid(),
        sampleId: s.id,
        x,
        y,
        w: this.clipWidthForSample(s),
        startSec: 0,
        channel
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
      this.drag.mode = 'move';
      this.drag.pointerId = e.pointerId;
      this.drag.startX = e.clientX;
      this.drag.startY = e.clientY;
      this.drag.originX = clip.x;
      this.drag.originY = clip.y;
      this.drag.originW = clip.w;

      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
    },

    onClipResizePointerDown(clip, e) {
      this.drag.clipId = clip.id;
      this.drag.mode = 'resize';
      this.drag.pointerId = e.pointerId;
      this.drag.startX = e.clientX;
      this.drag.startY = e.clientY;
      this.drag.originX = clip.x;
      this.drag.originY = clip.y;
      this.drag.originW = clip.w;

      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
    },

    onClipPointerMove(e) {
      if (!this.drag.clipId) return;
      if (this.drag.pointerId != null && e.pointerId !== this.drag.pointerId) return;

      const idx = this.clips.findIndex((c) => c.id === this.drag.clipId);
      if (idx < 0) return;

      const clip = this.clips[idx];
      const dx = e.clientX - this.drag.startX;
      const dy = e.clientY - this.drag.startY;

      if (this.drag.mode === 'resize') {
        const minW = this.grid.cell;
        const nextW = Math.max(minW, this.snap(this.drag.originW + dx));
        const updated = { ...clip, w: nextW };
        this.clips.splice(idx, 1, updated);
        return;
      }

      const nextX = this.snap(this.drag.originX + dx);
      const nextY = this.snapLane(this.drag.originY + dy);
      const updated = { ...clip, x: nextX, y: nextY };
      this.clips.splice(idx, 1, updated);
    },

    onClipPointerUp(e) {
      if (!this.drag.clipId) return;
      if (this.drag.pointerId != null && e.pointerId !== this.drag.pointerId) return;
      this.drag.clipId = null;
      this.drag.mode = null;
      this.drag.pointerId = null;
    },

    removeClip(clip) {
      // Stop audio if this clip is playing
      const a = this.playingAudios.get(clip.id);
      if (a) {
        try { a.pause(); a.currentTime = 0; } catch (_) {}
        this.playingAudios.delete(clip.id);
      }
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

        await dbPut(sample);

        const blob = new Blob([arrayBuffer], { type });
        const url = URL.createObjectURL(blob);

        const { peaks, duration: peaksDuration } = await computePeaks(blob);

        this.samples.push({
          id,
          name: f.name,
          type,
          size: f.size,
          createdAt: sample.createdAt,
          blob,
          url,
          peaks,
          _peaksDuration: peaksDuration
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
/* Ableton-ish layout */
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

.cs-pill--edit {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
}

.cs-pill__label {
  font-size: 10px;
  font-weight: 800;
  color: rgba(255,255,255,0.50);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.cs-pill__input {
  width: 48px;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.10);
  border-radius: 6px;
  color: var(--text);
  font-size: 13px;
  font-weight: 700;
  padding: 4px 6px;
  text-align: center;
  -moz-appearance: textfield;
}

.cs-pill__input::-webkit-inner-spin-button,
.cs-pill__input::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.cs-pill__input:focus {
  outline: none;
  border-color: var(--primary);
  background: rgba(16,185,129,0.10);
}

.cs-pill__select {
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.10);
  border-radius: 6px;
  color: var(--text);
  font-size: 13px;
  font-weight: 700;
  padding: 4px 6px;
  cursor: pointer;
}

.cs-pill__select:focus {
  outline: none;
  border-color: var(--primary);
}

.cs-pill__select--snap {
  min-width: 72px;
}

.cs-pill--info {
  font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
  font-size: 13px;
  font-weight: 700;
  color: var(--primary);
  min-width: 72px;
  text-align: center;
  letter-spacing: 0.5px;
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

.cs-list__empty {
  padding: 10px 4px 0;
  color: var(--muted2);
  font-size: 12px;
}

.cs-item {
  width: 100%;
  display: grid;
  grid-template-columns: 22px 1fr auto auto;
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

.cs-item__dots {
  appearance: none;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.08);
  color: rgba(255,255,255,0.55);
  width: 24px;
  height: 24px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 900;
  line-height: 1;
  cursor: pointer;
  display: grid;
  place-items: center;
  opacity: 0;
  transition: opacity 120ms ease, background 120ms ease, transform 100ms ease;
  letter-spacing: 1px;
}

.cs-item:hover .cs-item__dots {
  opacity: 1;
}

.cs-item__dots:hover {
  background: rgba(255,255,255,0.15);
  color: rgba(255,255,255,0.85);
  transform: scale(1.08);
}

.cs-item__dots:active {
  transform: scale(0.95);
}

/* Sample context menu */
.cs-samplemenu {
  z-index: 9999;
  min-width: 170px;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.14);
  background: rgba(16, 20, 30, 0.95);
  -webkit-backdrop-filter: blur(16px);
  backdrop-filter: blur(16px);
  box-shadow: 0 12px 40px rgba(0,0,0,0.55), 0 0 1px rgba(255,255,255,0.10);
  padding: 8px;
  animation: cs-popup-in 150ms ease;
}

.cs-samplemenu__name {
  padding: 6px 10px 8px;
  font-size: 11px;
  font-weight: 700;
  color: rgba(255,255,255,0.50);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  border-bottom: 1px solid rgba(255,255,255,0.08);
  margin-bottom: 4px;
}

.cs-samplemenu__btn {
  appearance: none;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: rgba(255,255,255,0.82);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 100ms ease;
}

.cs-samplemenu__btn:hover {
  background: rgba(255,255,255,0.08);
}

.cs-samplemenu__btn--danger {
  color: #ef4444;
}

.cs-samplemenu__btn--danger:hover {
  background: rgba(239, 68, 68, 0.12);
}

.cs-samplemenu__icon {
  font-size: 14px;
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

.cs-grid__lines {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

/* Ruler */
.cs-ruler {
  position: sticky;
  top: 0;
  z-index: 8;
  display: flex;
  height: 28px;
  min-height: 28px;
  background: rgba(11, 15, 22, 0.85);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
  border-bottom: 1px solid rgba(255,255,255,0.12);
  user-select: none;
}

.cs-ruler__bar {
  position: relative;
  display: flex;
  align-items: stretch;
  border-right: 1px solid rgba(255,255,255,0.18);
  box-sizing: border-box;
}

.cs-ruler__num {
  position: absolute;
  top: 2px;
  left: 6px;
  font-size: 11px;
  font-weight: 800;
  color: rgba(255,255,255,0.55);
  pointer-events: none;
}

.cs-ruler__beats {
  display: flex;
  width: 100%;
}

.cs-ruler__beat {
  position: relative;
  border-left: 1px solid rgba(255,255,255,0.06);
  box-sizing: border-box;
}

.cs-ruler__beat:first-child {
  border-left: none;
}

.cs-ruler__tick {
  position: absolute;
  bottom: 2px;
  left: 4px;
  font-size: 9px;
  color: rgba(255,255,255,0.28);
  pointer-events: none;
}

.cs-grid__lanes {
  position: absolute;
  inset: 0;
  display: grid;
}

.cs-grid__lane {
  border-bottom: 1px solid rgba(255,255,255,0.08);
}

/* ── Bottom mixer (redesigned) ── */
.cs-subpanel {
  margin-top: 14px;
}

.cs-mixer {
  padding: 12px;
  display: grid;
  grid-template-columns: 1fr 280px;
  gap: 12px;
}

.cs-mixer__tracks {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 8px;
}

.cs-strip {
  position: relative;
  min-width: 82px;
  max-width: 92px;
  flex: 1 0 82px;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.08);
  background: rgba(11, 15, 22, 0.55);
  padding: 10px 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: hidden;
  transition: border-color 200ms ease, box-shadow 200ms ease;
}

.cs-strip--active {
  border-color: rgba(255,255,255,0.18);
  box-shadow: inset 0 0 20px rgba(255,255,255,0.03);
}

.cs-strip__head {
  text-align: center;
}

.cs-strip__name-label {
  font-size: 10px;
  font-weight: 800;
  color: rgba(255,255,255,0.55);
  letter-spacing: 0.8px;
  text-transform: uppercase;
}

.cs-strip__clip-name {
  margin-top: 2px;
  font-size: 9px;
  color: rgba(255,255,255,0.40);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.cs-strip__meter-wrap {
  display: flex;
  gap: 3px;
  justify-content: center;
  height: 96px;
}

.cs-strip__meter {
  position: relative;
  width: 14px;
  border-radius: 4px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.06);
  overflow: hidden;
}

.cs-strip__meter-fill {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 0%;
  border-radius: 2px;
  transition: height 60ms linear;
}

.cs-strip__meter-peak {
  position: absolute;
  left: 1px;
  right: 1px;
  height: 2px;
  border-radius: 1px;
  transition: bottom 60ms linear, opacity 300ms ease;
}

.cs-strip__meter-marks {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.cs-strip__meter-mark {
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  background: rgba(255,255,255,0.08);
}

.cs-strip__meter-mark span {
  position: absolute;
  right: -20px;
  top: -5px;
  font-size: 7px;
  color: rgba(255,255,255,0.25);
  display: none; /* show on wider strips */
}

.cs-strip__knobs {
  display: flex;
  gap: 6px;
  justify-content: center;
}

.cs-strip__knob-group {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.cs-knob {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.08);
}

.cs-knob__label {
  font-size: 8px;
  color: rgba(255,255,255,0.35);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.cs-strip__fader-wrap {
  display: flex;
  justify-content: center;
}

.cs-strip__fader {
  position: relative;
  width: 10px;
  height: 54px;
  border-radius: 5px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.06);
}

.cs-strip__fader-track {
  position: absolute;
  left: 50%;
  top: 6px;
  bottom: 6px;
  width: 2px;
  margin-left: -1px;
  background: rgba(255,255,255,0.12);
  border-radius: 1px;
}

.cs-strip__fader-thumb {
  position: absolute;
  left: -2px;
  right: -2px;
  top: 30%;
  height: 10px;
  border-radius: 3px;
  background: rgba(255,255,255,0.25);
  border: 1px solid rgba(255,255,255,0.15);
}

.cs-strip__signal-glow {
  position: absolute;
  inset: 0;
  border-radius: 12px;
  pointer-events: none;
  transition: opacity 150ms ease;
}

/* Rack */
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

/* ── Clips ── */
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
  box-shadow: 0 0 22px rgba(59,130,246,0.25), 0 0 22px rgba(16,185,129,0.20);
}

.cs-clip:hover .cs-clip__wave {
  opacity: 0.65;
}

.cs-clip--selected {
  box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.35), 0 0 26px rgba(59, 130, 246, 0.22);
}

.cs-clip--active {
  box-shadow: 0 0 18px rgba(255,255,255,0.12), 0 0 30px rgba(16,185,129,0.25);
}

.cs-clip--active .cs-clip__wave {
  opacity: 1;
}

.cs-grid--paste {
  cursor: copy;
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
  gap: 4px;
  padding: 4px 6px 4px 8px;
  height: 100%;
  box-sizing: border-box;
}

.cs-clip__info {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
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
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  color: rgba(255,255,255,0.7);
  text-shadow: 0 1px 4px rgba(0,0,0,0.6);
}

.cs-clip__ch {
  font-size: 9px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 4px;
  border: 1px solid;
  letter-spacing: 0.3px;
}

/* 3-dot menu button on clip */
.cs-clip__menu {
  appearance: none;
  background: rgba(0,0,0,0.35);
  border: 1px solid rgba(255,255,255,0.12);
  color: rgba(255,255,255,0.75);
  width: 24px;
  height: 24px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 900;
  line-height: 1;
  cursor: pointer;
  display: grid;
  place-items: center;
  flex: 0 0 24px;
  opacity: 0;
  transition: opacity 120ms ease, background 120ms ease, transform 100ms ease;
  letter-spacing: 1px;
}

.cs-clip:hover .cs-clip__menu {
  opacity: 1;
}

.cs-clip__menu:hover {
  background: rgba(255,255,255,0.15);
  transform: scale(1.08);
}

.cs-clip__menu:active {
  transform: scale(0.95);
}

.cs-clip__resize {
  position: absolute;
  top: 0;
  right: 0;
  width: 14px;
  height: 100%;
  cursor: ew-resize;
  background: linear-gradient(to left, rgba(255,255,255,0.10), rgba(255,255,255,0.00));
  opacity: 0.0;
  transition: opacity 120ms ease;
  z-index: 2;
}

.cs-clip:hover .cs-clip__resize {
  opacity: 1;
}

.cs-clip__resize::after {
  content: "";
  position: absolute;
  top: 10px;
  bottom: 10px;
  right: 4px;
  width: 2px;
  border-radius: 999px;
  background: rgba(255,255,255,0.25);
  box-shadow: 0 0 12px rgba(59,130,246,0.25), 0 0 12px rgba(16,185,129,0.18);
}

/* ── Channel popup ── */
.cs-chpopup-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9998;
}

.cs-chpopup {
  z-index: 9999;
  width: 230px;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,0.14);
  background: rgba(16, 20, 30, 0.95);
  -webkit-backdrop-filter: blur(16px);
  backdrop-filter: blur(16px);
  box-shadow: 0 16px 48px rgba(0,0,0,0.55), 0 0 1px rgba(255,255,255,0.10);
  padding: 14px;
  animation: cs-popup-in 150ms ease;
}

@keyframes cs-popup-in {
  from { opacity: 0; transform: scale(0.92) translateY(-4px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

.cs-chpopup__head {
  margin-bottom: 12px;
}

.cs-chpopup__title {
  font-size: 12px;
  font-weight: 800;
  color: rgba(255,255,255,0.85);
  letter-spacing: 0.3px;
}

.cs-chpopup__sample {
  margin-top: 3px;
  font-size: 11px;
  color: rgba(255,255,255,0.50);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cs-chpopup__grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}

.cs-chpopup__btn {
  appearance: none;
  padding: 10px 0;
  border-radius: 10px;
  background: var(--ch-bg);
  border: 1px solid var(--ch-border);
  color: var(--ch-color);
  font-size: 14px;
  font-weight: 800;
  cursor: pointer;
  transition: transform 100ms ease, box-shadow 120ms ease, background 120ms ease;
}

.cs-chpopup__btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
}

.cs-chpopup__btn:active {
  transform: translateY(0px);
}

.cs-chpopup__btn--active {
  box-shadow: 0 0 0 2px var(--ch-color), 0 4px 16px rgba(0,0,0,0.3);
  transform: scale(1.05);
}

.cs-audition {
  display: none;
}

/* Editor */
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

/* Playhead */
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
</style>