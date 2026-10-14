const {contextBridge,ipcRenderer}=require('electron');
if(process.isMainFrame){
 contextBridge.exposeInMainWorld('html2svgDesktop',{
  copyFigma:html=>ipcRenderer.invoke('desktop:copy-html',html),
  copySvg:svg=>ipcRenderer.invoke('desktop:copy-svg',svg),
 });
}
