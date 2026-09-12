const fs = require('node:fs');

const packagePath = require.resolve('kafkajs/package.json');
const packageVersion = require(packagePath).version;

// KafkaJS 2.2.4 schedules a timeout even when its request queue is empty.
// Recent Node releases expose that upstream bug as TimeoutNegativeWarning.
// Keep the workaround narrowly scoped so a future KafkaJS release is left
// untouched and can provide its own fix.
if (packageVersion !== '2.2.4') {
  process.exit(0);
}

const requestQueuePath = require.resolve('kafkajs/src/network/requestQueue/index.js');
const source = fs.readFileSync(requestQueuePath, 'utf8');
const original = `    if (!this.throttleCheckTimeoutId) {
      if (this.pending.length > 0) {
        scheduleAt = scheduleAt > 0 ? scheduleAt : CHECK_PENDING_REQUESTS_INTERVAL
      }
      this.throttleCheckTimeoutId = setTimeout(() => {`;
const replacement = `    if (!this.throttleCheckTimeoutId && this.pending.length > 0) {
      scheduleAt = scheduleAt > 0 ? scheduleAt : CHECK_PENDING_REQUESTS_INTERVAL
      this.throttleCheckTimeoutId = setTimeout(() => {`;

if (source.includes(replacement)) {
  process.exit(0);
}

if (!source.includes(original)) {
  throw new Error('KafkaJS request queue source changed; review the Node timer workaround.');
}

fs.writeFileSync(requestQueuePath, source.replace(original, replacement));
