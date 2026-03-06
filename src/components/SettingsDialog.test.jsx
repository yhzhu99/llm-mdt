import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SettingsDialog from './SettingsDialog';

describe('SettingsDialog', () => {
  it('submits provider settings from the form', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <SettingsDialog
        isOpen
        settings={{
          baseUrl: 'https://example.com/chat/completions',
          apiKey: '',
          councilModels: ['openai/a'],
          chairmanModel: 'openai/a',
          titleModel: 'openai/a',
          extraHeaders: {},
        }}
        error=""
        onClose={vi.fn()}
        onSave={onSave}
        onClear={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText(/API key/i), {
      target: { value: 'secret-key' },
    });
    fireEvent.change(screen.getByLabelText(/Extra headers/i), {
      target: { value: 'X-Title: LLM MDT' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save settings/i }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'secret-key',
        extraHeaders: { 'X-Title': 'LLM MDT' },
      })
    );
  });
});
