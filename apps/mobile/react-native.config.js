// Only an explicitly SMS-enabled consumer build needs Firebase Phone Auth.
// Config plugins alone do not prevent installed RN packages from autolinking.
const phoneAuthEnabled = process.env.EXPO_PUBLIC_APP_VARIANT !== 'staff'
  && process.env.EXPO_PUBLIC_CONSUMER_PHONE_AUTH_ENABLED === 'true';
module.exports = {
  dependencies: !phoneAuthEnabled ? {
    '@react-native-firebase/app': { platforms: { android: null, ios: null } },
    '@react-native-firebase/auth': { platforms: { android: null, ios: null } },
  } : {},
};
