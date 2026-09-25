#!/usr/bin/env node
/**
 * Генерация кода доступа к журналу.
 *
 * Использование:
 *   npm run token              — вывести готовую строку для .env
 *   npm run token -- --write   — записать код в .env (файл создастся, если его нет)
 *
 * Код состоит только из латинских букв и цифр: заголовки HTTP не допускают кириллицу,
 * а такой код легко продиктовать с телефона.
 */

import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');

/** Читаемый, но стойкий код: четыре группы по четыре символа без похожих букв. */
function makeToken() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(16);
  const groups = [];
  for (let group = 0; group < 4; group += 1) {
    let chunk = '';
    for (let index = 0; index < 4; index += 1) {
      chunk += alphabet[bytes[group * 4 + index] % alphabet.length];
    }
    groups.push(chunk);
  }
  return groups.join('-');
}

const token = makeToken();

if (process.argv.includes('--write')) {
  const current = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const withoutOld = current
    .split('\n')
    .filter((line) => !line.trim().startsWith('ACCESS_TOKEN='))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
  fs.writeFileSync(envPath, `${withoutOld}${withoutOld ? '\n' : ''}ACCESS_TOKEN=${token}\n`, 'utf8');
  console.log(`Код записан в ${envPath}`);
  console.log('Перезапустите приложение: npm start');
} else {
  console.log('Готовый код доступа (запишите в .env):');
  console.log(`\nACCESS_TOKEN=${token}\n`);
  console.log('Или сразу: npm run token -- --write');
}

console.log('После включения на телефоне появится экран входа, код запомнится в браузере.');
