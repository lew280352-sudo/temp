# ผลการทำเวอร์ชัน 0.3 — US PWA

วันที่ทดสอบ: 18 ตุลาคม 2026 บน Windows, Node 24.18.0 และ Edge headless

## เปลี่ยนจากต้นแบบ

- เปลี่ยนหน้าใช้งานหลักจากหุ้นไทยและข่าว/ราคา/AI สาธิต เป็นรายชื่อหุ้นสหรัฐฯ 12 บริษัท พร้อมต้นทุน USD และหัวข้อ RSS ต้นทางจริง
- เริ่มใช้ฟีด Apple, Microsoft และ NVIDIA ที่ฝั่งเซิร์ฟเวอร์ โดยไม่ใช้ API key; ticker อื่นยังไม่มีฟีด
- ถอดราคาจำลองและเปอร์เซ็นต์พยากรณ์ออก แสดงสถานะยังไม่มีข้อมูลแทน
- เพิ่ม manifest/icons/service worker/public offline screen และวิธีติดตั้ง PWA
- เพิ่มรหัสกู้บัญชีครั้งเดียว hash ด้วย SHA-256 จาก random 192-bit ใช้แทนอีเมล reset ในรุ่นนี้
- เพิ่ม Docker/compose สำหรับเตรียมโฮสต์ พร้อมคู่มือฉบับใหม่ ยังไม่ได้ deploy public URL

## ผลตรวจ

| ชุด | ผล |
| --- | --- |
| API / persistence / feed parser / recovery | 11 tests ผ่าน |
| Desktop/mobile UI เดิมที่ปรับเป็นหุ้นสหรัฐฯ | ผ่าน Register/Login/Logout, URL, portfolio, stale session, Thai search, AI unavailable |
| PWA browser | ผ่าน manifest/icons, service worker, offline fallback, cache ไม่มีข้อมูลส่วนตัว, fractional shares, recovery, RSS XSS fixture และ source/portfolio filtering |
| ผู้ใช้จำลอง 20 บัญชี | ผ่าน 20/20, desktop 10 + mobile viewport 10, ใช้ IP เดียวกัน |
| เชื่อม RSS จริงผ่าน Node | สำเร็จทั้ง 3 เว็บไซต์; ตรวจแยกจาก CI fixtures |
| Docker build / โทรศัพท์จริง / public HTTPS | ยังไม่ได้ทดสอบหรือ deploy |

รอบผู้ใช้ 20 คนใช้เวลา 28.117 วินาที มี API requests 448 ครั้ง p50 ของคำตอบสำเร็จ 89 ms, p95 1,487 ms, สูงสุด 1,989 ms ไม่มี 429 หรือ 5xx ส่วน 400/401/409 เป็นกรณีปฏิเสธที่ตั้งใจทดสอบ

ผลเต็ม: [users20-pwa.json](test-results/users20-pwa.json)

ข้อมูลทดสอบเป็นบัญชีสังเคราะห์ ไม่แตะฐานข้อมูลผู้ใช้จริง ชุด PWA ใช้ RSS fixture ที่มีข้อความโจมตีเพื่อทดสอบการ escape ไม่ใช่บทความจริง ภาพใน test-artifacts ไม่ใช่หลักฐานตลาดหรือผล AI

ผลนี้ไม่ยืนยันความเร็วบนโฮสต์จริง ความแม่นยำของ AI การแจ้ง Push หรือประสบการณ์บนโทรศัพท์จริง การติดตั้ง PWA ในมือถือยังต้องมี HTTPS host ก่อน

## แหล่งข่าวที่ต่อแล้ว

- [Apple RSS information](https://www.apple.com/ca/rss/) → `https://www.apple.com/newsroom/rss-feed.rss`
- [Microsoft News](https://news.microsoft.com/) → `https://news.microsoft.com/source/feed/` (ใช้ feed ปัจจุบันแทน `/feed/` ซึ่งพบรายการเก่ากว่า)
- [NVIDIA RSS](https://nvidianews.nvidia.com/rss) → `https://nvidianews.nvidia.com/releases.xml`

ข่าวจากบริษัทเป็นคำประกาศของผู้เผยแพร่เอง ไม่ใช่การตรวจสอบโดยแหล่งข่าวอิสระ และแอปแสดงเพียงหัวข้อ/เวลา/ลิงก์ต้นฉบับ
