import {chromium} from 'playwright';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';

const dir=path.dirname(fileURLToPath(import.meta.url));
const browser=await chromium.launch({executablePath:process.env.BROWSER_PATH||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':undefined),headless:true});
try{
  const page=await browser.newPage({viewport:{width:1400,height:620},deviceScaleFactor:1});
  await page.goto(pathToFileURL(path.join(dir,'preview.html')).href);
  await page.screenshot({path:path.join(dir,'preview.png'),fullPage:true});
}finally{await browser.close();}
