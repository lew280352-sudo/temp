# รุ่น 0.4.0 — Local AI ฟรี

วันที่ตรวจ: 19 ตุลาคม 2026

## สิ่งที่เพิ่ม

- Ollama + Qwen3 8B สำหรับสรุปหัวข้อข่าวในเครื่อง ไม่ใช้ AI API key
- ผลลัพธ์แบบ JSON schema แยกข้อเท็จจริง ปัจจัยเชิงบวก ความเสี่ยง สิ่งที่ยังไม่ทราบ และความมั่นใจ
- ลิงก์กลับไปยังหัวข้อข่าวต้นฉบับ, cache ใน SQLite และตรวจ session ซ้ำหลังโมเดลตอบ
- จำกัด Ollama URL ไว้ที่ localhost, จำกัด input/output/เวลา และป้องกัน prompt injection จากหัวข้อข่าว
- หน้าจอสถานะโมเดล คู่มือการติดตั้ง และข้อความขอบเขตว่าไม่ใช่การทำนายราคา

## ผลตรวจ

- `npm.cmd test`: 15/15 ผ่าน
- `npm.cmd run test:ui`: ผ่าน desktop/mobile registration, login, portfolio, sources, AI state, logout และ overflow
- `npm.cmd run test:pwa`: ผ่าน manifest, service worker, RSS fixture, XSS escaping, Local AI fixture, recovery และ offline privacy
- `npm.cmd run test:users`: ผู้ใช้จำลอง 20/20 ผ่านครบ 6 ขั้นตอน, API 596 คำขอ, successful p95 995 ms
- ทดสอบ Qwen3 8B จริงบน NVIDIA RTX 3070 8GB: Ollama รายงาน 100% GPU, context 8192 และคืน structured summary ภาษาไทยสำเร็จ
- สำรองฐานข้อมูลก่อน restart แล้ว และ health endpoint ตอบ `0.4.0`

## ข้อจำกัดที่ยังเหลือ

AI อ่านเฉพาะหัวข้อ RSS ของ AAPL, MSFT และ NVDA ไม่อ่านข้อความบทความเต็ม ไม่ยืนยันข้ามสำนักข่าว และไม่ทำนายขึ้น/ลง การทำนายต้องมีข้อมูลราคาย้อนหลัง นิยามช่วงเวลา baseline และ backtest แยกก่อน
