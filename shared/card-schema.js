// schema ของ cards/data.csv ตามตารางคอลัมน์ใน spec หัวข้อ 4.1 (UMD: ใช้ได้ทั้ง server และ browser)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CARD_SCHEMA = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  return {
    columns: {
      id: { type: 'id', required: true },
      name: { type: 'text', required: true, max: 16 },
      size: { type: 'int', required: true, min: 2, max: 5, rule: true },
      flavor: { type: 'text', max: 80 },
    },
    secret: [], // ไม่มีคอลัมน์ลับ (R-4.1-05)
  };
});
