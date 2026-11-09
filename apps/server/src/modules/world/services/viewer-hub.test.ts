import { expect, it, vi } from 'vitest';
import { ViewerHub, type ViewerEdit } from './viewer-hub';

const edit: ViewerEdit = { x: 1, y: 2, z: 3, material: 'stone', revision: 4 };

it('fans out edits to subscribers until they unsubscribe', () => {
  const hub = new ViewerHub();
  const a = vi.fn();
  const b = vi.fn();
  const offA = hub.subscribe(a)!;
  hub.subscribe(b);
  hub.publish(edit);
  offA();
  hub.publish({ ...edit, revision: 5 });
  expect(a).toHaveBeenCalledExactlyOnceWith(edit);
  expect(b).toHaveBeenCalledTimes(2);
  expect(hub.size).toBe(1);
});

it('refuses subscribers past the cap', () => {
  const hub = new ViewerHub(2);
  expect(hub.subscribe(vi.fn())).toBeTypeOf('function');
  expect(hub.subscribe(vi.fn())).toBeTypeOf('function');
  expect(hub.subscribe(vi.fn())).toBeUndefined();
  expect(hub.size).toBe(2);
});

it('drops a throwing viewer without affecting the others', () => {
  const hub = new ViewerHub();
  const good = vi.fn();
  hub.subscribe(() => {
    throw new Error('closed socket');
  });
  hub.subscribe(good);
  hub.publish(edit);
  hub.publish(edit);
  expect(good).toHaveBeenCalledTimes(2);
  expect(hub.size).toBe(1);
});
