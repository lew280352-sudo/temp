# StockLens UI จากภาพอ้างอิง

เปลี่ยนหน้าบัญชีและ navigation ตามภาพผู้ใช้ โดยใช้ฟอร์มจริงและเส้นทางเดิม ไม่ใช่ภาพ mockup ทับแอป

- หน้าล็อกอิน: การ์ดขาว แผงม่วงขอบโค้งอยู่ขวา; เมื่อสมัครสมาชิกแผงเลื่อนไปซ้าย อีเมลยังอยู่เมื่อสลับโหมด บนมือถือเรียงในแนวตั้ง
- แอป: พื้นม่วงดำ เมนูลอย 5 ปุ่มพร้อมวงกลมสีมะนาวติดตามหน้าที่เลือก ใช้งานด้วยคีย์บอร์ดได้ มีเมนูเพิ่มเติมสำหรับทุกเส้นทางรอง และเว้นที่ท้ายเนื้อหาเหนือ dock
- การลดภาพเคลื่อนไหว การกู้คืนบัญชี MFA ความเป็นส่วนตัว และสถานะบริการยังทำงานตามเดิม ภาพตัวอย่างใช้บัญชีและข่าวที่ระบุว่าเป็นข้อมูลทดสอบ

ปรับตามข้อสังเกตวันที่ 6 พฤศจิกายน 2026: ล็อกอินและสมัครใช้กรอบเดียวกันบนคอม แบ่งพื้นที่ 50/50 กรอบสูง 700px และย่อตามจอสั้น ฟอร์มยาวเลื่อนได้โดยไม่ถูกตัด มือถือเรียงตามเนื้อหา แผงม่วงแสดงตัวอย่างบริษัทจริงที่รองรับและอธิบายการเลือกแหล่งข่าว ไม่มีราคา ข่าว หรือรายการติดตามผู้ใช้ที่สร้างขึ้น อ่าน [แผนและที่มาสกิล Anthropic/Vercel](AUTH_UI_REFINEMENT.md)

| หน้าจอ | 390px | 768px | 1440px |
| --- | --- | --- | --- |
| เข้าสู่ระบบ | [ภาพ](screenshots/reference-login-390.png) | [ภาพ](screenshots/reference-login-768.png) | [ภาพ](screenshots/reference-login-1440.png) |
| สร้างบัญชี | [ภาพ](screenshots/reference-register-390.png) | [ภาพ](screenshots/reference-register-768.png) | [ภาพ](screenshots/reference-register-1440.png) |
| ภาพรวมและเมนู | [ภาพ](screenshots/reference-overview-390.png) | [ภาพ](screenshots/reference-overview-768.png) | [ภาพ](screenshots/reference-overview-1440.png) |

[หน้าสมัครบนคอมจอสั้น 1440×768](screenshots/reference-register-short-desktop.png) · มี regression เพิ่มสำหรับความสูงสองโหมด ความกว้างสองฝั่ง focus หลังสลับโหมด และจอ 320px

ตรวจ interaction ใหม่ด้วย `npm run test:reference-ui` และตรวจเส้นทางเดิมด้วยชุด Playwright ใน package.json รายงานและภาพ CI อยู่ใน artifact responsive-screenshots การแก้ UI นี้ไม่ได้ deploy หรือย้ายบัญชีเดิม; ขั้นตอนเปิดออนไลน์ยังอยู่ใน [FREE_CLOUD.md](FREE_CLOUD.md)

ผลตรวจภายใน: 63 unit/API tests, Playwright เส้นทางเดิมและ UI อ้างอิงที่ 390/768/1440px, MFA/อีเมล/PWA และผู้ใช้จำลอง 20/20 ผ่าน ตรวจ loading text บนการ์ดขาวและ breadcrumb บนพื้นเข้มด้วย contrast regression

Taste lint ไม่มี FAIL หลังระบุข้อยกเว้น gradient ตามภาพผู้ใช้โดยตรง; warnings ที่เหลือเป็นเงาของ dialog/เมนูลอย/การ์ดบัญชีและ backdrop:none ตัวตรวจ Impeccable ช่วยพบสี loading text และ breadcrumb ที่แก้แล้ว ส่วน glow สีมะนาวและแผงม่วงเป็นแบบที่ผู้ใช้เลือก ไม่ได้อ้างว่าตัวตรวจไม่มี findings
