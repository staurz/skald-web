// JWT-issuing OAuth2 server response shape (subset).
export type OAuth2AccessToken = {
  access_token: string;
  refresh_token: string;
  expires_in: number;       // seconds
  token_type: string;       // "bearer"
};

// /api/auth response shape.
export type ValidateUserResponse = {
  ErrorCode: number | null;
  Salt: string | null;       // base64-encoded
  UserId: string | null;
  Spas: AuthenticationSpa[];
};

export type AuthenticationSpa = {
  Id: string;                // UUID, lowercased when used in OAuth username
  NickName: string | null;
  IsConnected: boolean;
  IsMoved: boolean | null;
  DealerId: number | null;
};

// The unified spa state we expose to the SPA. Every field is optional
// until the corresponding MQTT topic delivers a payload.
export type SpaState = {
  ts: number;                          // last update timestamp (ms)
  temperatureF?: number;
  targetTemperatureF?: number;
  heating?: boolean;
  pumps?: { id: number; speed: 0 | 1 | 2 }[];
  blower?: boolean;
  lights?: boolean;
  errors?: string[];
  chemistry?: { ph?: number; chlorine?: number; orp?: number };
  filterCycle?: { active: boolean; nextStartTs?: number };
  rfidTag?: string;
};

export type AlertRule = {
  id: string;
  kind:
    | 'error_present'
    | 'temperature_outside'
    | 'filter_cycle_missed'
    | 'chemistry_outside';
  threshold: Record<string, number | string>;
  enabled: boolean;
};

export type RawMqttEvent = {
  ts: number;
  topic: string;
  payload: unknown;
};
