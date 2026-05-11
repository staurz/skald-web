// Real MQTT payloads captured from a live legacy-tcp spa
// (c37a0401-…/2026-05-11). Use as the source of truth for payload shapes.

export const TELEMETRY_SPA = {
  tempF: 99,
  tempSetPointF: 99,
  pump1: 1, pump2: 0, pump3: 0, pump4: 0, pump5: 0,
  blower1: 0, blower2: 0,
  lights: false,
  fogger: false,
  stereo: false,
  heater1: 0, heater2: 0,
  filter: 2,
  onzen: false,
  ozone: 0,
  exhaust: false,
  sauna: 0,
  heaterADC: 725,
  economy: false,
  currentADC: 1643,
  allOn: false,
};

export const TELEMETRY_SPABOY = {
  guid: '0d014027-aeac-88e1-5540-210ef5001940',
  orp: 587,
  ph: 767,            // centi-pH (7.67)
  current: 4,
  voltage: 8,
  currentSetpoint: 2400,
  voltageSetpoint: 13000,
  pump1: true,
  pump2: false,
  orpState: 1,
  eState: 8,
  eID: 0,
  ePolarity: 1,
  e1R1: 1622, e1R2: 1620, e2R1: 9999999, e2R2: 9999999,
  commandMode: false,
  emAh: 324538,
  eWear: 75,
  phColor: 2,
  orpColor: 2,
};

export const TELEMETRY_ERRORS = {
  version: 0,
  noFlow: false,
  flowSwitch: false,
  heaterOverTemperature: false,
  spaOverTemperature: false,
  spaTemperatureProbe: false,
  spaHighLimit: false,
  eeprom: false,
  freezeProtect: false,
  phHigh: false,
  hd: false,
  hpt: false,
  other: 0,
  spaboyComm: false,
};

export const TELEMETRY_ERRORS_ACTIVE = {
  ...TELEMETRY_ERRORS,
  noFlow: true,
  heaterOverTemperature: true,
};
