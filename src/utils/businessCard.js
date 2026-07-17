import { autoLandscape } from './imageOrientation';

// --- Public entry point used by the webcam capture UI ---
// Returns { imageDataUrl, width, height, rawText, lines, guesses }
export async function processCardImage(rawDataUrl) {
  // Business cards are wide rectangles — if the camera handed back a portrait
  // (taller-than-wide) image, rotate it 90° so it isn't stretched when placed
  // into the exported Word document.
  const { dataUrl: imageDataUrl, width, height } = await autoLandscape(rawDataUrl);

  let rawText = '';
  try {
    const ocrInput = await preprocessForOcr(imageDataUrl);
    rawText = await runTesseractOcr(ocrInput);
  } catch (e) {
    console.warn('OCR failed:', e);
    rawText = '';
  }

  const guesses = extractGuesses(rawText);
  const lines = rawText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  return { imageDataUrl, width, height, rawText, lines, guesses };
}

// --- OCR-only preprocessing (does not affect the stored/exported photo) ---
// Upscales small captures, converts to grayscale, and boosts contrast —
// business cards are usually crisp black-on-white/light text, and this
// combination noticeably reduces OCR noise compared to feeding the raw
// color webcam frame straight into Tesseract.
async function preprocessForOcr(dataUrl) {
  const img = await loadImage(dataUrl);
  const targetWidth = Math.max(img.naturalWidth, 1600);
  const scale = targetWidth / img.naturalWidth;
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);

  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;
  const contrast = 1.35; // >1 sharpens the split between text and background
  for (let i = 0; i < d.length; i += 4) {
    const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const boosted = (gray - 128) * contrast + 128;
    const clamped = Math.max(0, Math.min(255, boosted));
    d[i] = d[i + 1] = d[i + 2] = clamped;
  }
  ctx.putImageData(imageData, 0, 0);

  return canvas.toDataURL('image/png');
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

// --- Tesseract.js OCR, tuned for the scattered/multi-column layout of business cards ---
let tesseractWorkerPromise = null;

async function getTesseractWorker() {
  if (!tesseractWorkerPromise) {
    tesseractWorkerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      // eng covers most international business cards; chi_sim adds Chinese text
      // support. Language data is fetched once from a CDN and cached by the
      // browser/Electron afterwards, so this needs internet on first use only.
      const worker = await createWorker(['eng', 'chi_sim']);
      // PSM 11 ("sparse text") looks for text anywhere on the page without
      // assuming a single flowing column — this is a much better fit for
      // business cards (logo + two separate text columns) than the default
      // "fully automatic" mode, which tends to stitch unrelated left/right
      // text fragments onto the same line.
      await worker.setParameters({ tessedit_pageseg_mode: '11' });
      return worker;
    })();
  }
  return tesseractWorkerPromise;
}

async function runTesseractOcr(dataUrl) {
  const worker = await getTesseractWorker();
  const { data } = await worker.recognize(dataUrl);
  return (data?.text || '').trim();
}

const COMPANY_KEYWORDS = [
  'co.', 'co,', 'ltd', 'inc', 'corp', 'corporation', 'company', 'gmbh', 'llc',
  'pte', 'group', 'industries', 'industry', 'pharma', 'pharmaceutical',
  'technology', 'technologies', 'tech', 'international', 'holdings',
  'enterprise', 'enterprises', 'plc', 'sa', 's.a.', 'srl', 'bv',
];

const POSITION_KEYWORDS = [
  'owner', 'director', 'purchasing', 'manager', 'sales', 'engineer',
  'ceo', 'cto', 'coo', 'founder', 'president', 'executive', 'officer',
  'vice', 'representative', 'supervisor', 'chief',
];

function guessCompany(lines) {
  const hit = lines.find((l) => {
    const lower = l.toLowerCase();
    return COMPANY_KEYWORDS.some((kw) => lower.includes(kw));
  });
  return hit || '';
}

function guessName(lines, companyGuess) {
  for (const line of lines) {
    if (line === companyGuess) continue;
    if (/[@\d]/.test(line)) continue; // skip lines with digits/email
    const lower = line.toLowerCase();
    if (POSITION_KEYWORDS.some((kw) => lower.includes(kw))) continue;
    if (COMPANY_KEYWORDS.some((kw) => lower.includes(kw))) continue;
    const words = line.trim().split(/\s+/);
    if (words.length >= 2 && words.length <= 4 && /^[A-Za-z\u00C0-\u024F\u4e00-\u9fa5.\-'\s]+$/.test(line)) {
      return line;
    }
  }
  return '';
}

function extractGuesses(text) {
  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const websiteMatch = text.match(/\b(?:https?:\/\/|www\.)[^\s]+\.[a-zA-Z]{2,}[^\s]*/i);
  // Phone: sequences of 7+ digits, possibly with +, spaces, -, ()
  const phoneMatch = text.match(/(\+?\d[\d\s\-().]{6,}\d)/);

  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const company = guessCompany(lines);
  const name = guessName(lines, company);

  return {
    email: emailMatch ? emailMatch[0] : '',
    website: websiteMatch ? websiteMatch[0] : '',
    phone: phoneMatch ? phoneMatch[0].replace(/\s{2,}/g, ' ').trim() : '',
    company,
    name,
  };
}
