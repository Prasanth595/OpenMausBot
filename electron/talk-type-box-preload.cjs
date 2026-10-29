const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("typeBox", {
  input: (text, height) => ipcRenderer.send("type-box:input", String(text), Number(height)),
  send: text => ipcRenderer.send("type-box:send", String(text)),
  cancel: () => ipcRenderer.send("type-box:cancel"),
});
