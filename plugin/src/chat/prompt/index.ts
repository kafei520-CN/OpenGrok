import { plat } from '../../core/platform';
import type { Attachment, ContentBlock } from '../../core/types';
import { prepareVisionImage, VISION_HINT } from './visionPrep';

export async function buildPromptBlocks(
  text: string,
  attachments: Attachment[],
): Promise<ContentBlock[]> {
  const blocks: ContentBlock[] = [];
  const notes: string[] = [];
  let sawImage = false;
  if (text.trim()) {
    blocks.push({ type: 'text', text });
  }
  const selection = plat().getActiveSelection();
  if (plat().getConfig('includeSelectionOnSend', true) && selection) {
    blocks.push({
      type: 'resource',
      resource: {
        uri: `file://${selection.path}`,
        mimeType: 'text/plain',
        text: `Selection from ${selection.path}:\n${selection.text}`,
      },
    });
  }
  for (const attachment of attachments) {
    if (attachment.mimeType?.startsWith('image/') && attachment.data) {
      sawImage = true;
      const prepared = await prepareVisionImage({
        mimeType: attachment.mimeType,
        data: attachment.data,
      });
      for (const image of prepared.images) {
        blocks.push({ type: 'image', mimeType: image.mimeType, data: image.data });
      }
      if (prepared.note) {
        notes.push(prepared.note);
      }
      continue;
    }
    const mime = attachment.mimeType ?? (attachment.path ? undefined : 'text/plain');
    blocks.push({
      type: 'resource',
      mimeType: mime,
      data: attachment.data,
      name: attachment.label,
      path: attachment.path,
      resource: {
        uri: attachment.path ? `file://${attachment.path}` : `attachment:${attachment.id}`,
        mimeType: mime ?? 'application/octet-stream',
        text: attachment.text ?? attachment.label,
      },
    });
  }
  if (notes.length) {
    blocks.push({ type: 'text', text: notes.join('\n\n') });
  }
  if (!text.trim() && sawImage) {
    blocks.unshift({ type: 'text', text: VISION_HINT });
  }
  if (blocks.length === 0) {
    blocks.push({ type: 'text', text: text || '(attachment)' });
  }
  return blocks;
}
