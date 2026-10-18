import {chromium} from 'playwright';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const browser=await chromium.launch({executablePath:process.env.BROWSER_PATH||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':undefined),headless:true});
try{
  const svg=readFileSync(new URL('../dist/icon.svg',import.meta.url),'utf8');
  for(const [size,name] of [[192,'icon-192.png'],[512,'icon-512.png'],[180,'apple-touch-icon.png']]){
    const page=await browser.newPage({viewport:{width:size,height:size},deviceScaleFactor:1});
    await page.setContent(`<style>html,body{margin:0;width:100%;height:100%}svg{display:block;width:100%;height:100%}</style>${svg}`);
    await page.screenshot({path:fileURLToPath(new URL('../dist/'+name,import.meta.url))});await page.close();
  }
}finally{await browser.close();}
