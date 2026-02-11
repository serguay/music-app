<template>
  <div class="cs">
    <!-- Top bar -->
    <header class="cs-topbar">
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
          <button class="cs-btn" type="button">⏯</button>
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
              @click="openPlayer(s)"
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

        <div class="cs-grid">
          <div class="cs-grid__lanes">
            <div class="cs-grid__lane" v-for="i in 6" :key="i" />
          </div>

          <div class="cs-grid__empty">
            <div class="cs-emptycard">
              <div class="cs-emptycard__title">Zona de clips (vacía)</div>
              <div class="cs-emptycard__sub">Luego aquí pintamos clips, loops, regiones, etc.</div>
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
    </div>
  </div>
</template>

<script>
const DB_NAME = 'connected-music';
const DB_VERSION = 1;
const STORE = 'samples';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
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
  // algunos navegadores no rellenan type; validamos por extensión también
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

export default {
  name: 'CreateSong',

  data() {
    return {
      isDragOver: false,
      samples: [],
      player: {
        open: false,
        sample: null
      }
    };
  },

  async mounted() {
    // Carga persistida (IndexedDB)
    const stored = await dbGetAll();
    this.samples = stored
      .map((s) => ({
        ...s,
        // reconstruimos URL para reproducir
        url: URL.createObjectURL(s.blob)
      }))
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  },

  beforeUnmount() {
    // Limpieza de object URLs
    this.samples.forEach((s) => {
      if (s.url) URL.revokeObjectURL(s.url);
    });
  },

  methods: {
    onDragEnter() {
      this.isDragOver = true;
    },
    onDragOver() {
      this.isDragOver = true;
    },
    onDragLeave(e) {
      // si realmente salimos del dropzone
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
      // limpiar input para permitir re-seleccionar el mismo archivo
      e.target.value = '';
      await this.importFiles(files);
    },

    async importFiles(files) {
      const audios = files.filter(isAudioFile);
      if (audios.length === 0) return;

      for (const f of audios) {
        const id = uid();
        const blob = f.slice(0, f.size, f.type || 'audio/*');
        const sample = {
          id,
          name: f.name,
          type: f.type || 'audio/*',
          size: f.size,
          createdAt: Date.now(),
          blob
        };

        // persistimos
        await dbPut(sample);

        // y lo añadimos al UI
        const url = URL.createObjectURL(blob);
        this.samples.push({ ...sample, url });
      }
    },

    openPlayer(sample) {
      this.player.open = true;
      this.player.sample = sample;

      this.$nextTick(() => {
        const el = this.$refs.audioEl;
        if (el && el.play) {
          // autoplay suave (si el navegador lo permite)
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
      // (por ahora no hay botón en UI, pero dejamos el método listo)
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
  position: sticky;
  top: 0;
  z-index: 20;
  border-bottom: 1px solid var(--stroke);
  background: rgba(11, 15, 22, 0.78);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
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
}

.cs-grid::before {
  content: "";
  position: absolute;
  inset: 0;
  opacity: 0.65;
  background-image:
    linear-gradient(to right, rgba(255, 255, 255, 0.07) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(255, 255, 255, 0.05) 1px, transparent 1px);
  background-size: 64px 64px;
  pointer-events: none;
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
</style>