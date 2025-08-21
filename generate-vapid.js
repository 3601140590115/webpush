const fs = require('fs');
const path = require('path');
const webpush = require('web-push');

const KEYS_FILE = path.join(__dirname, 'webpush-keys.js');

function generateVapidKeys() {
  const vapidKeys = webpush.generateVAPIDKeys();
  const content = `module.exports = {
  publicKey: '${vapidKeys.publicKey}',
  privateKey: '${vapidKeys.privateKey}'
};\n`;
  fs.writeFileSync(KEYS_FILE, content, 'utf8');
  return vapidKeys;
}

if (!fs.existsSync(KEYS_FILE)) {
  console.log('Generando claves VAPID...');
  generateVapidKeys();
} else {
  console.log('Las claves VAPID ya existen.');
}
