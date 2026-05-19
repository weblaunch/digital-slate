import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.weblaunchuk.digitalslate',
  appName: 'Digital Slate',
  webDir: 'www',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    CapacitorSQLite: {
      iosDatabaseLocation: 'Library/CapacitorDatabase',
      iosIsEncryption: false,
      androidIsEncryption: false
    },
    BluetoothLe: {
      displayStrings: {
        scanning: 'Scanning for Digital Slate',
        cancel: 'Cancel',
        availableDevices: 'Available slates',
        noDeviceFound: 'No Digital Slate found'
      }
    },
    SplashScreen: {
      launchShowDuration: 30000,
      launchAutoHide: false,
      backgroundColor: '#000000',
      showSpinner: false
    }
  }
};

export default config;
