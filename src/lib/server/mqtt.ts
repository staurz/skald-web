import mqtt from 'mqtt';
import type { MqttClient, IClientOptions } from 'mqtt';
import type { RawMqttEvent } from './types';

export type MqttPipelineOpts = {
  uuid: string;
  jwt?: string;
  url?: string;
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
      const topic = `arctic/spa/${opts.uuid}/#`;
      client!.subscribe(topic, { qos: 0 }, (err: Error | null) => {
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
