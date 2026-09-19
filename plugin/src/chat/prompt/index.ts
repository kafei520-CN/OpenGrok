import { plat } from '../../core/platform';
import type { Attachment, ContentBlock } from '../../core/types';

export async function buildPromptBlocks(
  text: string,
  attachments: Attachment[],
): Promise<ContentBlock[]> {
  const blocks: ContentBlock[] = [];
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
      blocks.push({
        type: 'image',
        mimeType: attachment.mimeType,
        data: attachment.data,
      });
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
  if (blocks.length === 0) {
    blocks.push({ type: 'text', text: text || '(attachment)' });
  }
  return blocks;
}
