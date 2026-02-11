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
          <div class="cs-list">
            <div class="cs-list__row" v-for="i in 5" :key="i" />
          </div>

          <div class="cs-dropzone">
            Arrastra samples/instrumentos aquí (placeholder)
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
  </div>
</template>

<script>
export default {
  name: 'CreateSong'
}
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

.cs-dropzone {
  margin-top: 14px;
  border-radius: 12px;
  border: 1px dashed var(--stroke2);
  background: rgba(255, 255, 255, 0.05);
  color: var(--muted);
  font-size: 12px;
  padding: 12px;
}

.cs-dropzone--small {
  margin-top: 12px;
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