import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Home from '../site/components/Home';
import type { HomeItem } from '../site/components/archive-display';

describe('homepage publication states independent of the live approval count', () => {
  it('keeps a deterministic honest empty state', () => {
    const html = renderToStaticMarkup(createElement(Home, { items: [], base: '/review/' }));
    expect(html).toContain('The archive is being prepared');
    expect(html).not.toContain('video-card-link');
  });
  it.each([true, false])('labels a fictional featured recording only when preview=%s', (preview) => {
    const item: HomeItem = {
      id: 'abcdefghijk', videoId: 'abcdefghijk', serviceId: 'fixture-service',
      title: 'Fictional state fixture', date: '2026-01-04', type: 'sermon',
      href: '/review/watch/?service=fixture-service&video=abcdefghijk',
      duration: 120, start: 0, preview,
    };
    const html = renderToStaticMarkup(createElement(Home, { items: [item], base: '/review/' }));
    expect(html).toContain(item.title);
    expect(html).not.toContain('The archive is being prepared');
    expect(html.includes('Unreviewed preview')).toBe(preview);
  });
});
