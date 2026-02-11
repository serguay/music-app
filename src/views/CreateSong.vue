<template>
  <div class="min-h-screen bg-[#0b0f16] text-white">
    <!-- Top bar -->
    <header class="sticky top-0 z-20 border-b border-white/10 bg-[#0b0f16]/80 backdrop-blur">
      <div class="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <div class="flex items-center gap-3">
          <div class="h-9 w-9 rounded-lg bg-white/10" />
          <div>
            <div class="text-sm font-semibold leading-5">Crear tu canción</div>
            <div class="text-xs text-white/60">Proyecto (vacío)</div>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <button class="rounded-md bg-white/10 px-3 py-2 text-xs font-medium hover:bg-white/15">⏮</button>
          <button class="rounded-md bg-white/10 px-3 py-2 text-xs font-medium hover:bg-white/15">⏯</button>
          <button class="rounded-md bg-white/10 px-3 py-2 text-xs font-medium hover:bg-white/15">⏭</button>
          <div class="mx-2 h-6 w-px bg-white/10" />
          <div class="rounded-md bg-white/5 px-3 py-2 text-xs text-white/70">BPM —</div>
          <div class="rounded-md bg-white/5 px-3 py-2 text-xs text-white/70">Compás —</div>
        </div>

        <div class="flex items-center gap-2">
          <button class="rounded-md bg-white/10 px-3 py-2 text-xs font-medium hover:bg-white/15">Guardar</button>
          <button class="rounded-md bg-emerald-500/80 px-3 py-2 text-xs font-semibold hover:bg-emerald-500">Exportar</button>
        </div>
      </div>
    </header>

    <!-- Main layout -->
    <main class="mx-auto grid max-w-7xl grid-cols-12 gap-4 px-4 py-4">
      <!-- Left browser (Ableton-ish) -->
      <aside class="col-span-12 md:col-span-3">
        <div class="rounded-xl border border-white/10 bg-white/5">
          <div class="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div class="text-xs font-semibold text-white/80">Biblioteca</div>
            <div class="h-7 w-20 rounded-md bg-white/10" />
          </div>
          <div class="p-4">
            <div class="space-y-2">
              <div class="h-9 rounded-lg bg-white/5" />
              <div class="h-9 rounded-lg bg-white/5" />
              <div class="h-9 rounded-lg bg-white/5" />
              <div class="h-9 rounded-lg bg-white/5" />
              <div class="h-9 rounded-lg bg-white/5" />
            </div>
            <div class="mt-4 rounded-lg border border-dashed border-white/15 bg-white/5 p-3 text-xs text-white/60">
              Arrastra samples/instrumentos aquí (placeholder)
            </div>
          </div>
        </div>
      </aside>

      <!-- Center: arrangement/grid -->
      <section class="col-span-12 md:col-span-9">
        <div class="rounded-xl border border-white/10 bg-white/5">
          <div class="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div class="text-xs font-semibold text-white/80">Arreglo</div>
            <div class="flex items-center gap-2">
              <div class="h-7 w-24 rounded-md bg-white/10" />
              <div class="h-7 w-24 rounded-md bg-white/10" />
              <div class="h-7 w-24 rounded-md bg-white/10" />
            </div>
          </div>

          <!-- Timeline / grid placeholder -->
          <div class="relative h-[46vh] overflow-hidden">
            <!-- subtle grid -->
            <div
              class="absolute inset-0 opacity-60"
              :style="{
                backgroundImage:
                  'linear-gradient(to right, rgba(255,255,255,0.06) 1px, transparent 1px),\n   linear-gradient(to bottom, rgba(255,255,255,0.04) 1px, transparent 1px)',
                backgroundSize: '64px 64px'
              }"
            />

            <!-- track lanes -->
            <div class="absolute inset-0">
              <div class="grid h-full grid-rows-6">
                <div v-for="i in 6" :key="i" class="border-b border-white/10" />
              </div>
            </div>

            <!-- empty state -->
            <div class="relative flex h-full items-center justify-center">
              <div class="max-w-md rounded-xl border border-dashed border-white/15 bg-[#0b0f16]/30 p-5 text-center">
                <div class="text-sm font-semibold">Zona de clips (vacía)</div>
                <div class="mt-1 text-xs text-white/60">Luego aquí pintamos clips, loops, regiones, etc.</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Bottom: mixer/device rack (Ableton-ish) -->
        <div class="mt-4 rounded-xl border border-white/10 bg-white/5">
          <div class="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div class="text-xs font-semibold text-white/80">Mezclador / Dispositivos</div>
            <div class="flex items-center gap-2">
              <div class="h-7 w-24 rounded-md bg-white/10" />
              <div class="h-7 w-24 rounded-md bg-white/10" />
            </div>
          </div>

          <div class="grid grid-cols-12 gap-3 p-3">
            <!-- track strips -->
            <div class="col-span-12 lg:col-span-8">
              <div class="flex gap-3 overflow-x-auto pb-2">
                <div v-for="t in 8" :key="t" class="min-w-[140px] rounded-xl border border-white/10 bg-[#0b0f16]/40 p-3">
                  <div class="h-4 w-20 rounded bg-white/10" />
                  <div class="mt-3 h-24 rounded-lg bg-white/5" />
                  <div class="mt-3 grid grid-cols-2 gap-2">
                    <div class="h-10 rounded-lg bg-white/5" />
                    <div class="h-10 rounded-lg bg-white/5" />
                    <div class="h-10 rounded-lg bg-white/5" />
                    <div class="h-10 rounded-lg bg-white/5" />
                  </div>
                  <div class="mt-3 h-20 rounded-lg bg-white/5" />
                </div>
              </div>
            </div>

            <!-- device chain -->
            <div class="col-span-12 lg:col-span-4">
              <div class="rounded-xl border border-white/10 bg-[#0b0f16]/40 p-3">
                <div class="flex items-center justify-between">
                  <div class="text-xs font-semibold text-white/80">Rack</div>
                  <div class="h-7 w-16 rounded-md bg-white/10" />
                </div>
                <div class="mt-3 space-y-2">
                  <div class="h-12 rounded-lg bg-white/5" />
                  <div class="h-12 rounded-lg bg-white/5" />
                  <div class="h-12 rounded-lg bg-white/5" />
                </div>
                <div class="mt-3 rounded-lg border border-dashed border-white/15 bg-white/5 p-3 text-xs text-white/60">
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
