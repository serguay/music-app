<script setup>
import { useThemeStore } from '../stores/theme'

const theme = useThemeStore()

const toggleTheme = () => {
  theme.toggle()
}
</script>

<template>
  <!-- TOGGLE MODO OSCURO -->
  <input
    type="checkbox"
    class="theme-toggle"
    :checked="theme.dark"
    @change="toggleTheme"
    aria-label="Cambiar tema"
  />
</template>

<style scoped>
/* ======================
   TOGGLE MODO OSCURO
   checked = DARK ✅
====================== */

.theme-toggle {
  width: 64px;
  height: 34px;
  appearance: none;
  border-radius: 999px;
  position: relative;
  cursor: pointer;
  outline: none;

  /* 🌞 CLARO (default) */
  background: #f4f4f5;

  box-shadow:
    inset 0 4px 12px rgba(0,0,0,.12),
    inset 0 2px 4px rgba(0,0,0,.08);

  transition: background .35s ease;
}

/* CÍRCULO */
.theme-toggle::before {
  content: "";
  position: absolute;
  width: 28px;
  height: 28px;
  top: 3px;
  left: 3px;
  border-radius: 50%;

  /* 🌞 CLARO */
  background: linear-gradient(to bottom, #ffffff, #eaeaea);
  box-shadow:
    0 4px 12px rgba(0,0,0,.25),
    inset 2px 2px rgba(255,255,255,.9),
    inset -2px 2px rgba(255,255,255,.9);

  transition: all .35s cubic-bezier(.4,0,.2,1);
}

/* 🌙 CHECKED = MODO OSCURO */
.theme-toggle:checked {
  background: #222;
}

.theme-toggle:checked::before {
  left: 33px;

  background: linear-gradient(to bottom, #444, #222);
  box-shadow:
    0 6px 18px rgba(0,0,0,.45),
    inset 2px 2px rgba(255,255,255,.2),
    inset -2px 2px rgba(255,255,255,.2);
}

/* HOVER SUAVE */
.theme-toggle:hover::before {
  transform: scale(1.02);
}
</style>
