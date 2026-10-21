# คู่มือผู้ดูแลและนำขึ้นเซิร์ฟเวอร์

## AI ออนไลน์หรือในเครื่อง (0.6.0)

โหมด `AI_PROVIDER=auto` ใช้ Groq ก่อนเมื่อมี `GROQ_API_KEY` และ fail over ไป Ollama เมื่อคำขอออนไลน์ล้มเหลว มิฉะนั้นใช้ Ollama โดยตรง ผลสรุปอยู่ในตาราง `ai_summaries` และ cache key แยกตาม provider, model, ticker และชุดหัวข้อข่าว API key อยู่เฉพาะ environment ฝั่งเซิร์ฟเวอร์และไม่อยู่ใน response/log/database

## ราคาแบบดึงเมื่อเปิดแอป (0.3.1)

ตั้ง `FINNHUB_API_KEY` ใน `.env` แล้ว restart เซิร์ฟเวอร์ `GET /api/quotes` ต้อง Login และดึงเฉพาะบริษัทสหรัฐฯ ใน watchlist ไม่รับ ticker จาก query ไม่ตั้ง scheduler สำหรับราคา ใช้ cache/attempt cooldown 60 วินาทีและรวมคำขอที่ซ้ำกัน UI แสดงเฉพาะราคารายบริษัท ไม่คำนวณยอดพอร์ต ดู [คู่มือสมัครและตั้งค่า](FREE_SETUP.md)

## โครงสร้าง

```text
server.mjs          HTTP API, authentication, SQLite และ static assets
ai.mjs              ตัวเชื่อม Groq/Ollama, structured output และ summary cache
dist/               หน้าเว็บและสคริปต์ฝั่งเบราว์เซอร์
test/               API, persistence และ browser tests
scripts/backup.mjs  สำรอง SQLite ด้วย online backup API
docs/               คู่มือและจุดบอด
.data/              ฐานข้อมูลจริง (ไม่ขึ้น Git)
backups/            สำเนาฐานข้อมูล (ไม่ขึ้น Git)
```

ต้องใช้ Node.js 24+; ใช้ `npm ci` ติดตั้งแพ็กเกจตาม lockfile (รวม fast-xml-parser สำหรับ RSS) หรือ `npm ci --omit=dev` เฉพาะ runtime

## ค่าตั้งต้น

| ตัวแปร | ค่าเริ่มต้น | ความหมาย |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | bind address; ถ้าเปิดนอก loopback ต้องกำหนด APP_ORIGIN |
| `PORT` | `4173` | พอร์ต 1–65535 |
| `APP_ORIGIN` | origin localhost ตาม request | origin ของเว็บ เช่น `https://your-domain.example` ไม่มี path/query/credentials |
| `DATABASE_PATH` | `.data/stocklens.sqlite` ใต้โฟลเดอร์แอป | path ฐานข้อมูล persistent |
| `NEWS_ENABLED` | `true` | ตั้ง `false` เพื่อปิดการดึง RSS และข่าวผ่าน Finnhub; cache เดิมยังอ่านได้พร้อมสถานะอายุ |
| `FINNHUB_API_KEY` | ว่าง | ราคาล่าสุดและข่าวสื่อการเงินของ 24 บริษัท เก็บเฉพาะ server environment |
| `ALPHAVANTAGE_API_KEY` | ว่าง | ราคาปิดย้อนหลังแบบฟรีและ backtest ของโหมดแนวโน้ม เก็บเฉพาะ server environment |
| `AI_ENABLED` | `true` | ตั้ง `false` เพื่อปิด AI |
| `AI_PROVIDER` | `auto` | `auto`, `groq` หรือ `ollama`; auto ใช้ Groq ก่อนแล้ว fallback ไป Ollama |
| `GROQ_API_KEY` | ว่าง | secret สำหรับ GroqCloud เก็บเฉพาะ server environment |
| `GROQ_MODEL` | `qwen/qwen3.8-27b` | โมเดลออนไลน์ที่ใช้ structured output |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | endpoint Ollama; อนุญาตเฉพาะ localhost |
| `OLLAMA_MODEL` | `qwen3:8b` | โมเดลที่ต้องมีใน `ollama list` |
| `BROWSER_PATH` | Edge บน Windows / Playwright Chromium บนระบบอื่น | ใช้เฉพาะ browser tests |

`npm start` และ `npm run backup` โหลด `.env` ถ้ามี โดย environment ที่ตั้งใน process มีลำดับก่อน คัดลอก `.env.example` ไป `.env` เพื่อปรับค่า ห้าม commit `.env` หากเรียก `node server.mjs` โดยตรงต้องตั้ง env เอง

## สำรองข้อมูล

รันจากโฟลเดอร์แอป:

```powershell
npm.cmd run backup
```

ได้ไฟล์ `backups/stocklens-<เวลา UTC>.sqlite` ใช้ SQLite online backup เพื่อให้ข้อมูลจาก WAL รวมอยู่ในไฟล์ สามารถสำรองขณะ server เปิดอยู่ ตั้ง `DATABASE_PATH` ให้ตรงกับ process แอปหากเปลี่ยนตำแหน่งฐานข้อมูล เก็บสำเนานอกเครื่องอย่างมีการควบคุมสิทธิ์

ไฟล์ backup มีอีเมล password hashes รายการบริษัท/เว็บไซต์ที่สนใจ และเซสชัน จึงเป็นข้อมูลส่วนตัว ไม่ส่งขึ้น GitHub การ backup สำเร็จยังต้องทดลอง restore เป็นระยะ

## ทดลองกู้คืนโดยไม่เขียนทับฐานข้อมูลเดิม

1. หยุด server ด้วย Ctrl+C
2. คัดลอกไฟล์สำรองที่เลือกไปเป็นไฟล์ใหม่ เช่น `backups/restored.sqlite` โดยเก็บฐานข้อมูลเดิมไว้
3. เปิด Terminal ใหม่ในโฟลเดอร์แอป แล้วกำหนด path ของสำเนา:

```powershell
$env:DATABASE_PATH = (Resolve-Path 'backups/restored.sqlite').Path
npm.cmd start
```

4. Login และตรวจรายการติดตาม/แหล่งข้อมูล หากสำเร็จจึงเลือก path นี้เป็นฐานข้อมูลใช้งานต่อ
5. เซสชันที่ยังไม่หมดอายุใน backup อาจกลับมาใช้งานได้หลัง restore หากกู้คืนหลังเหตุข้อมูลรั่ว ผู้ดูแลต้องเพิกถอนเซสชันในฐานข้อมูลก่อนเปิดให้ผู้ใช้เข้า

JSON จาก `/api/export` เป็นข้อมูลเฉพาะบัญชี ไม่ใช่ full database backup และยังไม่มี automatic import

## เตรียม deploy

เวอร์ชันนี้ยังไม่ได้ deploy ระบบออนไลน์ GitHub Pages/static hosting ไม่รองรับ `node:sqlite` และ API ให้เลือก Node.js host แบบ single instance พร้อมพื้นที่เก็บไฟล์ถาวร

ตัวอย่าง environment สำหรับ runtime หลัง reverse proxy:

```text
HOST=0.0.0.0
PORT=4173
APP_ORIGIN=https://your-domain.example
DATABASE_PATH=/persistent-data/stocklens.sqlite
```

ใช้ HTTPS ตั้ง proxy ให้รักษา Host ตรงกับ APP_ORIGIN; server จะออก Secure cookie เมื่อ origin เป็น HTTPS แอปไม่เชื่อ `X-Forwarded-For` โดยอัตโนมัติ จึงต้องออกแบบ rate limiting หลัง proxy ให้เหมาะสมก่อนหลายผู้ใช้ อย่าเปิดบริการทั่วไปก่อนจัดการรายการระดับสูงใน KNOWN_LIMITATIONS.md

ห้ามเผยแพร่ `.data/`, `backups/`, `.env`, credentials หรือ snapshot ของผู้ใช้ ห้ามชี้ static server ไปที่โฟลเดอร์ repository ทั้งหมด ใช้ `server.mjs` ซึ่งให้บริการเฉพาะ assets ที่ระบุ

## API ที่มีอยู่

| Method / Path | ข้อมูล / พฤติกรรม |
| --- | --- |
| `POST /api/register` | `{name,email,password}` สร้างบัญชีและคืน recoveryCode ครั้งเดียว ยังไม่สร้าง session |
| `POST /api/recover` | `{email,code,password}` ใช้รหัสกู้คืน เปลี่ยนรหัสผ่าน ออกทุกเซสชัน คืน recoveryCode ใหม่ |
| `POST /api/recovery-code` | Login + `{password}` สร้างรหัสกู้คืนใหม่ ยกเลิกรหัสเดิม |
| `GET /api/news` | Login; ข่าวจากฟีดที่เปิดในบัญชี พร้อม source status/timestamps |
| `GET /api/forecast?symbol=AAPL` | Login; สถานะราคาย้อนหลัง ผล backtest และสัญญาณทดลองเมื่อผ่านเกณฑ์; ไม่คืน API key |
| `GET /api/ai/status` | Login; คืน provider/model/สถานะพร้อม โดยไม่คืน API key |
| `POST /api/ai/summary` | Login + `{symbol}`; สรุปหัวข้อข่าวที่เปิดในบัญชีด้วย structured output |
| `GET /api/health` | ตรวจ process/SQLite เท่านั้น ไม่ยืนยันว่า provider ภายนอกพร้อม |
| `POST /api/login` | `{email,password}` รับ `{user,state,revision}` และ HttpOnly session cookie |
| `GET /api/session` | คืน user/state/revision ของ session หรือ user=null |
| `PUT /api/state` | `{userId,revision,state}` ตรวจสิทธิ์และ revision; คืน state ที่ normalize แล้วและ revision ใหม่ |
| `POST /api/logout` | body `{}` ยกเลิก session ปัจจุบัน |
| `GET /api/export` | ดาวน์โหลด JSON ของผู้ใช้ที่ Login แล้ว |

คำขอเปลี่ยนข้อมูลต้องส่ง `Content-Type: application/json` และ Origin ตรงกับเว็บ ไม่ใช่ API integration ภายนอกสำหรับ Custom GPT; หากทำ GPT Actions ต้องออกแบบ authentication เฉพาะ ไม่ให้ใช้ cookie ของผู้ใช้แทน OAuth/API credentials

ข้อผิดพลาดหลัก: 400 input ไม่ถูกต้อง, 401 session ไม่พร้อม, 403 origin/host ไม่ตรง, 409 บัญชี/ข้อมูลขัดแย้ง, 413 body เกิน 64 KiB, 415 Content-Type ผิด, 429 ลอง auth เกิน 10 ครั้งต่อบัญชี+IP หรือเกิน 200 ครั้งรวมต่อ IP ใน 15 นาที (รวม Register, Login, Recover และการสร้างรหัสกู้คืน ทั้งที่สำเร็จและล้มเหลว)

## การทดสอบและ CI

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run test:ui
npm.cmd run test:pwa
npm.cmd run test:users
```

API tests ตรวจ session, account isolation, revision conflict, input validation และ export; persistence tests ตรวจ restart, password hash, migration ที่ลบจำนวน/ต้นทุน, expired sessions และ backup; UI tests ตรวจ flow สมาชิก สิ่งที่ติดตาม แหล่งข้อมูล มือถือ และกรณี stale/expired session

`test:users` เปิด browser contexts แยก 20 บัญชีพร้อมกัน (10 desktop, 10 mobile) และฐานข้อมูล SQLite ใหม่เฉพาะรอบ บันทึก `results.json` และภาพตัวอย่างใน `test-artifacts/users20-verified-<เวลา UTC>/` โฟลเดอร์นี้รวมฐานข้อมูลสังเคราะห์สำหรับตรวจสอบและถูก ignore จาก Git ไม่ใช้ `.data/stocklens.sqlite` ของบัญชีจริง รายงานสรุปที่เผยแพร่อยู่ใน [TEST_20_USERS.md](TEST_20_USERS.md)

GitHub Actions มี configuration สำหรับ Ubuntu + Node 24 + Chromium ผลการรันจริงดูที่หน้า Actions ใน repository ยังไม่มี deploy job เพราะต้องเลือกและตั้ง host ที่รองรับ backend ก่อน

## RSS และ PWA

`feeds.mjs` กำหนดฟีดบริษัท 4 แห่งและฟีด Federal Reserve ที่ตรวจสอบแล้ว 2 รายการ รองรับ RSS/Atom จำกัด 2 MiB/ฟีด timeout 12 วินาที ไม่ตาม redirect และปฏิเสธ DOCTYPE/ENTITY เพื่อไม่ resolve XML entity จากภายนอก อ่านเฉพาะ title/link/date ไม่โหลดบทความเต็ม เซิร์ฟเวอร์ดึง URL ที่ผู้ใช้เพิ่มเฉพาะเมื่อ URL ตรงกับรายการอนุมัติทุกตัวอักษร URL อื่นเก็บเป็นบุ๊กมาร์ก การเรียกซ้ำฟีด Federal Reserve มี cooldown 15 นาทีและยังแยกข่าวตามบัญชี

ดึงตอนเริ่ม server แล้วทุก 15 นาที เก็บ `news_feeds` ใน SQLite รวมใน backup เมื่อดึงไม่สำเร็จเก็บ cache เดิมและตั้ง error หากเวลาสำเร็จล่าสุดเกินหนึ่งชั่วโมงจะระบุว่าล่าช้า ปุ่มรีเฟรชใน UI อ่าน cache ไม่สร้าง upstream request ต่อผู้ใช้ แต่ละบริษัทอาจเผยแพร่ข่าวห่างกันและไม่จำเป็นต้องใหม่ทุกวัน

Service worker cache เฉพาะ `/offline.html` และไอคอน ไม่ cache `/api/*`, HTML ที่ Login แล้ว หรือข้อมูลส่วนตัว เปลี่ยนเลข cache version ใน `dist/sw.js` หากเปลี่ยนหน้าที่ precache ไม่ใช้ skipWaiting จึงไม่บังคับเปลี่ยน worker ระหว่างผู้ใช้กรอกฟอร์ม

## Docker (ยังไม่ได้ทดสอบ build บนเครื่องนี้)

ติดตั้ง Docker แล้วรัน `docker compose up -d --build` จากโฟลเดอร์แอป เปิด **http://localhost:4173** (ต้องใช้ hostname ตรง APP_ORIGIN) compose ผูกพอร์ตกับ loopback และเก็บ SQLite ใน named volume `stocklens-data` รันเป็นผู้ใช้ node ที่ไม่ใช่ root

สำรอง volume โดย `docker compose exec stocklens node scripts/backup.mjs` แล้วคัดลอกไฟล์ backup ออกมาจาก `/app/backups` ก่อนลบ container ห้ามใช้ `docker compose down -v` หากยังไม่มี backup เพราะจะลบข้อมูลใน volume

สำหรับอินเทอร์เน็ต ให้ reverse proxy HTTPS เข้ามาที่พอร์ต loopback นี้ ตั้ง APP_ORIGIN เป็น https://โดเมนจริง แล้ว rebuild/recreate container ตามระบบ deploy อย่าเปิดหลาย replica บน SQLite ไฟล์เดียวกัน ทั้ง Docker และ reverse proxy ยังไม่ได้เผยแพร่หรือสร้างบัญชีโฮสต์ให้อัตโนมัติ

อ้างอิง: [Docker Node.js guide](https://docs.docker.com/guides/nodejs/), [Node environment files](https://nodejs.org/api/cli.html#--env-file-if-existsfile), [PWA installation](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)
