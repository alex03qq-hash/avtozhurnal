#!/usr/bin/env node
/**
 * Публикация проекта в GitHub одной командой.
 *
 * Зачем: подключённая к приложению GitHub-интеграция умеет писать содержимое
 * (contents=write), но не умеет создавать репозитории (нет права administration).
 * Поэтому репозиторий создаётся этим скриптом от вашего имени.
 *
 * Использование:
 *   1. Создайте персональный токен GitHub (classic) с правом `repo`
 *      или fine-grained токен с правами Administration: Read and write
 *      и Contents: Read and write.
 *   2. Выполните:
 *        GITHUB_TOKEN=ghp_xxx node scripts/publish-to-github.mjs
 *   Дополнительные переменные окружения:
 *        GITHUB_OWNER     — владелец (по умолчанию владелец токена)
 *        GITHUB_REPO      — имя репозитория (по умолчанию avtozhurnal)
 *        GITHUB_PRIVATE   — "true", чтобы создать приватный репозиторий
 *        GITHUB_DESCRIPTION — описание репозитория
 *
 * Секреты нигде не сохраняются: токен используется только в момент запуска.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const token = process.env.GITHUB_TOKEN?.trim();
if (!token) {
  console.error('Не задан GITHUB_TOKEN. Пример: GITHUB_TOKEN=ghp_xxx node scripts/publish-to-github.mjs');
  process.exit(1);
}

const repoName = process.env.GITHUB_REPO?.trim() || 'avtozhurnal';
const isPrivate = (process.env.GITHUB_PRIVATE ?? 'false').toLowerCase() === 'true';
const description =
  process.env.GITHUB_DESCRIPTION?.trim() ||
  'АвтоЖурнал — локальное веб-приложение для учёта расходов на автомобиль: заправки, ТО, напоминания, авто-досье';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const api = 'https://api.github.com';

async function apiCall(pathname, init = {}) {
  const response = await fetch(`${api}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'avtozhurnal-publisher',
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`${init.method ?? 'GET'} ${pathname} → ${response.status}: ${data.message ?? text}`);
  }
  return data;
}

const me = await apiCall('/user');
const owner = process.env.GITHUB_OWNER?.trim() || me.login;
console.log(`Публикуем в ${owner}/${repoName} от имени ${me.login}`);

try {
  await apiCall(`/repos/${owner}/${repoName}`);
  console.log('Репозиторий уже существует — используем его.');
} catch (error) {
  if (!String(error.message).includes('404')) throw error;
  const created = await apiCall('/user/repos', {
    method: 'POST',
    body: JSON.stringify({ name: repoName, description, private: isPrivate, auto_init: false }),
  });
  console.log(`Создан репозиторий: ${created.html_url}`);
}

const remote = `https://x-access-token:${token}@github.com/${owner}/${repoName}.git`;

function git(args) {
  return execFileSync('git', args, { cwd: root, stdio: 'inherit' });
}

try {
  git(['rev-parse', '--is-inside-work-tree']);
} catch {
  git(['init', '-b', 'main']);
  git(['add', '.']);
  git(['-c', 'user.name=АвтоЖурнал', '-c', 'user.email=avtozhurnal@example.com', 'commit', '-m', 'chore: первая версия АвтоЖурнала']);
}

const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root }).toString().trim() || 'main';
console.log(`Отправляем ветку ${branch} в GitHub…`);
// Токен передаётся прямо в URL push и не сохраняется в .git/config.
git(['push', remote, `${branch}:${branch}`, '--force']);
console.log(`\nГотово! Откройте: https://github.com/${owner}/${repoName}`);
console.log('Совет: чтобы git не спрашивал пароль при следующих push, настройте credential helper или SSH-ключ.');
