import { app, BrowserWindow, Menu, clipboard, ClipboardItem, ipcMain, shell, dialog } from 'electron';
import path from 'node:path';
import { startDesktopServer } from './server';

let window:BrowserWindow|null=null;
let origin='';
let local:Awaited<ReturnType<typeof startDesktopServer>>|undefined;
const trusted=(event:Electron.IpcMainInvokeEvent)=>event.senderFrame===window?.webContents.mainFrame&&event.senderFrame?.url===origin+'/';
const showWindow=()=>{
 window=new BrowserWindow({width:1440,height:960,minWidth:1000,minHeight:650,title:'HTML2SVG Artboard',backgroundColor:'#0d1117',show:false,
  webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
 window.once('ready-to-show',()=>window?.show());
 window.on('closed',()=>{window=null;});
 window.webContents.on('will-navigate',(event,url)=>{if(url!==origin+'/')event.preventDefault();});
 window.webContents.setWindowOpenHandler(({url})=>{if(/^https?:/.test(url))void shell.openExternal(url);return {action:'deny'};});
 window.webContents.session.setPermissionRequestHandler((contents,permission,callback)=>{callback(contents===window?.webContents&&permission==='clipboard-sanitized-write');});
 void window.loadURL(origin+'/');
};
if(!app.requestSingleInstanceLock())app.quit();
else {
 app.on('second-instance',()=>{if(!window)showWindow();window?.show();window?.focus();});
 app.whenReady().then(async()=>{
  app.setName('HTML2SVG Artboard');
  local=await startDesktopServer(path.join(__dirname,'ui'));origin=local.origin;
  ipcMain.handle('desktop:copy-html',async (event,html:string)=>{if(!trusted(event)||typeof html!=='string'||html.length>100_000_000)throw Error('Invalid clipboard request');await clipboard.write([new ClipboardItem({'text/html':new Blob([html],{type:'text/html'}),'text/plain':'Figma design'})]);
    const items=await clipboard.read();
    const item=items.find(item=>item.types.includes('text/html'));
    const payload=item&&await item.getType('text/html');
    if (!(payload instanceof Blob) || !(await payload.text()).includes('<!--(figma)')) throw Error('Figma 图层没有写入系统剪贴板，请重试。');
    return true;});
  ipcMain.handle('desktop:copy-svg',async (event,svg:string)=>{if(!trusted(event)||typeof svg!=='string'||!svg.trim().startsWith('<svg'))throw Error('Invalid SVG clipboard request');await clipboard.writeText(svg);return true;});
  Menu.setApplicationMenu(Menu.buildFromTemplate([
   {label:app.name,submenu:[{role:'about'},{type:'separator'},{role:'hide'},{role:'hideOthers'},{role:'unhide'},{type:'separator'},{role:'quit'}]},
   {label:'编辑',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
   {label:'视图',submenu:[{role:'reload'},{role:'toggleDevTools'},{type:'separator'},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{role:'togglefullscreen'}]},
   {label:'窗口',submenu:[{role:'minimize'},{role:'zoom'},{role:'front'}]},
  ]));
  showWindow();
  app.on('activate',()=>{if(!window)showWindow();});
 }).catch(error=>{dialog.showErrorBox('应用启动失败',String(error));app.quit();});
 app.on('before-quit',()=>local?.server.close());
}
