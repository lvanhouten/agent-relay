import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinChildPath } from './pickerPath.ts';

test('joins a child onto a normal path with a forward slash', () => {
  assert.equal(joinChildPath('/home/user', 'dev'), '/home/user/dev');
  assert.equal(joinChildPath('C:\\Users\\Lukas', 'dev'), 'C:\\Users\\Lukas/dev');
});

test('strips a trailing separator so a root does not double it', () => {
  assert.equal(joinChildPath('C:\\', 'Users'), 'C:/Users');
  assert.equal(joinChildPath('/', 'home'), '/home');
  assert.equal(joinChildPath('/home/', 'user'), '/home/user');
});

test('collapses multiple trailing separators', () => {
  assert.equal(joinChildPath('/home///', 'user'), '/home/user');
});
