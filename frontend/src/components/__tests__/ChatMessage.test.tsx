import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import ChatMessage from '../ChatMessage';
import type { ChatMessage as ChatMessageType } from '../../types';

function wrap(node: React.ReactNode) {
  return <FluentProvider theme={webLightTheme}>{node}</FluentProvider>;
}

describe('ChatMessage', () => {
  it('renders plain text from a user message', () => {
    const msg: ChatMessageType = { id: '1', role: 'user', content: 'hello' };
    render(wrap(<ChatMessage message={msg} />));
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('renders a markdown table from an assistant message into a <table>', () => {
    const markdownTable = '| a | b |\n|---|---|\n| 1 | 2 |\n';
    const msg: ChatMessageType = {
      id: '2',
      role: 'assistant',
      content: markdownTable,
    };
    const { container } = render(wrap(<ChatMessage message={msg} />));
    const table = container.querySelector('table');
    expect(table).toBeTruthy();
  });
});
