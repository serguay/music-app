const { app, BrowserWindow, Menu, nativeTheme } = require('electron')
const path = require('path')

function createWindow () {

  // 🔥 detecta si Windows está en oscuro
  const isDark = nativeTheme.shouldUseDarkColors

  const win = new BrowserWindow({
    width: 1200,
    height: 800,

    // 🔥 color REAL de la ventana (afecta barra Windows)
    backgroundColor: isDark ? '#1f1f22' : '#f2f3f5',

    // 🔥 oculta barra y menú
    autoHideMenuBar: true,

    webPreferences: {
      contextIsolation: true
    }
  })

  // 🔥 elimina el menú para SIEMPRE
  Menu.setApplicationMenu(null)

  // 🔥 DEV
  if (!app.isPackaged) {
    win.loadURL('http://localhost:5173')
  } else {
    // 🔥 PROD
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
