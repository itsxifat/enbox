import * as Device from 'expo-device';
import { Platform } from 'react-native';

/** Human device name for the linked-devices list, e.g. "Enbox for Android (Pixel 8)". */
export function deviceName() {
  if (Platform.OS === 'web') return 'Enbox app preview';
  const os = Platform.OS === 'android' ? 'Android' : Platform.OS === 'ios' ? 'iOS' : 'Mobile';
  const model = Device.modelName || Device.deviceName;
  return model ? `Enbox for ${os} (${model})` : `Enbox for ${os}`;
}
