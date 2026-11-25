// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactActRoot, createElement } from 'react';
import { createRoot } from 'react-dom/client';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { Onboarding } = await import('../src/renderer/src/Onboarding');

let root: ReturnType<typeof createRoot> | null = null;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
});

async function renderOnboarding(onDone: () => Promise<boolean>) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    (root as unknown as ReactActRoot).render(createElement(Onboarding, { open: true, onDone }));
  });
  return container;
}

const done = () => vi.fn(async () => true);

describe('Onboarding', () => {
  it('renders a single welcome slide', async () => {
    const container = await renderOnboarding(done());

    expect(container.textContent).toContain('欢迎使用 OneDesk');
    expect(container.textContent).toContain('AI 深度融入每个环节');
    const next = container.querySelector<HTMLButtonElement>('.onb-next');
    expect(next?.textContent).toBe('开始使用');
    // The old multi-slide chrome is gone: no skip button, no consent switch,
    // no credit links, no step counter.
    expect(container.querySelector('.onb-skip')).toBeNull();
    expect(container.querySelector('[role="switch"]')).toBeNull();
    expect(container.querySelectorAll('a[target="_blank"]')).toHaveLength(0);
    expect(container.textContent).not.toMatch(/Step \d+ of \d+/);
  });

  it('calls onDone when Get started is clicked', async () => {
    const onDone = done();
    const container = await renderOnboarding(onDone);

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.onb-next')?.click();
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('calls onDone when Enter is pressed outside a button', async () => {
    const onDone = done();
    await renderOnboarding(onDone);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('does not double-fire when Enter is pressed while the button has focus', async () => {
    const onDone = done();
    const container = await renderOnboarding(onDone);
    const next = container.querySelector<HTMLButtonElement>('.onb-next');
    next?.focus();

    await act(async () => {
      next?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    // the keydown path is ignored; the native click activation covers Enter
    expect(onDone).not.toHaveBeenCalled();
  });

  it('calls onDone when Escape is pressed', async () => {
    const onDone = done();
    await renderOnboarding(onDone);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('traps Tab focus inside the single-slide dialog', async () => {
    const container = await renderOnboarding(done());
    const focusables = Array.from(container.querySelectorAll<HTMLElement>('.onb-card button'));
    expect(focusables).toHaveLength(1);
    const next = focusables[0];

    // the card holds focus on open; Tab must land on the dialog's control
    const card = container.querySelector<HTMLElement>('.onb-card');
    card?.focus();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });
    expect(document.activeElement).toBe(next);

    // from the only control, Tab wraps back onto it
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });
    expect(document.activeElement).toBe(next);
  });
});
