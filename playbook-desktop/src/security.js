const website = new URL(process.env.PLAYBOOK_DESKTOP_URL || 'https://playbook.example.com');
if (website.protocol !== 'https:' || website.username || website.password || website.pathname !== '/' || website.search || website.hash) {
  throw new Error('PLAYBOOK_DESKTOP_URL muss eine HTTPS-Adresse ohne Pfad oder Zugangsdaten sein.');
}
export const ORIGIN = website.origin;
export function trusted(url) {
  try { const parsed = new URL(url); return parsed.origin === ORIGIN && !parsed.username && !parsed.password; }
  catch { return false; }
}
export function loginNavigation(url) {
  try { const parsed = new URL(url); return trusted(url) || parsed.origin === 'https://steamcommunity.com' && !parsed.username && !parsed.password; }
  catch { return false; }
}

export function reviewPermission(permission, details = {}, captureAllowed = false) {
  if (permission === 'clipboard-sanitized-write') return true;
  if (!captureAllowed || details.isMainFrame !== true) return false;
  if (permission === 'display-capture') return !details.mediaTypes?.includes('audio');
  // Electron <=44 reports display requests as media with no hardware types.
  // Camera/microphone requests have video/audio types and remain denied.
  return permission === 'media' && (Array.isArray(details.mediaTypes) && details.mediaTypes.length === 0 || details.mediaTypes === undefined && details.mediaType === 'unknown');
}
