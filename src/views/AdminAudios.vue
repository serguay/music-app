<template>
  <div class="wrap">
    <div class="top">
      <button class="back" @click="goBack">← Volver</button>
      <h2>🎵 Audios</h2>
    </div>

    <!-- Tabs -->
    <div class="tabs">
      <button
        class="tab"
        :class="{ active: tab === 'pending' }"
        @click="tab = 'pending'"
      >
        ⏳ Pendientes
        <span v-if="pendingCount" class="pill">{{ pendingCount }}</span>
      </button>
      <button
        class="tab"
        :class="{ active: tab === 'published' }"
        @click="tab = 'published'"
      >
        ✅ Publicados
        <span v-if="audios.length" class="pill">{{ audios.length }}</span>
      </button>
    </div>

    <p v-if="loading">Cargando…</p>
    <p v-else-if="error" class="err">❌ {{ error }}</p>

    <!-- PENDIENTES -->
    <template v-else-if="tab === 'pending'">
      <p v-if="submissions.length === 0">No hay audios pendientes</p>

      <div v-else class="list">
        <div v-for="s in submissions" :key="s.id" class="card">
          <div class="info">
            <p class="name">{{ s.title || "(Sin título)" }}</p>

            <p class="meta" v-if="s.artist">
              <span class="badge">Artista</span>
              {{ s.artist }}
            </p>

            <p class="meta">
              <span class="badge">ID</span>
              <span class="mono">{{ s.id }}</span>
            </p>

            <p class="meta" v-if="s.user_id">
              <span class="badge">User</span>
              <span class="mono">{{ s.user_id }}</span>
            </p>

            <p class="meta" v-if="s.created_at">
              <span class="badge">Fecha</span>
              {{ formatDate(s.created_at) }}
            </p>

            <p class="meta" v-if="s.audio_url">
              <span class="badge">Audio URL</span>
              <span class="mono">{{ s.audio_url }}</span>
            </p>

            <div v-if="(s.image_url || s.cover_url)" class="preview">
              <img :src="(s.image_url || s.cover_url)" alt="cover" class="cover" />
            </div>

            <div v-if="s.audio_url" class="preview">
              <audio :src="s.audio_url" controls preload="none" class="audio"></audio>
            </div>
          </div>

          <div class="actions">
            <button class="ok" @click="approveSubmission(s)" :disabled="actingId === s.id">
              {{ actingId === s.id ? "Procesando…" : "Aprobar" }}
            </button>
            <button class="danger" @click="rejectSubmission(s)" :disabled="actingId === s.id">
              {{ actingId === s.id ? "Procesando…" : "Rechazar" }}
            </button>
          </div>
        </div>
      </div>
    </template>

    <!-- PUBLICADOS -->
    <template v-else>
      <p v-if="audios.length === 0">No hay audios</p>

      <div v-else class="list">
        <div v-for="a in audios" :key="a.id" class="card">
          <div class="info">
            <p class="name">{{ a.title || "(Sin título)" }}</p>
            <p class="meta" v-if="a.artist">
              <span class="badge">Artista</span>
              {{ a.artist }}
            </p>
            <p class="meta">
              <span class="badge">ID</span>
              <span class="mono">{{ a.id }}</span>
            </p>
            <p class="meta" v-if="a.user_id">
              <span class="badge">User</span>
              <span class="mono">{{ a.user_id }}</span>
            </p>
            <p class="meta" v-if="a.created_at">
              <span class="badge">Fecha</span>
              {{ formatDate(a.created_at) }}
            </p>

            <div v-if="(a.cover_url || a.image_url || a.cover)" class="preview">
              <img :src="(a.cover_url || a.image_url || a.cover)" alt="cover" class="cover" />
            </div>

            <div v-if="a.audio_url" class="preview">
              <audio :src="a.audio_url" controls preload="none" class="audio"></audio>
            </div>
          </div>

          <button class="danger" @click="removeAudio(a)" :disabled="deletingId === a.id">
            {{ deletingId === a.id ? "Borrando…" : "Eliminar" }}
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from "vue";
import { useRouter } from "vue-router";
import { supabase } from "../lib/supabase";

const router = useRouter();

const tab = ref("pending"); // 'pending' | 'published'

const audios = ref([]);
const submissions = ref([]);

const loading = ref(true);
const error = ref("");
const deletingId = ref(null);
const actingId = ref(null);

const pendingCount = computed(() => submissions.value.length);

function goBack() {
  router.push("/admin");
}

function formatDate(d) {
  try {
    return new Date(d).toLocaleString();
  } catch {
    return d;
  }
}

async function fetchAudios() {
  const { data, error: err } = await supabase
    .from("audios")
    .select("id, title, artist, user_id, audio_url, image_url, created_at")
    .order("created_at", { ascending: false });

  if (err) {
    throw err;
  }

  audios.value = data || [];
}

async function fetchSubmissions() {
  const { data, error: err } = await supabase
    .from("audio_submissions")
    .select("id, user_id, title, artist, audio_url, cover_url, image_url, status, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (err) {
    throw err;
  }

  submissions.value = data || [];
}

async function refreshAll() {
  loading.value = true;
  error.value = "";

  try {
    await Promise.all([fetchAudios(), fetchSubmissions()]);
  } catch (e) {
    error.value = e?.message || String(e);
    audios.value = [];
    submissions.value = [];
  } finally {
    loading.value = false;
  }
}

async function removeAudio(a) {
  const ok = confirm(`¿Seguro que quieres eliminar este audio?\n\n${a.title || a.id}`);
  if (!ok) return;

  deletingId.value = a.id;
  error.value = "";

  const { error: err } = await supabase.from("audios").delete().eq("id", a.id);

  if (err) {
    error.value = err.message;
  } else {
    audios.value = audios.value.filter((x) => x.id !== a.id);
  }

  deletingId.value = null;
}

async function approveSubmission(s) {
  const ok = confirm(`¿Aprobar este audio?\n\n${s.title || s.id}`);
  if (!ok) return;

  actingId.value = s.id;
  error.value = "";

  try {
    const { data: authData, error: authErr } = await supabase.auth.getUser();
    if (authErr) throw authErr;

    // 1) Mark submission approved
    const { error: upErr } = await supabase
      .from("audio_submissions")
      .update({
        status: "approved",
        reviewed_by: authData?.user?.id || null,
        reviewed_at: new Date().toISOString(),
        review_note: null,
      })
      .eq("id", s.id);

    if (upErr) throw upErr;

    // 2) Publish into audios (best-effort)
    // NOTE: This assumes these columns exist in your `audios` table.
    const payload = {
      id: s.id,
      user_id: s.user_id,
      title: s.title,
      artist: s.artist,
      audio_url: s.audio_url,
      image_url: s.image_url || s.cover_url || null,
    };

    const { error: insErr } = await supabase.from("audios").insert(payload);
    if (insErr) {
      // Rollback submission status so you don't lose it
      await supabase
        .from("audio_submissions")
        .update({ status: "pending" })
        .eq("id", s.id);
      throw insErr;
    }

    // Remove from pending list and refresh published
    submissions.value = submissions.value.filter((x) => x.id !== s.id);
    await fetchAudios();
  } catch (e) {
    error.value = e?.message || String(e);
  } finally {
    actingId.value = null;
  }
}

async function rejectSubmission(s) {
  const note = prompt("Motivo (opcional):", "");
  const ok = confirm(`¿Rechazar este audio?\n\n${s.title || s.id}`);
  if (!ok) return;

  actingId.value = s.id;
  error.value = "";

  try {
    const { data: authData, error: authErr } = await supabase.auth.getUser();
    if (authErr) throw authErr;

    const { error: upErr } = await supabase
      .from("audio_submissions")
      .update({
        status: "rejected",
        reviewed_by: authData?.user?.id || null,
        reviewed_at: new Date().toISOString(),
        review_note: note || null,
      })
      .eq("id", s.id);

    if (upErr) throw upErr;

    submissions.value = submissions.value.filter((x) => x.id !== s.id);
  } catch (e) {
    error.value = e?.message || String(e);
  } finally {
    actingId.value = null;
  }
}

onMounted(refreshAll);
</script>

<style scoped>
:global(:root){
  --bg:#f6f7fb;
  --card:#ffffff;
  --text:#0f172a;
  --muted:#64748b;
  --border:rgba(15,23,42,.08);
  --shadow:0 18px 50px rgba(2,6,23,.08);
  --shadow-soft:0 10px 25px rgba(2,6,23,.08);
  --accent:#f97316;
  --danger:#ef4444;
}

.wrap{
  max-width:860px;
  margin:0 auto;
  padding:28px 18px;
  color:var(--text);
}

.top{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  margin-bottom:16px;
}

.top h2{
  margin:0;
  font-size:1.25rem;
  font-weight:900;
  letter-spacing:-0.02em;
}

.tabs{
  display:flex;
  gap:10px;
  margin:10px 0 6px;
}

.tab{
  border:1px solid var(--border);
  background:var(--card);
  padding:10px 12px;
  border-radius:14px;
  cursor:pointer;
  font-weight:900;
  box-shadow:0 8px 18px rgba(2,6,23,.06);
  display:inline-flex;
  align-items:center;
  gap:8px;
}

.tab.active{
  outline:2px solid rgba(249,115,22,.25);
}

.pill{
  background:rgba(15,23,42,.06);
  border:1px solid var(--border);
  padding:2px 10px;
  border-radius:999px;
  font-size:.78rem;
  font-weight:1000;
}

.actions{
  display:flex;
  gap:10px;
  align-items:center;
}

.ok{
  border:none;
  background:#22c55e;
  color:white;
  font-weight:1000;
  padding:10px 14px;
  border-radius:14px;
  cursor:pointer;
  box-shadow:0 10px 18px rgba(34,197,94,.22);
  transition:transform .08s ease, filter .18s ease;
  white-space:nowrap;
}

.ok:hover{ filter:brightness(.98); }
.ok:active{ transform:scale(.98); }

.back{
  border:1px solid var(--border);
  padding:10px 14px;
  border-radius:14px;
  background:var(--card);
  cursor:pointer;
  font-weight:900;
  transition:transform .08s ease, box-shadow .18s ease;
  box-shadow:0 8px 18px rgba(2,6,23,.06);
}

.back:active{ transform:scale(.98); }

/* Estados */
.err{
  margin:10px 0 0;
  color:var(--danger);
  font-weight:800;
}

/* Lista */
.list{
  display:flex;
  flex-direction:column;
  gap:12px;
  margin-top:14px;
}

.card{
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:14px;
  background:var(--card);
  border:1px solid var(--border);
  border-radius:18px;
  padding:16px;
  box-shadow:var(--shadow-soft);
}

.info{ min-width:0; }

.name{
  display:flex;
  align-items:center;
  gap:10px;
  flex-wrap:wrap;
  margin:0;
  font-weight:1000;
  font-size:1rem;
}

.meta{
  margin:4px 0 0;
  color:var(--muted);
  font-size:.92rem;
  line-height:1.25rem;
}

.preview{
  margin-top:10px;
}

.cover{
  width:100%;
  max-width:360px;
  height:auto;
  border-radius:14px;
  border:1px solid var(--border);
  box-shadow:0 10px 20px rgba(2,6,23,.06);
}

audio.audio{
  width:100%;
  max-width:420px;
}

.badge{
  display:inline-flex;
  align-items:center;
  gap:6px;
  background:rgba(249,115,22,.14);
  color:var(--accent);
  border:1px solid rgba(249,115,22,.25);
  padding:4px 10px;
  border-radius:999px;
  font-size:.72rem;
  font-weight:1000;
}

.danger{
  border:none;
  background:var(--danger);
  color:white;
  font-weight:1000;
  padding:10px 14px;
  border-radius:14px;
  cursor:pointer;
  box-shadow:0 10px 18px rgba(239,68,68,.22);
  transition:transform .08s ease, filter .18s ease;
  white-space:nowrap;
}

.danger:hover{ filter:brightness(.98); }
.danger:active{ transform:scale(.98); }

/* Empty / Loading */
.wrap > p{
  color:var(--muted);
  font-weight:700;
}

/* ✅ Responsive móvil */
@media (max-width: 560px){
  .wrap{ padding:22px 14px; }

  .top{
    flex-direction:row;
    align-items:center;
  }

  .top h2{ font-size:1.15rem; }

  .card{
    flex-direction:column;
    align-items:stretch;
    gap:12px;
  }

  .danger{
    width:100%;
    padding:12px 14px;
  }
  .tabs{ flex-wrap:wrap; }
  .tab{ width:100%; justify-content:space-between; }
  .actions{ width:100%; }
  .ok, .danger{ width:100%; }
}
</style>