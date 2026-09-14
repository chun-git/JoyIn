import { describe, expect, it } from 'vitest';
import {
  formatFeeLabel,
  parseFeeAmount,
  parseGoogleMapsUrl,
  withOpenExternalBrowser,
} from '../../shared/event-fields';

describe('event field validation', () => {
  it('accepts empty maps URL as null and known Google Maps hosts', () => {
    expect(parseGoogleMapsUrl('')).toEqual({ ok: true, value: null });
    expect(parseGoogleMapsUrl(null)).toEqual({ ok: true, value: null });
    expect(parseGoogleMapsUrl('https://maps.app.goo.gl/abc123')).toEqual({
      ok: true,
      value: 'https://maps.app.goo.gl/abc123',
    });
    expect(parseGoogleMapsUrl('https://www.google.com/maps/place/Taipei').ok).toBe(true);
    expect(parseGoogleMapsUrl('https://google.com/maps?q=台北').ok).toBe(true);
  });

  it('rejects non-https and non-maps URLs', () => {
    expect(parseGoogleMapsUrl('http://maps.app.goo.gl/abc').ok).toBe(false);
    expect(parseGoogleMapsUrl('https://example.com/maps').ok).toBe(false);
    expect(parseGoogleMapsUrl('https://google.com/search').ok).toBe(false);
  });

  it('accepts free/paid integers and rejects invalid fees', () => {
    expect(parseFeeAmount(0)).toEqual({ ok: true, value: 0 });
    expect(parseFeeAmount('150')).toEqual({ ok: true, value: 150 });
    expect(parseFeeAmount(-1).ok).toBe(false);
    expect(parseFeeAmount(1.5).ok).toBe(false);
    expect(parseFeeAmount('1.5').ok).toBe(false);
    expect(parseFeeAmount('abc').ok).toBe(false);
  });

  it('formats fee labels and appends openExternalBrowser', () => {
    expect(formatFeeLabel(0)).toBe('免費');
    expect(formatFeeLabel(150)).toBe('150 元／人');
    expect(withOpenExternalBrowser('https://maps.app.goo.gl/abc')).toContain('openExternalBrowser=1');
  });
});
