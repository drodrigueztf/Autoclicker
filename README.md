# AutoClicker

Grabador y reproductor de inputs de teclado y ratón, construido con **Electron**, **React** y **TypeScript**.

## ✨ Características

- Grabación de movimientos y clics del ratón
- Grabación de pulsaciones de teclado
- Reproducción automatizada de las acciones grabadas
- Interfaz transparente/overlay para uso en tiempo real
- Exportación de grabaciones

## 🛠️ Tecnologías

- [Electron](https://www.electronjs.org/) — Aplicación de escritorio multiplataforma
- [React](https://react.dev/) — Interfaz de usuario
- [TypeScript](https://www.typescriptlang.org/) — Tipado estático
- [electron-vite](https://electron-vite.org/) — Build tool
- [nut.js](https://nutjs.dev/) — Automatización de inputs nativos
- [uiohook-napi](https://github.com/nicholasgasior/uiohook-napi) — Captura de eventos de input globales

## 🚀 Instalación

```bash
# Clonar el repositorio
git clone https://github.com/drodrigueztf/Autoclicker.git
cd Autoclicker

# Instalar dependencias
npm install

# Ejecutar en modo desarrollo
npm run dev
```

## 📦 Scripts disponibles

| Comando | Descripción |
|---------|-------------|
| `npm run dev` | Inicia la app en modo desarrollo |
| `npm run build` | Compila el proyecto |
| `npm run dist` | Genera el instalador de la aplicación |

## 📄 Licencia

MIT
