// Compiled service against a stub catalog; no database or external messages.
const assert = require('node:assert/strict');
const { ChatService } = require('../dist/modules/chat/chat.service.js');

let calls = 0;
const catalog = [{ type_name: 'Current test suite', base_price: '4321000', capacity: 3 }];
const service = new ChatService({
  findAllActiveRooms: async () => {
    calls++;
    return catalog;
  },
});

(async () => {
  const vi = await service.processMessage(undefined, 'giá phòng', undefined, 'vi');
  assert.ok(vi.includes('Current test suite') && vi.includes('4.321.000') && vi.includes('3 khách'));
  assert.ok(vi.includes('chưa phải giá chốt') && vi.includes('/book'));

  catalog[0].base_price = '1234000';
  assert.ok(
    (await service.processMessage(undefined, 'room rates', undefined, 'en')).includes('1,234,000'),
    'Rates follow the current catalog',
  );

  const before = calls;
  const cancel = await service.processMessage(undefined, 'hủy phòng', undefined, 'vi');
  assert.ok(cancel.includes('/bookings') && !cancel.includes('24 giờ'));
  assert.equal(calls, before, 'Specific cancellation does not fall into generic room pricing');

  const membership = await service.processMessage(undefined, 'nâng hạng phòng', undefined, 'vi');
  assert.ok(membership.includes('20.000') && membership.includes('nhân viên'));
  assert.equal(calls, before);

  const services = await service.processMessage(undefined, 'spa and wifi', undefined, 'en');
  assert.ok(services.includes('15th Floor') && services.includes('does not create reservations'));

  const unknown = await service.processMessage(undefined, 'hello', undefined, 'en');
  assert.ok(unknown.includes('White Sand assistant') && !unknown.includes('AI Concierge'));

  catalog.length = 0;
  assert.ok((await service.processMessage(undefined, 'room', undefined, 'en')).includes('No rooms'));

  console.log('PASS: White Sand catalog rates; intent precedence; loyalty rules; verified facilities; White Sand assistant.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
