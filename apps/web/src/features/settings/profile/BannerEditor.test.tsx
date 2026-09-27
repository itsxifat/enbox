import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useAuth } from '@/stores/auth';
import { makeMe } from '@/test/factories';
import { BannerEditor } from './BannerEditor';

beforeEach(() => {
  useAuth.setState({ user: makeMe(), token: 't', status: 'authenticated' });
});

describe('BannerEditor', () => {
  it('offers to add a banner when there is none', () => {
    render(<BannerEditor />);
    expect(screen.getByRole('button', { name: 'Add banner' })).not.toHaveAttribute('aria-haspopup');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('shows the poster and a view / upload / remove menu when there is one', () => {
    useAuth.setState({
      user: makeMe({
        bannerUrl: '/uploads/banner.webp',
        bannerAnimatedUrl: '/uploads/banner.gif',
      }),
    });
    const { container } = render(<BannerEditor />);
    expect(container.querySelector('img')).toHaveAttribute('src', '/uploads/banner.webp');
    fireEvent.click(screen.getByRole('button', { name: 'Change banner' }));
    expect(screen.getByRole('menuitem', { name: 'View banner' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Upload new banner' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Remove banner' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'View banner' }));
    // The lightbox plays the animated original (jsdom reports no reduced motion).
    const viewer = screen.getByRole('dialog', { name: /banner$/ });
    expect(viewer.querySelector('img')).toHaveAttribute('src', '/uploads/banner.gif');
  });

  it('rejects files that are not images before opening the crop dialog', () => {
    render(<BannerEditor />);
    const input = screen.getByTestId('banner-file-input');
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] },
    });
    expect(screen.queryByRole('dialog', { name: 'Crop your banner' })).toBeNull();
  });
});
