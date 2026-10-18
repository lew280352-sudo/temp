# StockLens

แอปติดตามหุ้นภาษาไทย โทนน้ำเงินหม่น พร้อม Register, Login, Logout และรายการ URL แหล่งข้อมูลแยกตามบัญชี

**สถานะ: ต้นแบบที่มีระบบบัญชีและฐานข้อมูลจริง แต่ข่าว ราคา AI และการแจ้งเตือนยังเป็นข้อมูลสาธิต** การ push ขึ้น GitHub ไม่ใช่การ deploy เว็บไซต์ และ GitHub Pages รัน backend นี้ไม่ได้

## คู่มือฉบับเต็ม

- [คู่มือผู้ใช้](docs/USER_GUIDE.md): สมัครบัญชี เพิ่มหุ้น URL แจ้งเตือน ส่งออกข้อมูล และแก้ปัญหา
- [คู่มือผู้ดูแล](docs/OPERATIONS.md): ตั้งค่า สำรอง/กู้คืนฐานข้อมูล API และเตรียม deploy
- [จุดบอดและข้อจำกัด](docs/KNOWN_LIMITATIONS.md): สิ่งที่แก้แล้วและงานที่ต้องเชื่อมต่อเพิ่ม
- [ผลจำลองผู้ใช้ 20 คน](docs/TEST_20_USERS.md): ปัญหาที่พบ ผลก่อน–หลังแก้ และข้อจำกัดของการทดสอบ

## ดาวน์โหลดจาก GitHub

```powershell
git clone https://github.com/lew280352-sudo/temp.git
cd temp
npm.cmd start
```

macOS/Linux ใช้ `npm start` แทน `npm.cmd start` ไม่มี production dependency เพิ่มเติม

## เปิดแอปบน Windows

ติดตั้ง Node.js 24 ขึ้นไป แล้วเปิด Terminal ที่โฟลเดอร์โปรเจกต์:

```powershell
cd "D:\lew\my first project\stocklens"
npm.cmd start
```

เปิด **http://127.0.0.1:4173** เริ่มสมัครสมาชิก แล้วเข้าสู่ระบบ ไม่ต้องติดตั้งแพ็กเกจเพื่อรันแอป กด Ctrl+C ใน Terminal เพื่อหยุดเซิร์ฟเวอร์

หากพอร์ตถูกใช้อยู่ เลือกพอร์ตอื่นใน PowerShell:

```powershell
$env:PORT='4174'
npm.cmd start
```

เปิดไฟล์ HTML ตรง ๆ หรือใช้ static Live Server จะยังใช้งานระบบบัญชีไม่ได้ ต้องเปิดผ่านคำสั่งข้างต้น

## สิ่งที่ทำงานแล้ว

- สมัครบัญชี ตรวจรหัสผ่าน เข้าสู่ระบบ และ Logout ที่ยกเลิกเซสชันฝั่งเซิร์ฟเวอร์
- บันทึกพอร์ต การตั้งค่าแจ้งเตือน และ URL ลง SQLite แยกตามบัญชี
- เพิ่ม/แก้ไข/ลบหุ้น คำนวณต้นทุนเฉลี่ย และกรองข่าวตัวอย่างตามพอร์ต
- เพิ่ม URL บริษัท คู่ค้า หรือเว็บการเงิน เปิดลิงก์ ลบ และพักการติดตาม พร้อมลิงก์เริ่มต้นของ SET, PTT และ AIS
- ฟอนต์ Noto Sans Thai + Inter และหน้าจอสำหรับมือถือ
- ป้องกันแท็บเก่าบันทึกทับข้อมูลใหม่และป้องกันการส่งข้อมูลบัญชีเดิมหลังสลับบัญชี
- ส่งออกข้อมูลบัญชีเป็น JSON และสำรอง SQLite ด้วย `npm.cmd run backup`

**ข่าว ราคา และผล AI เป็นข้อมูลสาธิต** ยังไม่ดึงเนื้อหาเว็บ ไม่ส่งแจ้งเตือนจริง และยังไม่ได้เชื่อม Custom GPT

บัญชีใหม่เริ่มด้วยพอร์ตว่าง ข้อมูลเก่าจากต้นแบบใน localStorage ไม่ถูกนำเข้าบัญชีใดอัตโนมัติ ข้อมูลบัญชีเก็บใน `.data/stocklens.sqlite` รหัสผ่านเก็บเป็น scrypt hash ไม่เก็บรหัสผ่านตรง ๆ

## ตรวจสอบ

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run test:ui
npm.cmd run test:users
```

UI tests ใช้ Microsoft Edge แบบ headless ตาม path มาตรฐานของ Windows ตั้ง `BROWSER_PATH` หากใช้ Chromium อื่น ภาพหน้าจอทดสอบอยู่ที่ `test-artifacts/` ข้อมูลทดสอบอยู่ใน memory และไม่ปะปนกับบัญชีจริง

บน macOS/Linux ติดตั้ง Chromium ด้วย `npx playwright install chromium` ก่อนรัน UI tests ส่วน persistence tests ใช้ฐานข้อมูลชั่วคราวและลบหลังจบ ไม่แตะบัญชีจริง GitHub Actions จะรัน API และ UI tests เมื่อ push/เปิด PR ต้องตรวจผลจริงในหน้า Actions; ผลในเครื่องไม่ได้ยืนยันว่า CI ผ่านแล้ว

## การเชื่อม Custom GPT และเผยแพร่

ต้องนำ Instructions, Knowledge และเครื่องมือที่ GPT ใช้มาออกแบบ AI ฝั่งเซิร์ฟเวอร์ หรือให้ GPT เรียก API ผ่าน GPT Actions ตอนนี้ยังไม่มี API key หรือการเรียก AI ที่มีค่าใช้จ่าย

แอปนี้รันในเครื่อง ยังไม่ได้ deploy ระบบสมาชิกบนอินเทอร์เน็ต โฮสต์ต้องรองรับ Node.js และ persistent SQLite หรือปรับ backend ให้ตรงกับ runtime ปลายทางก่อน ใช้ HTTPS และตั้ง `APP_ORIGIN` เป็น origin จริงเพื่อเปิด Secure cookie ต้องเพิ่มการยืนยันอีเมลและกู้คืนรหัสผ่านก่อนให้บริการผู้ใช้ทั่วไป

รายละเอียดอยู่ใน [DESIGN.md](DESIGN.md)
