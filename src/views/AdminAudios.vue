<template>
  <div class="wrap">
    <div class="top">
      <button class="back" @click="goBack">← Volver</button>
      <h2>🎵 Audios</h2>
    </div>

    <p v-if="loading">Cargando audios…</p>
    <p v-else-if="error" class="err">❌ {{ error }}</p>
    <p v-else-if="audios.length === 0">No hay audios</p>

    <div v-else class="list">
      <div v-for="a in audios" :key="a.id" class="card">
        <div class="info">
          <p class="name">
            {{ a.title || "(Sin título)" }}
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
        </div>

        <button class="danger" @click="removeAudio(a)" :disabled="deletingId === a.id">
          {{ deletingId === a.id ? "Borrando…" : "Eliminar" }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { supabase } from "../lib/supabase";

const router = useRouter();

const audios = ref([]);
const loading = ref(true);
const error = ref("");
const deletingId = ref(null);

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
  loading.value = true;
  error.value = "";

  const { data, error: err } = await supabase
    .from("audios")
    .select("id, title, user_id, created_at")
    .order("created_at", { ascending: false });

  if (err) {
    error.value = err.message;
    audios.value = [];
  } else {
    audios.value = data || [];
  }

  loading.value = false;
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

onMounted(fetchAudios);
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
}
</style>