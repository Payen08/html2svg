export {};
declare global {
 interface Window { html2svgDesktop?: {copyFigma:(html:string)=>Promise<boolean>;copySvg:(svg:string)=>Promise<boolean>}; }
}
