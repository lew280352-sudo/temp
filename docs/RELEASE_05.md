# StockLens 0.5.0 — News preferences

เวอร์ชันนี้เปลี่ยนจากการเก็บพอร์ตเป็นการเก็บเฉพาะความสนใจของผู้ใช้

- ใช้ `watchlist` เป็นรายชื่อบริษัทที่อยากติดตาม
- ไม่มีช่องจำนวนหุ้น ต้นทุน มูลค่าพอร์ต หรือกำไรขาดทุน
- URL ที่เพิ่มในหน้าแหล่งข้อมูลบอกว่าอยากให้ระบบดูเว็บไซต์ใดเป็นพิเศษ และแสดงชัดว่า URL อื่นยังเป็นบุ๊กมาร์ก
- ราคาแสดงรายบริษัทเป็นข้อมูลประกอบเท่านั้น
- เมื่อเริ่มเซิร์ฟเวอร์ ระบบย้าย state เดิมโดยเก็บเฉพาะ ticker สหรัฐฯ ที่รองรับ และลบ `holdings`, `qty`, `cost`
- export JSON และ API state ใช้โครงสร้างใหม่เดียวกัน

## การตรวจสอบ

- Unit/API/persistence: `npm.cmd test`
- Desktop/mobile UI: `npm.cmd run test:ui`
- PWA/offline/privacy: `npm.cmd run test:pwa`
- Browser simulation 20 บัญชี: `npm.cmd run test:users`

ข้อจำกัดหลักยังคงอยู่: URL ที่ผู้ใช้เพิ่มยังไม่ถูกดึงหรือสรุปอัตโนมัติ ต้องสร้าง feed catalog หรือ ingestion service ที่ป้องกัน SSRF ก่อน
