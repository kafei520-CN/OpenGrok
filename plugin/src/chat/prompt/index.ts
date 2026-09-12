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
    blocks.push({
      type: 'resource',
      resource: {
        uri: attachment.path ? `file://${attachment.path}` : `attachment:${attachment.id}`,
        mimeType: attachment.mimeType ?? 'text/plain',
        text: attachment.text ?? attachment.label,
      },
    });
  }
  if (blocks.length === 0) {
    blocks.push({ type: 'text', text: text || '(attachment)' });
  }
  return blocks;
}
