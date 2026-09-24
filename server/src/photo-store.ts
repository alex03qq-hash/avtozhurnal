/**
 * Хранилище фотографий чеков.
 *
 * Фото лежат отдельными файлами в `data/photos`, а в базе хранится только ссылка (photoId).
 * Так файл базы остаётся небольшим и читаемым, а фотографии можно копировать и архивировать отдельно.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ValidationError } from './validate.ts';

const ALLOWED: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Максимальный размер одного фото после сжатия в браузере — 4 МБ. */
const MAX_BYTES = 4 * 1024 * 1024;
const EXTENSIONS = ['jpg', 'png', 'webp'];

export interface StoredPhoto {
  id: string;
  bytes: number;
  extension: string;
}

export class PhotoStore {
  private readonly dir: string;

  constructor(dataDir: string) {
    this.dir = path.resolve(dataDir, 'photos');
  }

  get directory(): string {
    return this.dir;
  }

  async init(): Promise<void> {
    await fsp.mkdir(this.dir, { recursive: true });
  }

  /** Сохраняет фото из data-URL и возвращает идентификатор. */
  async save(dataUrl: unknown): Promise<StoredPhoto> {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
      throw new ValidationError('Фото не распознано: ожидается изображение с камеры или из галереи.');
    }

    const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
    if (!match) throw new ValidationError('Фото не распознано: неверный формат данных.');

    const mime = match[1].toLowerCase();
    const extension = ALLOWED[mime];
    if (!extension) throw new ValidationError('Поддерживаются только изображения JPEG, PNG и WebP.');

    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length) throw new ValidationError('Фото пустое.');
    if (bytes.length > MAX_BYTES) throw new ValidationError('Фото слишком большое — уменьшите его и попробуйте снова.');

    const id = randomUUID();
    await fsp.mkdir(this.dir, { recursive: true });
    await fsp.writeFile(path.join(this.dir, `${id}.${extension}`), bytes);
    return { id, bytes: bytes.length, extension };
  }

  /** Полный путь к файлу или null, если файла нет. */
  private find(id: string): { file: string; extension: string } | null {
    if (!/^[a-z0-9-]+$/i.test(id)) return null;
    for (const extension of EXTENSIONS) {
      const file = path.join(this.dir, `${id}.${extension}`);
      if (fs.existsSync(file)) return { file, extension };
    }
    return null;
  }

  async read(id: string): Promise<{ bytes: Buffer; mime: string } | null> {
    const found = this.find(id);
    if (!found) return null;
    const bytes = await fsp.readFile(found.file);
    const mime = Object.entries(ALLOWED).find(([, ext]) => ext === found.extension)?.[0] ?? 'image/jpeg';
    return { bytes, mime };
  }

  async remove(id: string): Promise<boolean> {
    const found = this.find(id);
    if (!found) return false;
    await fsp.unlink(found.file).catch(() => undefined);
    return true;
  }
}
