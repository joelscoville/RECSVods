import { describe, expect, it } from 'vitest';
import { matchShortcut, SHORTCUTS, specId, keyText } from '../site/lib/editor-keys';

const press = (key: string, extra: Partial<KeyboardEvent> = {}) => ({ key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...extra });

describe('chapter editor shortcuts', () => {
  it('binds every key to exactly one action', () => {
    const owners = new Map<string, string>();
    for (const shortcut of SHORTCUTS) for (const spec of shortcut.keys) {
      expect(owners.get(specId(spec)), `${specId(spec)} is bound twice`).toBeUndefined();
      owners.set(specId(spec), shortcut.action);
    }
  });
  it('tells plain, Shift and Cmd/Ctrl variants apart', () => {
    expect(matchShortcut(press('p'))).toBe('addSubchapter');
    expect(matchShortcut(press('k'))).toBe('addPoint');
    expect(matchShortcut(press('K', { shiftKey: true }))).toBeUndefined();
    expect(matchShortcut(press('m'))).toBe('mark');
    expect(matchShortcut(press('z', { ctrlKey: true }), false)).toBe('undo');
    expect(matchShortcut(press('Z', { ctrlKey: true, shiftKey: true }), false)).toBe('redo');
    expect(matchShortcut(press('ArrowLeft', { shiftKey: true }))).toBe('backMore');
  });
  it('leaves browser and system shortcuts alone', () => {
    expect(matchShortcut(press('ArrowLeft', { altKey: true }))).toBeUndefined();
    expect(matchShortcut(press('=', { ctrlKey: true }), false)).toBeUndefined();
    expect(matchShortcut(press('-', { metaKey: true }), true)).toBeUndefined();
    expect(matchShortcut(press('b', { ctrlKey: true }), true)).toBeUndefined();
    expect(matchShortcut(press('r', { metaKey: true }), true)).toBeUndefined();
  });
  it('names the modifier for this keyboard', () => {
    expect(keyText('Mod Shift Z', true)).toBe('Cmd Shift Z');
    expect(keyText('Mod Shift Z', false)).toBe('Ctrl Shift Z');
    expect(keyText('Redo (also Mod Y)', false)).toBe('Redo (also Ctrl Y)');
    expect(keyText('Modern', false)).toBe('Modern');
  });
});
