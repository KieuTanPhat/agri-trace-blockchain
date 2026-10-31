// Staff authenticates with the AgriTrace API, not Firebase Phone Auth.
// Config plugins alone do not prevent installed RN packages from autolinking.
const staff = process.env.EXPO_PUBLIC_APP_VARIANT === 'staff';
module.exports = {
  dependencies: staff ? {
    '@react-native-firebase/app': { platforms: { android: null, ios: null } },
    '@react-native-firebase/auth': { platforms: { android: null, ios: null } },
  } : {},
};
