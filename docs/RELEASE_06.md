# StockLens 0.6.0 — Free online AI

- รองรับ GroqCloud Free Plan ผ่าน endpoint คงที่ `https://api.groq.com`
- ค่าเริ่มต้นออนไลน์ใช้ `qwen/qwen3.8-27b` และ strict JSON Schema
- `AI_PROVIDER=auto` ใช้ Groq เมื่อมี `GROQ_API_KEY`; หากไม่มีใช้ Ollama/Qwen3 8B ในเครื่อง
- API key อยู่เฉพาะ server environment ไม่ส่งไป browser, prompt, cache หรือ export
- หน้า AI บอกชัดว่ากำลังใช้ Groq ออนไลน์หรือ Ollama ในเครื่อง
- เมื่อใช้ Groq ส่งเฉพาะข้อมูลหัวข้อข่าวที่จำเป็น ไม่ส่งข้อมูลบัญชี
- ผลสรุปแยก cache ตาม provider และ model เพื่อไม่ปะปนกัน

Free tier มี rate limit และผู้ให้บริการอาจเปลี่ยนโควตาหรือรายชื่อโมเดล แอปจะแสดงข้อผิดพลาดเมื่อ provider ไม่พร้อมและไม่สร้างผลจำลอง
