export const DEFAULT_AVATAR = '../resources/logo.png';

export function applyAvatar(img: HTMLImageElement, url?: string): void {
  const next = url?.trim() ?? '';
  img.referrerPolicy = 'no-referrer';
  const fallback = () => {
    img.removeEventListener('error', fallback);
    if (!img.getAttribute('src')?.includes('logo.png')) {
      img.src = DEFAULT_AVATAR;
    }
  };
  img.addEventListener('error', fallback);
  img.src = /^(https?:\/\/|data:image\/)/i.test(next) ? next : DEFAULT_AVATAR;
}
