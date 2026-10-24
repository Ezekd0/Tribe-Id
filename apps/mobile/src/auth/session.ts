import * as SecureStore from 'expo-secure-store';
import { SessionCore } from './session-core';
import { mobileEnvironment } from '../api/environment';
export class MobileSession extends SessionCore {
  constructor(baseUrl: string) {
    const config = mobileEnvironment(baseUrl, process.env.EXPO_PUBLIC_APP_ENV, __DEV__);
    const key = config.storageKey;
    super(config.baseUrl, {
      read: () => SecureStore.getItemAsync(key),
      write: token => SecureStore.setItemAsync(key, token, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
      remove: () => SecureStore.deleteItemAsync(key),
    });
  }
}
