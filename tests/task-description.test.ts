import { describe, expect, it } from 'vitest';
import { parseTaskDescription, taskDescriptionFieldsFromText, taskDescriptionFromFields } from '../src/lib/util/task-description';

describe('taskDescriptionFromFields', () => {
  it('returns null when all fields are blank', () => {
    expect(taskDescriptionFromFields({ hva: ' ', hvorfor: '', hvordan: '' })).toBeNull();
  });

  it('builds labelled lines and normalises internal line breaks', () => {
    expect(
      taskDescriptionFromFields({
        hva: 'Rens filter',
        hvorfor: 'Bedre flyt',
        hvordan: 'Skyll godt\nog sett det tilbake',
      }),
    ).toBe('Hva: Rens filter\nHvorfor: Bedre flyt\nHvordan: Skyll godt og sett det tilbake');
  });
});

describe('taskDescriptionFieldsFromText', () => {
  it('extracts labelled task description fields for editing', () => {
    expect(
      taskDescriptionFieldsFromText('Hva: Rens filter\nHvorfor: Bedre flyt\nHvordan: Skyll godt'),
    ).toEqual({
      hva: 'Rens filter',
      hvorfor: 'Bedre flyt',
      hvordan: 'Skyll godt',
    });
  });

  it('falls back to Hva for older free-text descriptions', () => {
    expect(taskDescriptionFieldsFromText('Rens filter og sjekk pakning')).toEqual({
      hva: 'Rens filter og sjekk pakning',
      hvorfor: '',
      hvordan: '',
    });
  });
});

describe('parseTaskDescription', () => {
  it('preserves unlabeled lines for display alongside labelled ones', () => {
    expect(parseTaskDescription('Ekstra info\nHva: Rens filter')).toEqual([
      { label: '', text: 'Ekstra info' },
      { label: 'Hva', text: 'Rens filter' },
    ]);
  });

  it('does not treat inherited object keys as recognised labels', () => {
    expect(parseTaskDescription('toString: nope')).toEqual([{ label: '', text: 'toString: nope' }]);
  });
});
