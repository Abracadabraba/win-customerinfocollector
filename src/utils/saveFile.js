import { saveAs } from 'file-saver';

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result); // data:...;base64,XXXX
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function sanitizeFolderName(name) {
  return (name || '未命名展会').replace(/[\\/:*?"<>|]+/g, '_').trim() || '未命名展会';
}

function stripDataUrlPrefix(dataUrl) {
  const idx = dataUrl.indexOf(',');
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
}

/**
 * Saves a docx (or any) blob.
 * On Windows (Electron desktop build): writes directly into
 *   <Downloads>/<exhibitionFolder>/<dateFolder>/<filename>
 * via the Electron main process (no dialog needed).
 * On plain web (dev preview): falls back to a normal browser download.
 *
 * Returns { method: 'downloads' | 'web', path? }
 */
export async function saveDocxToDownloads(blob, { exhibitionFolder, dateFolder, filename }) {
  const safeExhibition = sanitizeFolderName(exhibitionFolder);

  if (typeof window !== 'undefined' && window.electronAPI?.isElectron) {
    const dataUrl = await blobToBase64(blob);
    const base64Data = stripDataUrlPrefix(dataUrl);
    const result = await window.electronAPI.saveDocxToDownloads({
      base64Data,
      exhibitionFolder: safeExhibition,
      dateFolder,
      filename,
    });
    if (result?.success) {
      return { method: 'downloads', path: result.fullPath };
    }
    // Fall back to a plain browser-style download if the direct write failed
    // (e.g. permissions issue on that machine).
    console.warn('Electron Downloads write failed, falling back to browser download:', result?.error);
    saveAs(blob, filename);
    return { method: 'web' };
  }

  saveAs(blob, filename);
  return { method: 'web' };
}
