import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {companies} from '../dist/catalog.js';

// Official company websites only. These are their website icons, not exchange data.
const domains={
  AAPL:'www.apple.com',MSFT:'www.microsoft.com',NVDA:'www.nvidia.com',AMZN:'www.amazon.com',
  GOOGL:'abc.xyz',META:'www.meta.com',TSLA:'www.tesla.com','BRK.B':'www.berkshirehathaway.com',
  JPM:'www.jpmorganchase.com',V:'www.visa.com',WMT:'www.walmart.com',KO:'www.coca-colacompany.com',
  AMD:'www.amd.com',INTC:'www.intel.com',ORCL:'www.oracle.com',CRM:'www.salesforce.com',
  NFLX:'www.netflix.com',DIS:'thewaltdisneycompany.com',PEP:'www.pepsico.com',MCD:'www.mcdonalds.com',
  COST:'www.costco.com',UNH:'www.unitedhealthgroup.com',XOM:'corporate.exxonmobil.com',BAC:'www.bankofamerica.com',
  AVGO:'www.broadcom.com',ADBE:'www.adobe.com',CSCO:'www.cisco.com',IBM:'www.ibm.com',
  UBER:'www.uber.com',ABNB:'www.airbnb.com',PYPL:'www.paypal.com',PLTR:'www.palantir.com',
  SBUX:'www.starbucks.com',NKE:'www.nike.com',HD:'www.homedepot.com',CAT:'www.caterpillar.com'
};
const root=path.dirname(fileURLToPath(import.meta.url));
const directory=path.join(root,'..','dist','company-icons');
const output=path.join(root,'..','dist','company-icons.js');
const maxBytes=128*1024;
function format(bytes){
  if(bytes.length>=4&&bytes[0]===0&&bytes[1]===0&&(bytes[2]===1||bytes[2]===2)&&bytes[3]===0)return 'ico';
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'png';
  if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return 'webp';
  if(bytes.toString('ascii',0,6)==='GIF89a'||bytes.toString('ascii',0,6)==='GIF87a')return 'gif';
  return null;
}
async function iconAt(url,domain,{declared=false}={}){
  const response=await fetch(url,{signal:AbortSignal.timeout(12000),headers:{'User-Agent':'Mozilla/5.0 (compatible; StockLensIconRefresh/1.0)'}});
  const final=new URL(response.url);
  if(!response.ok||final.protocol!=='https:'||final.username||final.password||(!declared&&!(final.hostname===domain||final.hostname.endsWith(`.${domain}`))))throw new Error(`HTTP ${response.status} or invalid icon URL`);
  if(Number(response.headers.get('content-length'))>maxBytes)throw new Error('Icon too large');
  const reader=response.body.getReader(),parts=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maxBytes)throw new Error('Icon too large');parts.push(value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const bytes=Buffer.concat(parts),ext=format(bytes);
  if(!ext)throw new Error('Unsupported icon format');
  return {bytes,ext,url:response.url};
}
async function declaredIcons(pageUrl){
  try{
    const response=await fetch(pageUrl,{signal:AbortSignal.timeout(12000),headers:{'User-Agent':'Mozilla/5.0 (compatible; StockLensIconRefresh/1.0)'}});
    if(!response.ok||!response.headers.get('content-type')?.includes('text/html'))return [];
    const html=(await response.text()).slice(0,1024*1024),found=[];
    for(const tag of html.match(/<link\b[^>]*>/gi)||[]){
      const attrs=Object.fromEntries([...tag.matchAll(/([a-z-]+)\s*=\s*(["'])(.*?)\2/gi)].map(match=>[match[1].toLowerCase(),match[3]]));
      if(!/(?:^|\s)(?:icon|shortcut|apple-touch-icon)(?:\s|$)/i.test(attrs.rel||'')||!attrs.href||/\.svg(?:[?#]|$)/i.test(attrs.href))continue;
      const url=new URL(attrs.href,response.url);
      if(url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&!/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname))found.push(url.href);
    }
    return [...new Set(found)];
  }catch{return [];}
}
async function download(company){
  const hostname=domains[company.symbol];
  if(!hostname)throw new Error(`No official site for ${company.symbol}`);
  const domain=hostname.replace(/^www\./,'');
  const direct=`https://${hostname}/favicon.ico`;
  try{
    let icon;
    try{icon=await iconAt(direct,domain);}catch{
      const pages=[`https://${hostname}/`,company.url];
      for(const page of pages){
        for(const url of (await declaredIcons(page)).slice(0,8)){
          try{icon=await iconAt(url,domain,{declared:true});break;}catch{}
        }
        if(icon)break;
      }
    }
    if(!icon)throw new Error('No usable icon on official website');
    const {bytes,ext,url}=icon;
    const filename=`${company.symbol.toLowerCase().replaceAll('.','-')}.${ext}`;
    await writeFile(path.join(directory,filename),bytes);
    return [company.symbol,`/company-icons/${filename}`,url];
  }catch(error){console.warn(`${company.symbol}: ${error.message}`);return null;}
}
await mkdir(directory,{recursive:true});
const records=[];
for(let start=0;start<companies.length;start+=6){
  const batch=await Promise.all(companies.slice(start,start+6).map(download));
  records.push(...batch.filter(Boolean));
}
const mapping=Object.fromEntries(records.map(([symbol,local])=>[symbol,local]));
await writeFile(output,`// Official website favicons, downloaded by scripts/fetch-company-icons.mjs.\nexport const companyIcons = ${JSON.stringify(mapping,null,2)};\n`);
await writeFile(path.join(directory,'SOURCES.md'),`# ไอคอนเว็บไซต์บริษัท\n\nไฟล์เหล่านี้ดึงจากเว็บไซต์ทางการของบริษัทเมื่อ ${new Date().toISOString()} เพื่อใช้ระบุบริษัทใน StockLens ไม่ใช่โลโก้ที่ตลาดหลักทรัพย์รับรอง และไม่มีความเกี่ยวข้องหรือการรับรองจากบริษัท\n\n${records.map(([symbol,,url])=>`- ${symbol}: ${url}`).join('\n')}\n\nหากเผยแพร่แอปสาธารณะ ให้ตรวจเงื่อนไขการใช้เครื่องหมายการค้าของแต่ละบริษัทอีกครั้ง\n`);
console.log(`Downloaded ${records.length}/${companies.length} official website icons`);
