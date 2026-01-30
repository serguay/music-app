<template>
  <div class="legal-page">
    <header class="legal-header">
      <RouterLink class="back" to="/login">← Volver</RouterLink>
      <h1>Términos y condiciones</h1>
      <p class="sub">Normas básicas para usar la app.</p>
    </header>

    <section class="card">
      <h2>Uso de la app</h2>
      <ul>
        <li>Usa la plataforma de forma responsable (sin spam, abuso o contenido ilegal).</li>
        <li>No intentes acceder a cuentas ajenas ni explotar vulnerabilidades.</li>
        <li>Podemos actualizar funciones para mejorar la experiencia.</li>
      </ul>
    </section>

    <section class="card">
      <h2>Cuenta</h2>
      <ul>
        <li>Eres responsable de mantener tu contraseña segura.</li>
        <li>Si detectas actividad rara, cambia tu contraseña.</li>
      </ul>
    </section>

    <section class="card">
      <h2>Contenido</h2>
      <ul>
        <li>Tu contenido es tuyo, pero nos permites mostrarlo dentro de la app.</li>
        <li>Podemos retirar contenido que incumpla normas o leyes.</li>
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
