import mqtt from 'mqtt';
import type { MqttClient, IClientOptions } from 'mqtt';
import type { RawMqttEvent } from './types';

// Legacy-tcp subscriptions, taken from MqttManager.java's MQTT_SUBSCRIPTION_TOPIC enum
// (entries where _isAWS == false). The broker's ACL rejects wildcards (SUBACK 128),
// so the topics must be enumerated explicitly.
export const LEGACY_TOPIC_TEMPLATES: readonly string[] = [
  'arctic/spa/%s/config/spa',
  'arctic/spa/%s/telemetry/spa',
  'arctic/spa/%s/telemetry/filters',
  'arctic/spa/%s/telemetry/rfid',
  'arctic/spa/%s/telemetry/errors',
  'arctic/spa/%s/telemetry/spaboy',
  'arctic/spa/%s/telemetry/heartbeat',
  'arctic/spa/%s/telemetry/update',
  'arctic/spa/%s/information/spa',
  'arctic/spa/%s/information/network',
  'arctic/spa/%s/settings/spa',
  'arctic/spa/%s/settings/spaboy',
  'arctic/spa/%s/settings/peak',
];

export function buildLegacyTopics(uuid: string): string[] {
  return LEGACY_TOPIC_TEMPLATES.map(t => t.replace('%s', uuid));
}

export type MqttPipelineOpts = {
  uuid: string;
  jwt?: string;
  url?: string;
  topics?: string[]; // override default legacy list
  connect?: (url: string, opts: IClientOptions) => MqttClient;
  onEvent: (e: RawMqttEvent) => void;
  onError?: (err: Error) => void;
};

export function createMqttPipeline(opts: MqttPipelineOpts) {
  const url = opts.url ?? 'tcp://broker.myarcticspa.com:1884';
  const connect = opts.connect ?? (mqtt.connect as unknown as (u: string, o: IClientOptions) => MqttClient);
  let client: MqttClient | null = null;

  function start() {
    client = connect(url, {
      username: opts.jwt ?? '',
      password: 'anything',
      reconnectPeriod: 2000,
      keepalive: 30,
      clean: true,
    });

    client.on('connect', () => {
      const topics = opts.topics ?? buildLegacyTopics(opts.uuid);
      client!.subscribe(topics, { qos: 0 }, (err: Error | null) => {
        if (err) opts.onError?.(err);
      });
    });

    client.on('message', (topic: string, payload: Buffer) => {
      const text = payload.toString('utf8');
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { parsed = text; }
      opts.onEvent({ ts: Date.now(), topic, payload: parsed });
    });

    client.on('error', (err: Error) => opts.onError?.(err));
  }

  function stop() {
    client?.end();
    client = null;
  }

  function setJwt(jwt: string) {
    opts.jwt = jwt;
    if (client) {
      stop();
      start();
    }
  }

  return { start, stop, setJwt };
}
