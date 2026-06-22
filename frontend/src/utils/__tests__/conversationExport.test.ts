import { describe, it, expect } from 'vitest';
import { conversationToMarkdown } from '../conversationExport';
import type { ChatMessage, Mode } from '../../types';

describe('conversationToMarkdown', () => {
  it('renders a markdown document with messages', () => {
    const messages: ChatMessage[] = [
      { id: '1', role: 'user', content: 'What is Azure?' },
      { id: '2', role: 'assistant', content: 'Azure is Microsoft cloud platform.' },
    ];
    const md = conversationToMarkdown('Test conversation', 'qa' as Mode, messages, Date.now());
    expect(md).toContain('# Test conversation');
    expect(md).toContain('**Mode:** Expert Q&A');
    expect(md).toContain('### You');
    expect(md).toContain('What is Azure?');
    expect(md).toContain('### Assistant');
    expect(md).toContain('Azure is Microsoft cloud platform.');
    expect(md).toContain('Exported from Azure Architect AI');
  });

  it('includes citations when present', () => {
    const messages: ChatMessage[] = [
      {
        id: '1',
        role: 'assistant',
        content: 'See docs.',
        citations: [{ title: 'Azure Docs', url: 'https://docs.microsoft.com', description: 'Docs' }],
      },
    ];
    const md = conversationToMarkdown('Citations test', 'qa' as Mode, messages);
    expect(md).toContain('**Citations:**');
    expect(md).toContain('[Azure Docs](https://docs.microsoft.com)');
  });

  it('handles empty messages', () => {
    const md = conversationToMarkdown('Empty', 'qa' as Mode, []);
    expect(md).toContain('# Empty');
    expect(md).toContain('**Messages:** 0');
  });
});
