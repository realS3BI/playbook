const { contextBridge, ipcRenderer } = require('electron');

async function invoke(channel, ...args) {
  try { return await ipcRenderer.invoke(channel, ...args); }
  catch (error) {
    const message = String(error?.message || error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
    throw new Error(message);
  }
}

// Expose individual operations only. Never expose ipcRenderer, console commands,
// arbitrary filesystem access, URLs, or screen/window IDs to the remote website.
const trustedOrigin = process.argv.find(argument => argument.startsWith('--playbook-origin='))?.slice('--playbook-origin='.length);
if (trustedOrigin && location.origin === trustedOrigin && window === window.top) {
  contextBridge.exposeInMainWorld('playbookDesktop', Object.freeze({
    version: 1,
    status: () => invoke('review:status'),
    launch: () => invoke('review:launch'),
    connect: () => invoke('review:connect'),
    frame: (width, height) => invoke('review:frame', width, height),
    begin: (slot, cameraPitch) => invoke('review:begin', slot, cameraPitch),
    end: token => invoke('review:end', token),
    disconnect: () => invoke('review:disconnect'),
    recover: () => invoke('review:recover'),
    checkUpdate: () => invoke('review:update-check'),
    installUpdate: () => invoke('review:update-install'),
    onStopVideo: callback => {
      const listener = () => callback();
      ipcRenderer.on('review:stop-video', listener);
      return () => ipcRenderer.removeListener('review:stop-video', listener);
    },
    liveStatus: () => invoke('review:live-status'),
    liveDevices: () => invoke('review:live-devices'),
    liveStart: (sessionId, options) => invoke('review:live-start', sessionId, options),
    liveStop: () => invoke('review:live-stop'),
    liveMute: muted => invoke('review:live-mute', muted),
    liveRetry: () => invoke('review:live-retry'),
    demoFolderStatus: () => invoke('review:demo-folder-status'),
    demoFolderSet: folder => invoke('review:demo-folder-set', folder),
    demoFolderChoose: () => invoke('review:demo-folder-choose'),
    demoFolderImport: options => invoke('review:demo-folder-import', options),
    demoFolderCancel: () => invoke('review:demo-folder-cancel'),
  }));
}
