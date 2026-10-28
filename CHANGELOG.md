# Changelog / บันทึกการเปลี่ยนแปลง

เวอร์ชันล่าสุดอยู่บนสุด · Newest version first.
ปุ่ม "What's new" ในหน้า About เปิดไฟล์นี้บน GitHub · The "What's new" link in the About panel opens this file on GitHub.

## v1.3.0 — 2026-10-26

### ไทย

**ใหม่**
- เพิ่มป้ายเตือนการตรวจสอบข้อมูล: เพิ่มข้อความเตือนให้ผู้ใช้ตรวจสอบความถูกต้องของข้อความก่อนนำไปใช้งานจริงเสมอ
- ปรับปรุง Prompt ตรวจสอบสองภาษา: ปรับปรุง System Instruction (Prompt) มาตรฐานให้ชัดเจนยิ่งขึ้นและเน้นย้ำการตรวจจับคำสะกดผิดทั้งภาษาไทยและภาษาอังกฤษเสมอ
- ปรับปรุง UI ให้สวยงามและสอดคล้องกับตัวโปรแกรมหลักมากขึ้น และ ตัดส่วนที่ไม่จำเป็นลดความสับสน เช่น ตัวเลือกภาษาที่ตรวจ และ การดักจับคำน่าสงสัย ออกเพื่อลดความซับซ้อนในการตั้งค่า
- อัปเดตคู่มือตั้งค่าเซิร์ฟเวอร์: ปรับปรุงขั้นตอนการตั้งค่าเซิร์ฟเวอร์ให้กระชับและเข้าใจง่ายยิ่งขึ้น

### English

**New**
- Safety Warning & Disclaimer: Added a prominent notice reminding users to review and verify all text before official use.
- Improved Bilingual Prompting: Refined the default System Instruction for better clarity, ensuring balanced accuracy for both Thai and English proofreading.
- Streamlined UI & Language Indicators: Added dynamic language scope indicators ([TH] / [TH/EN]) under the engine toggle, and removed redundant options ("Languages to check" and "Flag suspicious words") for a cleaner interface.
- Updated Setup Guide: Improved step-by-step instructions in the server setup helper for a smoother onboarding experience.

## v1.2.0 — 2026-10-19

### ไทย

**ใหม่**
- สลับภาษาหน้าจอได้ (EN / TH) เปิดมาเป็นภาษาอังกฤษเสมอ พรอมต์มาตรฐานจะสลับตามภาษาด้วย
- ปุ่ม "ล้างการตรวจทั้งหมด" เคลียร์ผลที่เจอ แล้วเริ่มตรวจรอบใหม่ได้ทันที
- โหมด PyThaiNLP: ถ้ายังไม่ได้รันบริการ Python จะแจ้งเตือนและหยุด ไม่ตรวจต่อด้วยคลังคำเพียงอย่างเดียว
- ปุ่ม ? และ i สลับกล่องกันได้ และคลิกที่อื่นเพื่อปิด
- หน้า About มีลิงก์ "มีอะไรใหม่" ไปยังบันทึกการเปลี่ยนแปลงบน GitHub และปุ่มสนับสนุนผู้พัฒนาบน Ko-fi

**ปรับปรุง**
- ปรับหน้าตาใหม่ให้เรียบง่ายและทันสมัย: ระยะห่างสม่ำเสมอ, ปุ่มสลับเครื่องมือตรวจ, การ์ดผลตรวจอ่านง่ายขึ้น, ย้ายบันทึกการทำงานไปไว้ล่างสุด
- แสดงผลการตรวจลื่นขึ้นเมื่อเอกสารยาว และสแกนคำน่าสงสัยเร็วขึ้น

**แก้ไข**
- ปุ่มเพิ่มโปรไฟล์ใหม่, ลบโปรไฟล์ และลบ key กดแล้วไม่ทำงาน
- เลือกโมเดลจากรายการแล้วไม่ถูกบันทึก (Cloud API ส่งคำขอโดยไม่มีชื่อโมเดล)
- เปลี่ยนผู้ให้บริการแล้ว URL / timeout / chunk ไม่เปลี่ยนตาม
- ล้างรายการคำที่ละเว้นแล้ว คำเหล่านั้นยังถูกข้ามอยู่จนกว่าจะปิดเปิดปลั๊กอินใหม่
- กดตรวจซ้ำระหว่างรอเชื่อมต่อบริการ PyThaiNLP ทำให้เริ่มตรวจซ้อนกันได้
- แก้คำพิมพ์ผิดในพรอมต์มาตรฐานภาษาไทย (ซ็อน → ซ้อน)
- ปุ่ม i (About) ไม่ทำงาน และลิงก์คู่มือบน GitHub เปิดไม่ได้

### English

**New**
- Switch the interface language (EN / TH); the plugin always opens in English. The built-in prompt follows the language too.
- "Clear all results" button: wipe the findings and start a fresh check right away.
- PyThaiNLP mode: if the Python service is not running, you now get a clear error and the check stops instead of silently falling back to the dictionary only.
- The ? and i buttons now swap panels, and clicking anywhere else closes them.
- The About panel has a "What's new" link to the changelog on GitHub and a Ko-fi button to support the developer.

**Improved**
- Redesigned, cleaner and more modern interface: consistent spacing, a segmented checker switch, easier-to-read result cards, and the activity log moved to the bottom.
- Smoother result display on long documents, and faster scanning for suspicious words.

**Fixed**
- Add profile, Delete profile and Remove key buttons did nothing.
- A model picked from the list was not saved (Cloud API requests went out without a model name).
- Changing the provider did not update the URL / timeout / chunk defaults.
- After clearing the ignored words list, those words were still skipped until the plugin was reloaded.
- Pressing Check again while waiting for the PyThaiNLP service could start two checks at once.
- Fixed a typo in the built-in Thai prompt (ซ็อน → ซ้อน).
- The i (About) button did not work, and the GitHub guide link could not be opened.
