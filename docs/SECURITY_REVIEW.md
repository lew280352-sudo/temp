# ขอบเขตตรวจความปลอดภัยภายในและงานสำหรับผู้ตรวจภายนอก

ตรวจภายในวันที่ 21 ตุลาคม 2026 สำหรับ StockLens 0.8 บนเครื่องพัฒนา การตรวจนี้ **ไม่ใช่ security audit ภายนอก** และไม่รับรองความปลอดภัยสำหรับเผยแพร่สาธารณะ

## สิ่งที่ตรวจแล้ว

- `npm audit --omit=dev --audit-level=low`: ไม่พบ advisory ใน dependency runtime ที่ติดตั้ง ณ วันที่ตรวจ
- `npm test`: ผ่าน 34 รายการ รวม MFA แบบ TOTP, การใช้รหัสซ้ำ, รหัสกู้คืน, ลบบัญชี, token ยืนยันอีเมลครั้งเดียว/หมดอายุ, Web Push แยกบัญชี และการปฏิเสธ endpoint ภายใน/ไม่รองรับ
- Browser UI/PWA ผ่าน และทดสอบเส้นทางหลักกับผู้ใช้จำลอง 20 คนผ่านทั้งหมด
- คีย์ API, คีย์เข้ารหัส MFA และ VAPID private key อยู่ใน `.env` ที่ Git ไม่ติดตาม; บัญชีที่ลบถูก cascade ออกจากตารางข้อมูลผู้ใช้ในฐานข้อมูลใช้งาน
- Web Push จำกัดปลายทางเป็นผู้ให้บริการ Push ที่รู้จักเพื่อลด SSRF และแสดง payload ข่าวแบบทั่วไป ไม่แสดงชื่อหุ้นบนหน้าจอล็อก

## ข้อจำกัดที่ยังต้องตรวจ

- ยังไม่มีผู้ตรวจอิสระทำ penetration test, code review หรือรายงานลงนาม
- ยังไม่มี public HTTPS deployment ให้ทดสอบ end-to-end บนมือถือจากภายนอก และยังไม่มีบัญชี SMTP สำหรับทดสอบอีเมลจริง
- การยืนยันอีเมลเป็นแบบผู้ใช้กดส่งลิงก์เองเมื่อ SMTP พร้อม ยังไม่บังคับทุกบัญชียืนยันก่อน Login
- การส่ง Web Push ทดสอบด้วย sender จำลองและ API integration แล้ว แต่ยังไม่ยืนยันว่าบริการ Push ของเบราว์เซอร์ส่งถึงมือถือจริงในระบบที่เผยแพร่
- Rate limit อยู่ในหน่วยความจำ process และใช้ IP ของ socket; ต้องทบทวนเมื่ออยู่หลัง reverse proxy หรือหลาย instance
- ฐานข้อมูลสำรองก่อนลบบัญชียังมีข้อมูลเก่า ต้องกำหนดระยะเวลาเก็บและขั้นตอนลบสำเนา
- คีย์ MFA ใน `.env` ต้องสำรองคู่กับฐานข้อมูลและควบคุมสิทธิ์ ผู้ตรวจควรทบทวนการจัดการคีย์เมื่อ deploy

## ขอบเขตส่งให้ผู้ตรวจอิสระ

ตรวจ authentication, MFA/recovery, email verification, session และ CSRF; การแยกข้อมูลข้ามบัญชี; SSRF ของ RSS/Push; การจัดการ secrets, backup และการลบบัญชี; การใช้ข้อมูลข่าว/ราคาและ rate limit หลัง proxy; PWA/service worker และ mobile push; dependency และ accessibility หลังมี HTTPS จริง ผู้ตรวจต้องระบุเวอร์ชัน commit, วิธีทดสอบ, finding, severity และผล retest หลังแก้ไข

อ้างอิงแนวปฏิบัติ: [OWASP MFA Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html), [OWASP Email Validation and Verification](https://cheatsheetseries.owasp.org/cheatsheets/Email_Validation_and_Verification_Cheat_Sheet.html), [MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)
