const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('nocturneQuick', {
  bootstrap: () => invoke('quick:bootstrap'),
  toggle: () => invoke('quick:toggle'),
  collapse: () => invoke('quick:collapse'),
  showContextMenu: () => invoke('quick:show-context-menu'),
  deleteItem: (section, id) => invoke('quick:delete', { section, id }),
  clear: (section) => invoke('quick:clear', section),
  copy: (text) => invoke('quick:copy', text),
  copySecret: (text) => invoke('quick:copy-secret', text),
  copyScreenshot: (id) => invoke('quick:copy-screenshot', id),
  saveScreenshot: (id) => invoke('quick:save-screenshot', id),
  unlockVault: (mode, credential) => invoke('quick:unlock-vault', { mode, credential }),
  deleteNote: (id) => invoke('quick:delete-note', id),
  otpCodes: () => invoke('quick:otp-codes'),
  copyMedia: (id) => invoke('quick:copy-media', id),
  saveMedia: (id) => invoke('quick:save-media', id),
  previewDocument: (id) => invoke('quick:preview-document', id),
  openMain: () => invoke('quick:open-main'),
  recordActivity: () => ipcRenderer.send('quick:session-activity'),
  onExpanded: (callback) => ipcRenderer.on('quick:expanded', (_event, value) => callback(value)),
  onActivity: (callback) => ipcRenderer.on('quick:activity', (_event, value) => callback(value)),
  onVaultLocked: (callback) => ipcRenderer.on('quick:vault-locked', (_event, value) => callback(value)),
  onUnlockMode: (callback) => ipcRenderer.on('quick:unlock-mode', (_event, value) => callback(value)),
  onVaultWiped: (callback) => ipcRenderer.on('quick:vault-wiped', callback),
  onVaultCreated: (callback) => ipcRenderer.on('quick:vault-created', callback),
  onPreferences: (callback) => ipcRenderer.on('quick:preferences', (_event, value) => callback(value)),
});
