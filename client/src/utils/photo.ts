/**
 * Подготовка фото чека перед отправкой.
 *
 * Снимок с камеры телефона весит 3–8 МБ, поэтому уменьшаем его прямо в браузере:
 * длинная сторона до 1280 точек, качество JPEG 0.72. Так фото остаётся читаемым,
 * а база и передача по Wi-Fi — быстрыми.
 */

const MAX_SIDE = 1280;
const QUALITY = 0.72;

export async function compressPhoto(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Это не изображение. Выберите фото чека.');

  const dataUrl = await readFile(file);
  const image = await loadImage(dataUrl);

  const scale = Math.min(1, MAX_SIDE / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Браузер не смог обработать фото.');
  context.drawImage(image, 0, 0, width, height);

  return canvas.toDataURL('image/jpeg', QUALITY);
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Не удалось прочитать файл.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Не удалось открыть изображение.'));
    image.src = source;
  });
}
