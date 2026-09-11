# Internationalization (i18n) Update Guide

## Overview
The app now supports full internationalization based on the user's selected language from `users/{uid}.language` in Firestore. All text in the app interface should be displayed in the user's selected language.

## Architecture

### Files Created
1. **`services/i18n.js`**: Translation context provider and hook
   - `I18nProvider`: Wraps the app and manages language state
   - `useTranslation()`: Hook to access translations in components
   - Automatically syncs with Firestore `users/{uid}.language`

2. **`services/translations.js`**: Translation strings for all languages
   - Structure: `translations[language][screen][key]`
   - Currently has English (en) and Hindi (hi) translations
   - Other languages fallback to English

### App Integration
- `App.jsx` is wrapped with `<I18nProvider>` to provide translations globally

## How to Update Screens

### Step 1: Import the hook
```javascript
import { useTranslation } from '../services/i18n';
```

### Step 2: Use the hook in your component
```javascript
export default function MyScreen({ navigation }) {
  const { t } = useTranslation();
  
  // Use t() function to get translated strings
  return (
    <Text>{t('screenName.key')}</Text>
  );
}
```

### Step 3: Replace hardcoded text
**Before:**
```javascript
<Text style={styles.title}>Welcome</Text>
<Text style={styles.subtitle}>Sign in to continue</Text>
```

**After:**
```javascript
<Text style={styles.title}>{t('login.welcome')}</Text>
<Text style={styles.subtitle}>{t('login.signInToContinue')}</Text>
```

### Step 4: Add translation keys
Add your translation keys to `services/translations.js`:

```javascript
const translations = {
  en: {
    screenName: {
      key: 'English Text',
      anotherKey: 'Another English Text',
    },
  },
  hi: {
    screenName: {
      key: 'हिंदी पाठ',
      anotherKey: 'अन्य हिंदी पाठ',
    },
  },
};
```

## Translation Key Structure

### Naming Convention
- Use dot notation: `screen.component.element`
- Example: `dashboard.myProfile`, `login.email`, `cropAdvisory.viewReport`

### Common Patterns
- **Common elements**: `common.loading`, `common.save`, `common.cancel`
- **Screen titles**: `dashboard.title`, `login.title`
- **Form labels**: `login.email`, `login.password`
- **Buttons**: `login.login`, `signup.signUp`
- **Messages**: `login.loginFailed`, `profile.profileUpdated`

## Screens to Update

### ✅ Completed
- [x] Login.jsx
- [x] Dashboard.jsx
- [x] App.jsx (wrapped with I18nProvider)

### 🔄 In Progress / Remaining
- [ ] Signup.jsx
- [ ] Profile.jsx
- [ ] CropAdvisory1.jsx (CropAdvisorySection.jsx)
- [ ] PestAndDisease.jsx
- [ ] DiseaseChat.jsx
- [ ] WeatherAlerts.jsx
- [ ] SoilHealth.jsx
- [ ] MarketPrices.jsx
- [ ] MarketPricesWithPredictedSellDate.jsx
- [ ] FieldSetup.jsx
- [ ] VoiceAssistant1.jsx
- [ ] VoiceAssistant2.jsx
- [ ] FarmerDashboard.jsx
- [ ] SplashLogin.jsx
- [ ] LanguageSelection.jsx

## Example: Updating a Screen

### Example: Profile.jsx

**Step 1: Add import**
```javascript
import { useTranslation } from '../services/i18n';
```

**Step 2: Use hook**
```javascript
export default function Profile({ navigation }) {
  const { t } = useTranslation();
  // ... rest of component
}
```

**Step 3: Replace text**
```javascript
// Before
<Text style={styles.title}>Profile</Text>
<Text style={styles.label}>Full Name</Text>
<TouchableOpacity onPress={onSave}>
  <Text>Save Changes</Text>
</TouchableOpacity>

// After
<Text style={styles.title}>{t('profile.title')}</Text>
<Text style={styles.label}>{t('profile.fullName')}</Text>
<TouchableOpacity onPress={onSave}>
  <Text>{t('profile.saveChanges')}</Text>
</TouchableOpacity>
```

**Step 4: Add to translations.js** (if not already present)
```javascript
profile: {
  title: 'Profile',
  fullName: 'Full Name',
  saveChanges: 'Save Changes',
  // ... more keys
},
```

## Tips

1. **Search for hardcoded strings**: Use your IDE's search to find all `Text` components with hardcoded strings
2. **Group related keys**: Keep related translations together (e.g., all login-related keys under `login`)
3. **Use parameters**: For dynamic text, use `{{param}}` syntax:
   ```javascript
   t('dashboard.greeting', { name: firstName })
   // Translation: "Welcome, {{name}}"
   ```
4. **Fallback behavior**: If a translation key is missing, it falls back to English, then returns the key itself
5. **Test in different languages**: Change user language in Profile to test translations

## Adding New Languages

To add translations for a new language:

1. Add the language code to `translations.js`:
```javascript
const translations = {
  en: { /* ... */ },
  hi: { /* ... */ },
  te: { /* Telugu translations */ },
  // ... etc
};
```

2. The language will automatically be available if it's in the `allLanguages` array in `Profile.jsx`

## Current Status

- ✅ Infrastructure created (i18n.js, translations.js)
- ✅ App wrapped with I18nProvider
- ✅ Login.jsx updated
- ✅ Dashboard.jsx updated
- 🔄 Remaining screens need updates

## Next Steps

1. Continue updating screens systematically
2. Add missing translation keys as you find hardcoded text
3. Expand Hindi translations for all screens
4. Add translations for other Indian languages as needed

