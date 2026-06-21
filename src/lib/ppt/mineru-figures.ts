import { readFile } from 'fs/promises';
import path from 'path';
import { isUsingObjectStorage, listStoredFileKeys, resolveFileUrl, retrieveFileBuffer } from '@/lib/storage';

export interface MinerUFigureInput {
  label: string;
  caption: string;
  pageIdx: number;
  bbox: number[];
  localPath: string;
  imageUrl: string;
  width?: number;
  height?: number;
}

// ============================================================
// MinerU: Read figures from disk (synchronous, no HTTP)
// ============================================================
export async function readMinerUFiguresFromDisk(paperId: string): Promise<MinerUFigureInput[]> {
  if (!paperId) return [];

  if (isUsingObjectStorage()) {
    // 对象存储：通过统一 storage provider 读取元数据和签名 URL
    try {
      const keys = await listStoredFileKeys(`mineru-figures/${paperId}/`, 100);
      const metaKey = keys.find(k => k.endsWith('_metadata.json'));
      if (metaKey) {
        const metaBuffer = await retrieveFileBuffer(metaKey);
        const figures = JSON.parse(metaBuffer.toString('utf-8'));
        if (Array.isArray(figures) && figures.length > 0) {
          // 为图片生成签名 URL
          const figuresWithUrls = await Promise.all(
            figures.map(async (fig: MinerUFigureInput) => {
              const key = fig.localPath || fig.imageUrl;
              if (key && !key.startsWith('http')) {
                const signedUrl = await resolveFileUrl(key);
                return { ...fig, imageUrl: signedUrl };
              }
              return fig;
            })
          );
          console.log(`[PPT-V2] Loaded ${figuresWithUrls.length} MinerU figures from S3 for paperId=${paperId}`);
          return figuresWithUrls;
        }
      }
    } catch {
      // S3 读取失败
    }
    return [];
  }

  // 开发环境：从本地读取
  try {
    const metaPath = path.join(process.cwd(), 'public', 'mineru-figures', paperId, '_metadata.json');
    const raw = await readFile(metaPath, 'utf-8');
    const figures = JSON.parse(raw);
    if (Array.isArray(figures) && figures.length > 0) {
      console.log(`[PPT-V2] Loaded ${figures.length} MinerU figures from disk for paperId=${paperId}`);
      return figures;
    }
  } catch {
    // No metadata file, figures not extracted yet
  }
  return [];
}

// ============================================================
// MinerU: Full extraction pipeline (upload → poll → download → parse)
// Runs directly in the ppt-v2 process (no HTTP call to self)
// ============================================================
const MINERU_API_BASE = 'https://mineru.net';
const MINERU_API_TOKEN = process.env.MINERU_API_TOKEN || '';

export async function runMinerUExtraction(paperId: string, pdfFilePath: string, fileName: string): Promise<MinerUFigureInput[]> {
  if (!MINERU_API_TOKEN) {
    console.warn('[PPT-V2/MinerU] MINERU_API_TOKEN not configured, skipping extraction');
    return [];
  }

  try {
    // Step 1: Request upload URL
    console.log(`[PPT-V2/MinerU] Starting extraction for ${fileName} (paperId=${paperId})`);
    const batchRes = await fetch(`${MINERU_API_BASE}/api/v4/file-urls/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MINERU_API_TOKEN}`,
      },
      body: JSON.stringify({
        files: [{ name: fileName, data_id: paperId }],
        model_version: 'vlm',
        enable_formula: true,
        enable_table: true,
        language: 'ch',
      }),
    });

    if (!batchRes.ok) {
      const text = await batchRes.text();
      console.error(`[PPT-V2/MinerU] Batch request failed (${batchRes.status}): ${text.slice(0, 200)}`);
      return [];
    }

    const batchData = await batchRes.json();
    if (batchData.code !== 0) {
      console.error(`[PPT-V2/MinerU] API error: ${batchData.msg}`);
      return [];
    }

    const batchId: string = batchData.data.batch_id;
    const uploadUrl: string = batchData.data.file_urls[0];

    // Step 2: Upload PDF file to presigned URL
    console.log(`[PPT-V2/MinerU] Uploading PDF to MinerU storage...`);
    const fileBuffer = await readFile(pdfFilePath);
    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      body: fileBuffer,
    });
    if (!uploadRes.ok) {
      console.error(`[PPT-V2/MinerU] File upload failed (${uploadRes.status})`);
      return [];
    }
    console.log(`[PPT-V2/MinerU] Upload complete. Batch ID: ${batchId}`);

    // Step 3: Poll for result (max 10 minutes)
    console.log(`[PPT-V2/MinerU] Polling for extraction result...`);
    const pollUrl = `${MINERU_API_BASE}/api/v4/extract-results/batch/${batchId}`;
    const pollHeaders = { 'Authorization': `Bearer ${MINERU_API_TOKEN}` };

    for (let attempt = 0; attempt < 120; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 5000));

      const pollRes = await fetch(pollUrl, { headers: pollHeaders });
      if (!pollRes.ok) continue;

      const pollData = await pollRes.json();
      if (pollData.code !== 0) continue;

      const results = pollData.data?.extract_result;
      if (!Array.isArray(results) || results.length === 0) continue;

      const result = results[0];
      if (result.state === 'done' && result.full_zip_url) {
        console.log(`[PPT-V2/MinerU] Extraction complete! Downloading ZIP...`);
        // Step 4: Download and parse the ZIP
        return await downloadAndParseMinerUZip(result.full_zip_url, paperId);
      }

      if (result.state === 'failed') {
        console.error(`[PPT-V2/MinerU] Extraction failed: ${result.err_msg}`);
        return [];
      }

      // Still running
      if (attempt % 6 === 0) {
        const progress = result.extract_progress;
        console.log(`[PPT-V2/MinerU] State: ${result.state}, Progress: ${progress?.extracted_pages || '?'}/${progress?.total_pages || '?'}`);
      }
    }

    console.error('[PPT-V2/MinerU] Extraction timed out');
    return [];
  } catch (err) {
    console.error('[PPT-V2/MinerU] Error:', err instanceof Error ? err.message : String(err));
    return [];
  }
}

// Download ZIP from MinerU, extract images and metadata, save to disk
// Strategy: Only process images referenced in content_list.json (type='image' with valid img_path)
// Filter out small icons/decorations by bbox size, and extract figure labels from nearby text
async function downloadAndParseMinerUZip(zipUrl: string, paperId: string): Promise<MinerUFigureInput[]> {
  const res = await fetch(zipUrl);
  if (!res.ok) throw new Error(`Failed to download ZIP (${res.status})`);

  const zipBuffer = Buffer.from(await res.arrayBuffer());
  const JSZipModule = await import('jszip');
  const JSZip = JSZipModule.default || JSZipModule;
  const zip = await JSZip.loadAsync(zipBuffer);

  const figuresDir = path.join(process.cwd(), 'public', 'mineru-figures', paperId);
  const { mkdir, writeFile: writeFileFs } = await import('fs/promises');
  await mkdir(figuresDir, { recursive: true });

  // Parse content_list.json (v1 - has img_path references)
  let contentList: Array<Record<string, unknown>> = [];
  const contentListFile = Object.keys(zip.files).find(
    f => f.endsWith('_content_list.json') && !f.endsWith('_v2.json')
  );
  if (contentListFile) {
    const str = await zip.file(contentListFile)!.async('string');
    contentList = JSON.parse(str);
    console.log(`[PPT-V2/MinerU] Content list: ${contentList.length} items`);
  }

  // ── Build figure-caption mapping from content_list ──
  // Collect all text entries grouped by page for caption scanning
  const textByPage = new Map<number, Array<{ text: string; idx: number }>>();
  for (let i = 0; i < contentList.length; i++) {
    const item = contentList[i];
    if (item.type === 'text' || item.type === 'title') {
      const pageIdx = typeof item.page_idx === 'number' ? item.page_idx : -1;
      const text = typeof item.text === 'string' ? item.text : '';
      if (pageIdx >= 0 && text) {
        if (!textByPage.has(pageIdx)) textByPage.set(pageIdx, []);
        textByPage.get(pageIdx)!.push({ text, idx: i });
      }
    }
  }

  // Figure caption pattern: matches "Fig. 1", "Figure 2", "图1", "图 2", etc.
  const figCaptionRe = /(?:Fig\.?\s*\d+|Figure\s*\d+|图\s*\d+)/i;

  // Extract image entries from content_list with metadata
  const imageEntries: Array<{
    imgPathInZip: string;
    pageIdx: number;
    bbox: number[];
    caption: string;
    figureLabel: string;
  }> = [];

  for (let i = 0; i < contentList.length; i++) {
    const item = contentList[i];
    if (item.type !== 'image') continue;

    const imgPath = String(item.img_path || '');
    if (!imgPath) continue;

    const pageIdx = typeof item.page_idx === 'number' ? item.page_idx : -1;
    const bbox = Array.isArray(item.bbox) ? (item.bbox as number[]) : [];

    // Filter: only keep images with a reasonable bbox size
    // bbox values are in 0-1000 normalized coordinates; real figures span >150 units
    const bboxW = bbox.length >= 4 ? bbox[2] - bbox[0] : 0;
    const bboxH = bbox.length >= 4 ? bbox[3] - bbox[1] : 0;
    if (bboxW < 120 || bboxH < 80) {
      console.log(`[PPT-V2/MinerU] Skipping small image on page ${pageIdx}: bbox=${bbox} (${bboxW}x${bboxH})`);
      continue;
    }

    // Try to find figure caption from nearby text on the same page
    // Best strategy: look for text that starts with "Fig." or "Figure" (likely a caption)
    // rather than text that merely mentions "Fig." in passing (likely a reference)
    let caption = '';
    let figureLabel = '';
    const pageTexts = textByPage.get(pageIdx) || [];

    // First pass: look for text that STARTS with a figure reference (most likely a caption)
    const captionStartRe = /^(?:Fig\.?\s*\d+|Figure\s*\d+|图\s*\d+)/i;
    for (const pt of pageTexts) {
      if (captionStartRe.test(pt.text.trim())) {
        const match = pt.text.match(figCaptionRe);
        if (match) {
          figureLabel = match[0];
          caption = pt.text.length > 200 ? pt.text.slice(0, 200) + '...' : pt.text;
          break;
        }
      }
    }

    // Second pass: if no caption found, look for text mentioning a figure near this image
    // Try to find one that appears AFTER this image in reading order
    if (!figureLabel) {
      const imgEntryIdx = i; // current index in content_list
      for (const pt of pageTexts) {
        if (pt.idx > imgEntryIdx) {
          const match = pt.text.match(figCaptionRe);
          if (match) {
            figureLabel = match[0];
            caption = pt.text.length > 200 ? pt.text.slice(0, 200) + '...' : pt.text;
            break;
          }
        }
      }
    }

    // Also check content_list captions
    const rawCaptions = Array.isArray(item.caption) ? item.caption : [];
    const rawCaptionText = rawCaptions.join(' ');
    if (rawCaptionText && !caption) {
      caption = rawCaptionText;
      const labelMatch = rawCaptionText.match(figCaptionRe);
      if (labelMatch) figureLabel = labelMatch[0];
    }

    imageEntries.push({ imgPathInZip: imgPath, pageIdx, bbox, caption, figureLabel });
  }

  console.log(`[PPT-V2/MinerU] Found ${imageEntries.length} valid figure entries from content_list`);

  // ── Save images and build figure results ──
  const figures: MinerUFigureInput[] = [];
  let figureCounter = 0;

  for (const entry of imageEntries) {
    const imgBasename = path.basename(entry.imgPathInZip);
    const matchingFile = Object.keys(zip.files).find(
      f => !zip.files[f].dir && (f === entry.imgPathInZip || f.endsWith('/' + imgBasename) || f.endsWith('\\' + imgBasename))
    );
    if (!matchingFile) {
      console.warn(`[PPT-V2/MinerU] Image file not found in ZIP: ${entry.imgPathInZip}`);
      continue;
    }

    const imgData = await zip.file(matchingFile)!.async('nodebuffer');
    const ext = path.extname(imgBasename).toLowerCase() || '.jpg';
    const savedName = `fig-${++figureCounter}${ext}`;
    await writeFileFs(path.join(figuresDir, savedName), imgData);

    figures.push({
      label: entry.figureLabel || `Fig.${figureCounter}`,
      caption: entry.caption,
      pageIdx: entry.pageIdx,
      bbox: entry.bbox,
      localPath: `mineru-figures/${paperId}/${savedName}`,
      imageUrl: `/mineru-figures/${paperId}/${savedName}`,
    });
  }

  // ── Fallback: if no figures from content_list, try ALL images in /images/ folder ──
  if (figures.length === 0) {
    console.log('[PPT-V2/MinerU] No figures from content_list, falling back to all /images/ files...');
    const allImageFiles = Object.keys(zip.files).filter(
      f => !zip.files[f].dir && (f.includes('/images/') || f.includes('\\images\\'))
    );
    for (const imgPath of allImageFiles) {
      const imgData = await zip.file(imgPath)!.async('nodebuffer');
      if (imgData.length < 10240) continue; // skip <10KB (likely icons/decorations)
      const ext = path.extname(imgPath).toLowerCase() || '.jpg';
      const savedName = `fig-${++figureCounter}${ext}`;
      await writeFileFs(path.join(figuresDir, savedName), imgData);

      figures.push({
        label: `Fig.${figureCounter}`,
        caption: '',
        pageIdx: -1,
        bbox: [],
        localPath: `mineru-figures/${paperId}/${savedName}`,
        imageUrl: `/mineru-figures/${paperId}/${savedName}`,
      });
    }
  }

  console.log(`[PPT-V2/MinerU] Extracted ${figures.length} figures total`);

  // Save metadata
  if (figures.length > 0) {
    const metaPath = path.join(figuresDir, '_metadata.json');
    await writeFileFs(metaPath, JSON.stringify(figures, null, 2));
  }

  return figures;
}


// ============================================================
// Helper: Find the best matching MinerU figure for a slide
// ============================================================
function findMinerUFigure(
  figures: MinerUFigureInput[],
  figureLabel: string | undefined,
  slideIndex: number,
): MinerUFigureInput | null {
  if (!figures || figures.length === 0) {
    console.log(`[PPT-V2] findMinerUFigure: no figures available`);
    return null;
  }

  // Strategy 1: Match by figureLabel (e.g. "Fig.1" → label "Fig.1")
  if (figureLabel) {
    const normalizedLabel = figureLabel.replace(/\s+/g, '').toLowerCase();
    const match = figures.find(f => f.label.replace(/\s+/g, '').toLowerCase() === normalizedLabel);
    if (match) {
      console.log(`[PPT-V2] findMinerUFigure: exact match "${figureLabel}" → ${match.label} (${match.localPath})`);
      return match;
    }

    // Try extracting number from label (e.g. "Fig.1" → 1, "Figure 3" → 3, "图 4" → 4)
    const labelNumMatch = figureLabel.match(/\d+/);
    if (labelNumMatch) {
      const labelNum = parseInt(labelNumMatch[0], 10);
      const matchByNum = figures.find(f => {
        const fNumMatch = f.label.match(/\d+/);
        return fNumMatch && parseInt(fNumMatch[0], 10) === labelNum;
      });
      if (matchByNum) {
        console.log(`[PPT-V2] findMinerUFigure: number match "${figureLabel}" → ${matchByNum.label} (${matchByNum.localPath})`);
        return matchByNum;
      }
    }

    // Try matching against caption text
    const captionMatch = figures.find(f =>
      f.caption.toLowerCase().includes(normalizedLabel) ||
      f.caption.toLowerCase().includes(figureLabel.toLowerCase())
    );
    if (captionMatch) {
      console.log(`[PPT-V2] findMinerUFigure: caption match "${figureLabel}" → ${captionMatch.label}`);
      return captionMatch;
    }

    console.log(`[PPT-V2] findMinerUFigure: no match for "${figureLabel}", available labels: [${figures.map(f => f.label).join(', ')}]`);
  }

  // Strategy 2: Use slideIndex to pick the corresponding figure
  if (slideIndex < figures.length) {
    console.log(`[PPT-V2] findMinerUFigure: falling back to index match, slideIndex=${slideIndex} → ${figures[slideIndex].label}`);
    return figures[slideIndex];
  }

  // Strategy 3: Return the last figure if available
  return figures[figures.length - 1] || null;
}

// Helper: Get just the localPath for a figure, or null
export function findMinerUFigurePath(
  figures: MinerUFigureInput[],
  figureLabel: string | undefined,
  slideIndex: number,
): string | null {
  const fig = findMinerUFigure(figures, figureLabel, slideIndex);
  return fig ? fig.localPath : null;
}
