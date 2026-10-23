/**
 * Create poll: the question and answers, an emoji per answer from the emoji picker (picked
 * again replaces it, Remove emoji clears it), the duration (24 hours unless changed) and
 * Allow multiple answers all go to `onSend`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PollDialog } from './AttachDialogs';

vi.mock('@/features/conversation/lazy', () => ({
  LazyEmojiPicker: ({ onPick }: { onPick: (emoji: string) => void }) => (
    <button type="button" onClick={() => onPick('🎉')}>
      Party popper
    </button>
  ),
}));

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function open() {
  const onSend = vi.fn();
  render(<PollDialog open onClose={() => undefined} onSend={onSend} />);
  fireEvent.change(screen.getByLabelText('Question'), { target: { value: ' Lunch? ' } });
  fireEvent.change(screen.getByLabelText('Option 1'), { target: { value: 'Pizza' } });
  fireEvent.change(screen.getByLabelText('Option 2'), { target: { value: 'Sushi' } });
  return onSend;
}

describe('PollDialog', () => {
  it('sends the question and answers with the default duration of 24 hours', () => {
    const onSend = open();
    const duration = screen.getByLabelText('Duration');
    expect(duration).toHaveValue('24');
    expect(Array.from((duration as HTMLSelectElement).options, (o) => o.textContent)).toEqual([
      '1 hour',
      '4 hours',
      '8 hours',
      '24 hours',
      '3 days',
      '1 week',
      '2 weeks',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Send poll' }));
    expect(onSend).toHaveBeenCalledWith({
      question: 'Lunch?',
      options: ['Pizza', 'Sushi'],
      allowMultiple: false,
      durationHours: 24,
    });
  });

  it('sends an emoji per answer, the picked duration and multiple answers', () => {
    const onSend = open();
    fireEvent.click(screen.getByRole('button', { name: 'Add an emoji to answer 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Party popper' }));
    expect(screen.getByRole('button', { name: 'Answer 2 emoji' })).toHaveTextContent('🎉');
    // The first answer's emoji, picked then removed again.
    fireEvent.click(screen.getByRole('button', { name: 'Add an emoji to answer 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Party popper' }));
    fireEvent.click(screen.getByRole('button', { name: 'Answer 1 emoji' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove emoji' }));
    expect(screen.getByRole('button', { name: 'Add an emoji to answer 1' })).toBeInTheDocument();
    // An emoji on the empty last slot is not an answer.
    fireEvent.click(screen.getByRole('button', { name: 'Add an emoji to answer 3' }));
    fireEvent.click(screen.getByRole('button', { name: 'Party popper' }));

    fireEvent.change(screen.getByLabelText('Duration'), { target: { value: '168' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Allow multiple answers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send poll' }));
    expect(onSend).toHaveBeenCalledWith({
      question: 'Lunch?',
      options: ['Pizza', 'Sushi'],
      allowMultiple: true,
      durationHours: 168,
      emojis: [null, '🎉'],
    });
  });
});
