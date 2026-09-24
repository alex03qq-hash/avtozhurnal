/** Поле «фото чека»: снять на камеру, выбрать из галереи, посмотреть или убрать. */

import React, { useRef, useState } from 'react';
import { api, photoUrl } from '../api.ts';
import { compressPhoto } from '../utils/photo.ts';
import { Button, Loader } from '../ui.tsx';

export default function PhotoField({
  photoId,
  onChange,
  onError,
}: {
  photoId?: string | null;
  onChange: (photoId: string | null) => void;
  onError: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const dataUrl = await compressPhoto(file);
      const uploaded = await api.uploadPhoto(dataUrl);
      onChange(uploaded.id);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Не удалось загрузить фото.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="photo-field photo-field--form">
      <input
        ref={inputRef}
        className="photo-field__input"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
          event.target.value = '';
        }}
      />
      {photoId ? (
        <div className="photo-field__preview">
          <a href={photoUrl(photoId)} target="_blank" rel="noreferrer" title="Открыть фото в полном размере">
            <img src={photoUrl(photoId)} alt="Фото чека — по нему вносятся данные" />
          </a>
          <div className="photo-field__actions">
            <Button size="sm" variant="ghost" onClick={() => inputRef.current?.click()}>
              Заменить
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
              Убрать
            </Button>
          </div>
        </div>
      ) : busy ? (
        <Loader label="Обрабатываем фото…" />
      ) : (
        <Button size="sm" variant="secondary" onClick={() => inputRef.current?.click()}>
          Приложить фото чека
        </Button>
      )}
    </div>
  );
}
