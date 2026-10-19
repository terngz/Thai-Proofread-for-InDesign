/* =========================================================
 *  changelog.js : รายการ "มีอะไรใหม่" ที่แสดงในหน้า About
 *
 *  วิธีอัปเดตเมื่อออกเวอร์ชันใหม่
 *   1) เพิ่ม object ใหม่ไว้ "บนสุด" ของ CHANGELOG (เลข version ต้องตรงกับ manifest.json)
 *   2) ใส่ข้อความทั้ง th และ en  (new = ใหม่, better = ปรับปรุง, fixed = แก้ไข)
 *   3) เพิ่มรายการเดียวกันใน CHANGELOG.md ด้วย
 *  หน้า About จะแสดงรายการของเวอร์ชันที่ตรงกับ manifest
 *  ถ้าไม่เจอ จะแสดงรายการบนสุดแทน
 * ========================================================= */
"use strict";

const CHANGELOG = [
  {
    version: "1.2.0",
    th: {
      new: [
        "สลับภาษาหน้าจอได้ (TH / EN) ค่าเริ่มต้นเป็นไทย พรอมต์มาตรฐานจะสลับตามภาษาด้วย",
        "ปุ่ม \"ล้างการตรวจทั้งหมด\" เคลียร์ผลที่เจอ แล้วเริ่มตรวจรอบใหม่ได้ทันที",
        "โหมด PyThaiNLP: ถ้ายังไม่ได้รันบริการ Python จะแจ้งเตือนและหยุด ไม่ตรวจต่อด้วยคลังคำเพียงอย่างเดียว",
        "ปุ่ม ? และ i สลับกล่องกันได้ และคลิกที่อื่นเพื่อปิด",
        "หน้า About แสดงรายการ \"มีอะไรใหม่\""
      ],
      better: [
        "ปรับหน้าตาใหม่ให้เรียบง่ายและทันสมัย: ระยะห่างสม่ำเสมอ, ปุ่มสลับเครื่องมือตรวจ, การ์ดผลตรวจอ่านง่ายขึ้น, ย้ายบันทึกการทำงานไปไว้ล่างสุด",
        "แสดงผลการตรวจลื่นขึ้นเมื่อเอกสารยาว และสแกนคำน่าสงสัยเร็วขึ้น"
      ],
      fixed: [
        "ปุ่มเพิ่มโปรไฟล์ใหม่, ลบโปรไฟล์ และลบ key กดแล้วไม่ทำงาน",
        "เลือกโมเดลจากรายการแล้วไม่ถูกบันทึก (Cloud API ส่งคำขอโดยไม่มีชื่อโมเดล)",
        "เปลี่ยนผู้ให้บริการแล้ว URL / timeout / chunk ไม่เปลี่ยนตาม",
        "ปุ่ม i (About) ไม่ทำงาน และลิงก์คู่มือบน GitHub เปิดไม่ได้"
      ]
    },
    en: {
      new: [
        "Switch the interface language (TH / EN); Thai is the default. The built-in prompt follows the language too.",
        "\"Clear all results\" button: wipe the findings and start a fresh check right away.",
        "PyThaiNLP mode: if the Python service is not running, you now get a clear error and the check stops instead of silently falling back to the dictionary only.",
        "The ? and i buttons now swap panels, and clicking anywhere else closes them.",
        "The About panel now shows \"What's new\"."
      ],
      better: [
        "Redesigned, cleaner and more modern interface: consistent spacing, a segmented checker switch, easier-to-read result cards, and the activity log moved to the bottom.",
        "Smoother result display on long documents, and faster scanning for suspicious words."
      ],
      fixed: [
        "Add profile, Delete profile and Remove key buttons did nothing.",
        "A model picked from the list was not saved (Cloud API requests went out without a model name).",
        "Changing the provider did not update the URL / timeout / chunk defaults.",
        "The i (About) button did not work, and the GitHub guide link could not be opened."
      ]
    }
  }
];
