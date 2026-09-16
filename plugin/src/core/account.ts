import { createHash } from 'node:crypto';
import type { AccountInfo } from './types';
import { asObject, asString } from './wire';

const AVATAR_KEYS = [
  'avatar',
  'avatarUrl',
  'avatar_url',
  'avatarURL',
  'picture',
  'pictureUrl',
  'picture_url',
  'photo',
  'photoUrl',
  'photo_url',
  'image',
  'imageUrl',
  'image_url',
  'profileImage',
  'profile_image',
  'profileImageUrl',
  'profile_image_url',
];

export function pickAvatarUrl(...bags: Array<Record<string, unknown> | undefined>): string | undefined {
  for (const bag of bags) {
    if (!bag) {
      continue;
    }
    for (const key of AVATAR_KEYS) {
      const value = asString(bag[key])?.trim();
      if (value && /^(https?:\/\/|data:image\/)/i.test(value)) {
        return value;
      }
    }
  }
  return undefined;
}

export function gravatarUrl(email?: string): string | undefined {
  const trimmed = email?.trim().toLowerCase();
  if (!trimmed || !trimmed.includes('@')) {
    return undefined;
  }
  const hash = createHash('sha256').update(trimmed).digest('hex');
  return `https://www.gravatar.com/avatar/${hash}?s=96&d=404`;
}

export function parseAccountInfo(raw: unknown): AccountInfo {
  const value = asObject(raw);
  const user = asObject(value['user']);
  const profile = asObject(value['profile']);
  const identity = asObject(value['identity']);
  const email =
    asString(value['email']) ??
    asString(user['email']) ??
    asString(profile['email']) ??
    asString(identity['email']);
  return {
    email,
    firstName:
      asString(value['firstName']) ??
      asString(value['first_name']) ??
      asString(user['firstName']) ??
      asString(user['first_name']),
    lastName:
      asString(value['lastName']) ??
      asString(value['last_name']) ??
      asString(user['lastName']) ??
      asString(user['last_name']),
    methodId: asString(value['methodId']) ?? asString(value['method_id']),
    avatarUrl:
      pickAvatarUrl(value, user, profile, identity) ?? gravatarUrl(email),
  };
}
