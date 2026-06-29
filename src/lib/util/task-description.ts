export type TaskDescriptionLabel = 'Hva' | 'Hvorfor' | 'Hvordan';

export interface TaskDescriptionPart {
  label: TaskDescriptionLabel | '';
  text: string;
}

export interface TaskDescriptionFields {
  hva: string;
  hvorfor: string;
  hvordan: string;
}

const LABEL_TO_FIELD = {
  Hva: 'hva',
  Hvorfor: 'hvorfor',
  Hvordan: 'hvordan',
} as const satisfies Record<TaskDescriptionLabel, keyof TaskDescriptionFields>;

function normaliseField(value: string): string {
  return value.trim().replace(/\s*\r?\n\s*/g, ' ');
}

export function parseTaskDescription(description: string | null): TaskDescriptionPart[] {
  if (!description) return [];

  return description
    .split(/\r?\n/)
    .map((rawLine) => rawLine.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(':');
      const label = separator > 0 ? line.slice(0, separator).trim() : '';
      if (Object.prototype.hasOwnProperty.call(LABEL_TO_FIELD, label)) {
        return { label: label as TaskDescriptionLabel, text: line.slice(separator + 1).trim() };
      }
      return { label: '', text: line };
    });
}

export function taskDescriptionFieldsFromText(description: string | null): TaskDescriptionFields {
  const fields: TaskDescriptionFields = { hva: '', hvorfor: '', hvordan: '' };

  for (const part of parseTaskDescription(description)) {
    const field = part.label ? LABEL_TO_FIELD[part.label] : 'hva';
    fields[field] = fields[field] ? `${fields[field]} ${part.text}`.trim() : part.text;
  }

  return fields;
}

export function taskDescriptionFromFields(fields: TaskDescriptionFields): string | null {
  const lines = [
    ['Hva', normaliseField(fields.hva)],
    ['Hvorfor', normaliseField(fields.hvorfor)],
    ['Hvordan', normaliseField(fields.hvordan)],
  ]
    .filter(([, text]) => text)
    .map(([label, text]) => `${label}: ${text}`);

  return lines.length > 0 ? lines.join('\n') : null;
}
