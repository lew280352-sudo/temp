# คู่มือผู้ดูแลและนำขึ้นเซิร์ฟเวอร์

## โครงสร้าง

```text
server.mjs          HTTP API, authentication, SQLite และ static assets
dist/               หน้าเว็บและสคริปต์ฝั่งเบราว์เซอร์
test/               API, persistence และ browser tests
scripts/backup.mjs  สำรอง SQLite ด้วย online backup API
docs/               คู่มือและจุดบอด
.data/              ฐานข้อมูลจริง (ไม่ขึ้น Git)
backups/            สำเนาฐานข้อมูล (ไม่ขึ้น Git)
```

ต้องใช้ Node.js 24+; runtime ใช้ built-in modules ไม่มี npm production dependency ติดตั้ง dev dependency ด้วย `npm ci` เมื่อต้องทดสอบ UI

## ค่าตั้งต้น

| ตัวแปร | ค่าเริ่มต้น | ความหมาย |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | bind address; ถ้าเปิดนอก loopback ต้องกำหนด APP_ORIGIN |
| `PORT` | `4173` | พอร์ต 1–65535 |
| `APP_ORIGIN` | origin localhost ตาม request | origin ของเว็บ เช่น `https://your-domain.example` ไม่มี path/query/credentials |
| `DATABASE_PATH` | `.data/stocklens.sqlite` ใต้โฟลเดอร์แอป | path ฐานข้อมูล persistent |
| `BROWSER_PATH` | Edge บน Windows / Playwright Chromium บนระบบอื่น | ใช้เฉพาะ browser tests |

`npm start` อ่าน environment ของ process ไม่โหลด `.env` อัตโนมัติ หากใช้ `.env` ให้คัดลอก `.env.example` แล้วรัน `node --env-file=.env server.mjs` ห้าม commit `.env`

## สำรองข้อมูล

รันจากโฟลเดอร์แอป:

```powershell
npm.cmd run backup
```

ได้ไฟล์ `backups/stocklens-<เวลา UTC>.sqlite` ใช้ SQLite online backup เพื่อให้ข้อมูลจาก WAL รวมอยู่ในไฟล์ สามารถสำรองขณะ server เปิดอยู่ ตั้ง `DATABASE_PATH` ให้ตรงกับ process แอปหากเปลี่ยนตำแหน่งฐานข้อมูล เก็บสำเนานอกเครื่องอย่างมีการควบคุมสิทธิ์

ไฟล์ backup มีอีเมล password hashes พอร์ต และเซสชัน จึงเป็นข้อมูลส่วนตัว ไม่ส่งขึ้น GitHub การ backup สำเร็จยังต้องทดลอง restore เป็นระยะ

## ทดลองกู้คืนโดยไม่เขียนทับฐานข้อมูลเดิม

1. หยุด server ด้วย Ctrl+C
2. คัดลอกไฟล์สำรองที่เลือกไปเป็นไฟล์ใหม่ เช่น `backups/restored.sqlite` โดยเก็บฐานข้อมูลเดิมไว้
3. เปิด Terminal ใหม่ในโฟลเดอร์แอป แล้วกำหนด path ของสำเนา:

```powershell
$env:DATABASE_PATH = (Resolve-Path 'backups/restored.sqlite').Path
npm.cmd start
```

4. Login และตรวจพอร์ต/แหล่งข้อมูล หากสำเร็จจึงเลือก path นี้เป็นฐานข้อมูลใช้งานต่อ
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
| `POST /api/register` | `{name,email,password}` สร้างบัญชี ยังไม่สร้าง session |
| `POST /api/login` | `{email,password}` รับ `{user,state,revision}` และ HttpOnly session cookie |
| `GET /api/session` | คืน user/state/revision ของ session หรือ user=null |
| `PUT /api/state` | `{userId,revision,state}` ตรวจสิทธิ์และ revision; คืน state ที่ normalize แล้วและ revision ใหม่ |
| `POST /api/logout` | body `{}` ยกเลิก session ปัจจุบัน |
| `GET /api/export` | ดาวน์โหลด JSON ของผู้ใช้ที่ Login แล้ว |

คำขอเปลี่ยนข้อมูลต้องส่ง `Content-Type: application/json` และ Origin ตรงกับเว็บ ไม่ใช่ API integration ภายนอกสำหรับ Custom GPT; หากทำ GPT Actions ต้องออกแบบ authentication เฉพาะ ไม่ให้ใช้ cookie ของผู้ใช้แทน OAuth/API credentials

ข้อผิดพลาดหลัก: 400 input ไม่ถูกต้อง, 401 session ไม่พร้อม, 403 origin/host ไม่ตรง, 409 บัญชี/ข้อมูลขัดแย้ง, 413 body เกิน 64 KiB, 415 Content-Type ผิด, 429 ลอง auth เกิน 10 ครั้งต่อบัญชี+IP หรือเกิน 200 ครั้งรวมต่อ IP ใน 15 นาที (รวม Register และ Login ทั้งที่สำเร็จและล้มเหลว)

## การทดสอบและ CI

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run test:ui
npm.cmd run test:users
```

API tests ตรวจ session, account isolation, revision conflict, input validation และ export; persistence tests ตรวจ restart, password hash, expired sessions และ backup; UI tests ตรวจ flow สมาชิก พอร์ต แหล่งข้อมูล มือถือ และกรณี stale/expired session

`test:users` เปิด browser contexts แยก 20 บัญชีพร้อมกัน (10 desktop, 10 mobile) และฐานข้อมูล SQLite ใหม่เฉพาะรอบ บันทึก `results.json` และภาพตัวอย่างใน `test-artifacts/users20-verified-<เวลา UTC>/` โฟลเดอร์นี้รวมฐานข้อมูลสังเคราะห์สำหรับตรวจสอบและถูก ignore จาก Git ไม่ใช้ `.data/stocklens.sqlite` ของบัญชีจริง รายงานสรุปที่เผยแพร่อยู่ใน [TEST_20_USERS.md](TEST_20_USERS.md)

GitHub Actions มี configuration สำหรับ Ubuntu + Node 24 + Chromium ผลการรันจริงดูที่หน้า Actions ใน repository ยังไม่มี deploy job เพราะต้องเลือกและตั้ง host ที่รองรับ backend ก่อน
