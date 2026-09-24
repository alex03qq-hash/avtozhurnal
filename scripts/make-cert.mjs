#!/usr/bin/env node
/**
 * Самоподписанный сертификат для https.
 *
 * Зачем: Android устанавливает веб-приложение на домашний экран только по https.
 * Скрипт создаёт сертификат для адреса этого компьютера в локальной сети,
 * чтобы телефон мог открыть журнал по защищённому адресу.
 *
 * Использование:
 *   node scripts/make-cert.mjs           # адрес определится автоматически
 *   node scripts/make-cert.mjs 192.168.1.42
 *
 * После этого: npm run start:https
 * Сертификат самоподписанный — телефон один раз попросит подтвердить доверие к нему.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const certDir = path.join(root, '.certs');

function lanAddress() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  return null;
}

const address = process.argv[2] ?? lanAddress();
if (!address) {
  console.error('Не удалось определить адрес компьютера в сети. Укажите его вручную: node scripts/make-cert.mjs 192.168.1.42');
  process.exit(1);
}

fs.mkdirSync(certDir, { recursive: true });

try {
  execFileSync(
    'openssl',
    [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', path.join(certDir, 'key.pem'),
      '-out', path.join(certDir, 'cert.pem'),
      '-days', '3650',
      '-subj', '/CN=АвтоЖурнал',
      '-addext', `subjectAltName=IP:${address},IP:127.0.0.1,DNS:localhost`,
    ],
    { stdio: 'inherit' },
  );
} catch (error) {
  console.error('Не удалось создать сертификат. Проверьте, что установлен openssl (на macOS он есть из коробки).');
  console.error(String(error));
  process.exit(1);
}

console.log(`\nСертификат готов: ${certDir}`);
console.log(`Он выписан для адреса ${address}`);
console.log('Запуск: npm run start:https');
console.log(`Телефон откроет журнал по адресу https://${address}:4000`);
console.log('При первом входе телефон предупредит о самоподписанном сертификате — это ожидаемо, нужно подтвердить переход.');
