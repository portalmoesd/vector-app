const test = require('node:test');
const assert = require('node:assert/strict');
const { isAllowedAdminUpload } = require('./admin-uploads');

test('isAllowedAdminUpload accepts spreadsheet and CSV uploads', () => {
  assert.equal(isAllowedAdminUpload({
    originalname: 'fdi.xlsx',
    mimetype: 'application/octet-stream',
  }), true);
  assert.equal(isAllowedAdminUpload({
    originalname: 'companies.csv',
    mimetype: 'text/plain',
  }), true);
  assert.equal(isAllowedAdminUpload({
    originalname: 'legacy.xls',
    mimetype: 'application/vnd.ms-excel',
  }), true);
});

test('isAllowedAdminUpload rejects unrelated uploads', () => {
  assert.equal(isAllowedAdminUpload({
    originalname: 'script.js',
    mimetype: 'application/javascript',
  }), false);
  assert.equal(isAllowedAdminUpload({
    originalname: 'image.png',
    mimetype: 'image/png',
  }), false);
});
