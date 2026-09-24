/** Приём и выдача фотографий чеков: c камеры телефона прямо в запись. */

import { Router } from 'express';
import type { Store } from '../store.ts';
import { ah } from './async-handler.ts';
import type { PhotoStore } from '../photo-store.ts';

/** Сколько фото уже сохранено — показывается в настройках. */
export function createPhotosRouter(store: Store, photos: PhotoStore): Router {
  const router = Router();

  router.get('/photos/stats', async (_req, res) => {
    const used = store.get().fuel.filter((row) => row.photoId).length + store.get().expenses.filter((row) => row.photoId).length;
    res.json({ linked: used });
  });

  router.post('/photos', ah(async (req, res) => {
    const body = (req.body ?? {}) as { dataUrl?: string };
    const stored = await photos.save(body.dataUrl);
    res.status(201).json({
      id: stored.id,
      bytes: stored.bytes,
      url: `/api/photos/${stored.id}`,
      message: 'Фото сохранено.',
    });
  }));

  router.get('/photos/:id', ah(async (req, res) => {
    const photo = await photos.read(req.params.id);
    if (!photo) return res.status(404).json({ error: 'Фото не найдено.' });
    res.setHeader('Content-Type', photo.mime);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    return res.send(photo.bytes);
  }));

  router.delete('/photos/:id', ah(async (req, res) => {
    const removed = await photos.remove(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Фото не найдено.' });

    // Ссылки на удалённый снимок убираем из записей: данные записи при этом не теряются,
    // пропадает только приложение-исходник.
    let cleared = 0;
    await store.mutate((db) => {
      for (const row of [...db.fuel, ...db.expenses]) {
        if (row.photoId === req.params.id) {
          row.photoId = null;
          row.updatedAt = new Date().toISOString();
          cleared += 1;
        }
      }
    });

    return res.json({ ok: true, cleared, message: 'Фото удалено. Данные записей сохранены.' });
  }));

  return router;
}
