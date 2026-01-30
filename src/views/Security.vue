<template>
  <div class="legal-page">
    <header class="legal-header">
      <RouterLink class="back" to="/login">← Volver</RouterLink>
      <h1>Seguridad</h1>
      <p class="sub">Buenas prácticas y medidas.</p>
    </header>

    <section class="card">
      <h2>Medidas</h2>
      <ul>
        <li>Inicio de sesión seguro con Supabase Auth.</li>
        <li>Sesión persistente (si sales, al volver sigues logueado).</li>
        <li>Reglas de acceso en base de datos (RLS) recomendadas.</li>
      </ul>
    </section>

    <section class="card">
      <h2>Recomendaciones</h2>
      <ul>
        <li>Usa contraseñas fuertes y únicas.</li>
        <li>No compartas tus credenciales.</li>
        <li>Si sospechas de acceso no autorizado, cambia tu contraseña.</li>
      </ul>
    </section>

    <p class="meta">Última actualización: 14/01/2026</p>
  </div>
</template>

<style scoped>
.legal-page{ min-height:100vh; padding:22px 16px 34px; max-width:820px; margin:0 auto; }
.legal-header{ text-align:center; margin-bottom:14px; }
.back{ display:inline-block; margin-bottom:10px; text-decoration:none; color:rgba(15,23,42,.75); font-weight:800; }
h1{ margin:0; font-size:26px; font-weight:950; color:rgba(15,23,42,.92); }
.sub{ margin:6px 0 0; opacity:.7; font-weight:700; }
.card{ margin-top:12px; padding:16px; border-radius:16px; background:rgba(255,255,255,.75); border:1px solid rgba(15,23,42,.08); box-shadow:0 14px 40px rgba(0,0,0,.08); }
h2{ margin:0 0 8px; font-size:16px; font-weight:950; }
ul{ margin:0; padding-left:18px; }
li{ margin:6px 0; opacity:.88; font-weight:650; }
.meta{ margin-top:14px; text-align:center; font-size:12px; opacity:.65; font-weight:700; }
</style>
