import { describe, it, expect, beforeEach } from 'vitest';
import { incCounter, renderMetrics, resetMetricsForTest } from './metrics';

describe('metrics', () => {
  beforeEach(() => resetMetricsForTest());

  it('renders a labelless counter with a single TYPE header', () => {
    incCounter('bbk_rooms_created_total');
    incCounter('bbk_rooms_created_total');
    expect(renderMetrics()).toBe(
      '# TYPE bbk_rooms_created_total counter\nbbk_rooms_created_total 2\n',
    );
  });

  it('keeps one series per label value and one TYPE header per name', () => {
    incCounter('bbk_rounds_started_total', { game: 'marble' });
    incCounter('bbk_rounds_started_total', { game: 'marble' });
    incCounter('bbk_rounds_started_total', { game: 'trivia' });
    const out = renderMetrics();
    expect(out.match(/# TYPE bbk_rounds_started_total counter/g)).toHaveLength(1);
    expect(out).toContain('bbk_rounds_started_total{game="marble"} 2');
    expect(out).toContain('bbk_rounds_started_total{game="trivia"} 1');
  });

  it('strips characters that would break the Prometheus exposition format', () => {
    incCounter('bbk_rounds_started_total', { game: 'a"b\\c\nd' });
    expect(renderMetrics()).toContain('bbk_rounds_started_total{game="abcd"} 1');
  });
});
