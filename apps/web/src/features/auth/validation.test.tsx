import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PasswordStrengthMeter } from './PasswordStrengthMeter';
import { welcomePath } from './RegisterPage';
import {
  canonicalPhone,
  normalizeUsernameInput,
  passwordStrength,
  usernameIssue,
} from './validation';

describe('passwordStrength', () => {
  it('rates passwords from too short to strong', () => {
    expect(passwordStrength('')).toEqual({ score: 0, label: '' });
    expect(passwordStrength('abc12')).toEqual({ score: 0, label: 'Too short' });
    expect(passwordStrength('password123').label).toBe('Too common');
    expect(passwordStrength('aaaaaaaaaa').label).toBe('Too common');
    expect(passwordStrength('abcdefgz').score).toBe(1);
    expect(passwordStrength('abcdefg1').score).toBe(2);
    expect(passwordStrength('abcdefG1').score).toBe(3);
    expect(passwordStrength('correct horse 42').label).toBe('Strong');
  });

  it('renders a labelled meter', () => {
    render(<PasswordStrengthMeter password="abcdefG1" />);
    expect(screen.getByText('Good')).toBeInTheDocument();
  });
});

describe('username helpers', () => {
  it('normalises typed input', () => {
    expect(normalizeUsernameInput('@Jamie Lee')).toBe('jamielee');
    expect(normalizeUsernameInput('@@ada_.')).toBe('ada_.');
  });

  it('reports the shared schema messages', () => {
    expect(usernameIssue('')).toBeNull();
    expect(usernameIssue('ada.l')).toBeNull();
    expect(usernameIssue('ab')).toMatch(/3–32/);
    expect(usernameIssue('12345')).toMatch(/at least one letter/);
    expect(usernameIssue('deleted_abc')).toMatch(/reserved/);
  });
});

describe('canonicalPhone', () => {
  it('canonicalises to E.164 or returns null', () => {
    expect(canonicalPhone('+1 (555) 123-4567')).toBe('+15551234567');
    expect(canonicalPhone('0044 20 7946 0958')).toBe('+442079460958');
    expect(canonicalPhone('12')).toBeNull();
    expect(canonicalPhone('   ')).toBeNull();
  });
});

describe('welcomePath', () => {
  it('keeps a safe next target and drops unsafe ones', () => {
    expect(welcomePath(null)).toBe('/welcome');
    expect(welcomePath('/join/abc')).toBe('/welcome?next=%2Fjoin%2Fabc');
    expect(welcomePath('//evil.example')).toBe('/welcome');
    expect(welcomePath('/login')).toBe('/welcome');
  });
});
