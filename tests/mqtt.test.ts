import { describe, it, expect } from 'vitest';
import { createMqttPipeline, buildLegacyTopics } from '../src/lib/server/mqtt';
import type { RawMqttEvent } from '../src/lib/server/types';

class FakeClient {
  handlers: Record<string, ((...a: any[]) => void)[]> = {};
  subscribed: string[] = [];
  ended = false;
  on(event: string, cb: (...a: any[]) => void) { (this.handlers[event] ??= []).push(cb); return this; }
  subscribe(topics: string | string[], _opts: unknown, cb: (err: Error | null) => void) {
    if (Array.isArray(topics)) this.subscribed.push(...topics);
    else this.subscribed.push(topics);
    cb(null);
  }
  emit(event: string, ...args: any[]) { (this.handlers[event] ?? []).forEach(h => h(...args)); }
  end() { this.ended = true; }
}

describe('createMqttPipeline', () => {
  it('subscribes to the legacy explicit topic list and parses incoming JSON messages', () => {
    const fake = new FakeClient();
    const events: RawMqttEvent[] = [];
    const pipe = createMqttPipeline({
      uuid: 'abc-uuid',
      connect: () => fake as any,
      onEvent: (e: RawMqttEvent) => events.push(e),
    });
    pipe.start();
    fake.emit('connect');
    expect(fake.subscribed).toEqual(buildLegacyTopics('abc-uuid'));
    expect(fake.subscribed).toContain('arctic/spa/abc-uuid/telemetry/spa');
    expect(fake.subscribed).toContain('arctic/spa/abc-uuid/telemetry/spaboy');
    expect(fake.subscribed.some(t => t.includes('#'))).toBe(false);

    fake.emit('message', 'arctic/spa/abc-uuid/telemetry/spa', Buffer.from(JSON.stringify({ temperatureF: 102 })));
    expect(events).toHaveLength(1);
    expect(events[0].topic).toBe('arctic/spa/abc-uuid/telemetry/spa');
    expect((events[0].payload as any).temperatureF).toBe(102);
    expect(typeof events[0].ts).toBe('number');
  });

  it('accepts an explicit topics override', () => {
    const fake = new FakeClient();
    const pipe = createMqttPipeline({
      uuid: 'abc-uuid',
      topics: ['custom/one', 'custom/two'],
      connect: () => fake as any,
      onEvent: () => {},
    });
    pipe.start();
    fake.emit('connect');
    expect(fake.subscribed).toEqual(['custom/one', 'custom/two']);
  });

  it('still forwards non-JSON payloads as raw strings', () => {
    const fake = new FakeClient();
    const events: RawMqttEvent[] = [];
    const pipe = createMqttPipeline({ uuid: 'u', connect: () => fake as any, onEvent: (e: RawMqttEvent) => events.push(e) });
    pipe.start();
    fake.emit('connect');
    fake.emit('message', 'arctic/spa/u/telemetry/heartbeat', Buffer.from('PING'));
    expect(events[0].payload).toBe('PING');
  });

  it('forwards errors to onError', () => {
    const fake = new FakeClient();
    const errors: Error[] = [];
    const pipe = createMqttPipeline({
      uuid: 'u',
      connect: () => fake as any,
      onEvent: () => {},
      onError: (e: Error) => errors.push(e),
    });
    pipe.start();
    fake.emit('error', new Error('boom'));
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('boom');
  });

  it('stop() ends the client', () => {
    const fake = new FakeClient();
    const pipe = createMqttPipeline({ uuid: 'u', connect: () => fake as any, onEvent: () => {} });
    pipe.start();
    pipe.stop();
    expect(fake.ended).toBe(true);
  });

  it('setJwt reconnects the client with the new credentials', () => {
    const fakes: FakeClient[] = [];
    const pipe = createMqttPipeline({
      uuid: 'u',
      connect: () => {
        const f = new FakeClient();
        fakes.push(f);
        return f as any;
      },
      onEvent: () => {},
    });
    pipe.start();
    expect(fakes).toHaveLength(1);
    pipe.setJwt('new-jwt');
    expect(fakes[0].ended).toBe(true);
    expect(fakes).toHaveLength(2);
  });
});
