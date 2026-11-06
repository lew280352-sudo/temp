// Maintenance only: restore the committed canonical brands from their pinned source.
// The application serves local files; it makes no icon CDN requests at runtime.
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {companyIcons} from '../dist/company-icons.js';
const version='16.36.0';
for(const asset of Object.values(companyIcons)){
 const slug=asset.split('/').at(-1);
 const response=await fetch(`https://raw.githubusercontent.com/simple-icons/simple-icons/${version}/icons/${slug}`,{signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error('Pinned canonical icon is unavailable: '+slug);
 const svg=await response.text();
 if(!/^<svg\b/.test(svg)||/<script|<image|onload=|href=/i.test(svg))throw new Error('Unexpected icon contents: '+slug);
 await writeFile(fileURLToPath(new URL('../dist'+asset,import.meta.url)),svg);
}
console.log('Restored '+Object.keys(companyIcons).length+' Simple Icons '+version+' assets.');
