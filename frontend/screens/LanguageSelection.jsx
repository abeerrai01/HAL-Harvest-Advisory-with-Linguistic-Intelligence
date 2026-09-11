import { MaterialIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation, useRoute } from '@react-navigation/native';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from '../services/i18n';

const languages = [
  { label: 'English', value: 'en', native: 'English' },
  { label: 'हिन्दी', value: 'hi', native: 'Hindi' },
  { label: 'বাংলা', value: 'bn', native: 'Bengali' },
  { label: 'తెలుగు', value: 'te', native: 'Telugu' },
  { label: 'मराठी', value: 'mr', native: 'Marathi' },
  { label: 'தமிழ்', value: 'ta', native: 'Tamil' },
  { label: 'ગુજરાતી', value: 'gu', native: 'Gujarati' },
  { label: 'ಕನ್ನಡ', value: 'kn', native: 'Kannada' },
];

// Map Indian states/regions to languages
const stateToLanguage = {
  // Hindi speaking states
  'uttar pradesh': 'hi',
  'uttarakhand': 'hi',
  'bihar': 'hi',
  'jharkhand': 'hi',
  'chhattisgarh': 'hi',
  'madhya pradesh': 'hi',
  'rajasthan': 'hi',
  'haryana': 'hi',
  'himachal pradesh': 'hi',
  'delhi': 'hi',
  
  // Bengali
  'west bengal': 'bn',
  'bangla': 'bn',
  
  // Telugu
  'andhra pradesh': 'te',
  'telangana': 'te',
  
  // Marathi
  'maharashtra': 'mr',
  
  // Tamil
  'tamil nadu': 'ta',
  'tamilnadu': 'ta',
  
  // Gujarati
  'gujarat': 'gu',
  
  // Kannada
  'karnataka': 'kn',
  'karnatak': 'kn',
};

// Function to detect language from location
const detectLanguageFromLocation = async () => {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      console.warn('Location permission denied for language detection');
      return 'en'; // Default to English
    }

    const position = await Location.getCurrentPositionAsync({});
    const { latitude, longitude } = position.coords;
    console.log('📍 Detecting language from location:', { latitude, longitude });

    // Reverse geocode to get state/region
    const places = await Location.reverseGeocodeAsync({ latitude, longitude });
    if (places && places.length > 0) {
      const place = places[0];
      const region = (place.region || '').toLowerCase();
      const subregion = (place.subregion || '').toLowerCase();
      const district = (place.district || '').toLowerCase();
      
      console.log('📍 Location details:', { region, subregion, district });
      
      // Check region first
      for (const [state, lang] of Object.entries(stateToLanguage)) {
        if (region.includes(state) || subregion.includes(state) || district.includes(state)) {
          console.log('✅ Detected language:', lang, 'from state:', state);
          return lang;
        }
      }
      
      // Fallback: Check approximate coordinates for major regions
      // North India (Hindi belt)
      if (latitude >= 24 && latitude <= 32 && longitude >= 73 && longitude <= 82) {
        return 'hi';
      }
      // West Bengal (Bengali)
      if (latitude >= 21 && latitude <= 27 && longitude >= 86 && longitude <= 90) {
        return 'bn';
      }
      // Tamil Nadu (Tamil)
      if (latitude >= 8 && latitude <= 13 && longitude >= 77 && longitude <= 81) {
        return 'ta';
      }
      // Karnataka (Kannada)
      if (latitude >= 11 && latitude <= 19 && longitude >= 74 && longitude <= 78) {
        return 'kn';
      }
      // Andhra/Telangana (Telugu)
      if (latitude >= 12 && latitude <= 20 && longitude >= 76 && longitude <= 85) {
        return 'te';
      }
      // Gujarat (Gujarati)
      if (latitude >= 20 && latitude <= 25 && longitude >= 68 && longitude <= 75) {
        return 'gu';
      }
      // Maharashtra (Marathi)
      if (latitude >= 15 && latitude <= 22 && longitude >= 72 && longitude <= 81) {
        return 'mr';
      }
    }

    return 'en'; // Default to English
  } catch (error) {
    console.error('❌ Error detecting language from location:', error);
    return 'en'; // Default to English on error
  }
};

export default function LanguageSelection() {
  const { t } = useTranslation();
  const [selected, setSelected] = useState('en');
  const [detecting, setDetecting] = useState(true);
  const [detectedLocation, setDetectedLocation] = useState('');
  const navigation = useNavigation();
  const route = useRoute();

  useEffect(() => {
    const autoDetectLanguage = async () => {
      try {
        setDetecting(true);
        console.log('🌍 Auto-detecting language from location...');
        
        const detectedLang = await detectLanguageFromLocation();
        console.log('✅ Auto-detected language:', detectedLang);
        
        setSelected(detectedLang);
        
        // Get location name for display
        try {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status === 'granted') {
            const pos = await Location.getCurrentPositionAsync({});
            const places = await Location.reverseGeocodeAsync({ 
              latitude: pos.coords.latitude, 
              longitude: pos.coords.longitude 
            });
            if (places && places[0]) {
              const p = places[0];
              setDetectedLocation(`${p.city || p.district || ''}, ${p.region || ''}`.trim());
            }
          }
        } catch (e) {
          console.warn('Could not get location name:', e);
        }
      } catch (error) {
        console.error('Error in auto-detection:', error);
      } finally {
        setDetecting(false);
      }
    };

    autoDetectLanguage();
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: '#f6f8f6' }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <Text style={styles.header}>{t('languageSelection.welcome')}</Text>
        <Text style={styles.subheader}>{t('languageSelection.selectLanguage')}</Text>
        {detecting ? (
          <View style={styles.detectingContainer}>
            <ActivityIndicator size="small" color="#17cf17" style={{ marginRight: 8 }} />
            <Text style={styles.detectingText}>Detecting language from your location...</Text>
          </View>
        ) : (
          <View style={styles.suggestedChip}>
            <MaterialIcons name="place" size={17} color="#0e1b0e" style={{ marginRight: 4 }} />
            <Text style={styles.suggestedText}>
              {detectedLocation 
                ? `Suggested for ${detectedLocation}`
                : t('languageSelection.suggested')}
            </Text>
          </View>
        )}
        <View style={{ gap: 8, marginTop: 18 }}>
          {languages.map((lang, i) => (
            <TouchableOpacity
              key={lang.value}
              style={[styles.langRow, selected === lang.value && styles.langRowActive]}
              onPress={() => setSelected(lang.value)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.langLabel}>{lang.label}</Text>
                <Text style={styles.langNative}>{lang.native}</Text>
              </View>
              <View style={selected === lang.value ? styles.radioOuterActive : styles.radioOuter}>
                {selected === lang.value && <View style={styles.radioDot} />}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
      <TouchableOpacity
        style={styles.confirmBtn}
        onPress={async () => {
          try {
            await AsyncStorage.setItem('hal_language', selected);
            await AsyncStorage.setItem('hal_onboarded', 'true');
            const redirectTo = route?.params?.redirectTo;
            if (redirectTo) {
              navigation.navigate(redirectTo);
            } else {
              navigation.reset({ index: 0, routes: [{ name: 'SplashLogin' }] });
            }
          } catch (e) {
            // ignore for now
          }
        }}>
        <Text style={styles.confirmBtnText}>{t('languageSelection.confirm')}</Text>
      </TouchableOpacity>
    </View>
  );
}
const styles = StyleSheet.create({
  header: { fontSize: 32, fontWeight: 'bold', color: '#0e1b0e', marginTop: 32, marginLeft: 16, marginRight: 16 },
  subheader: { fontSize: 15, color: '#4e974e', marginTop: 5, marginLeft: 16, marginRight: 16 },
  detectingContainer: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: '#e7f3e7', 
    borderRadius: 8, 
    paddingVertical: 8, 
    paddingHorizontal: 12, 
    alignSelf: 'flex-start', 
    marginLeft: 16, 
    marginTop: 17 
  },
  detectingText: { color: '#0e1b0e', fontSize: 14, fontWeight: '500' },
  suggestedChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#e7f3e7', borderRadius: 8, paddingVertical: 4, paddingHorizontal: 10, alignSelf: 'flex-start', marginLeft: 16, marginTop: 17 },
  suggestedText: { color: '#0e1b0e', fontSize: 14, fontWeight: '600' },
  langRow: { flexDirection: 'row', alignItems: 'center', borderColor: '#d0e7d0', borderWidth: 2, borderRadius: 14, backgroundColor: '#fff', marginHorizontal: 13, marginBottom: 5, paddingVertical: 15, paddingHorizontal: 14, },
  langRowActive: { borderColor: '#17cf17', backgroundColor: '#e7f3e7' },
  langLabel: { fontSize: 15, color: '#0e1b0e', fontWeight: '600' },
  langNative: { fontSize: 13, color: '#4e974e', fontWeight: '400' },
  radioOuter: { width: 25, height: 25, borderRadius: 13, borderWidth: 2, borderColor: '#d0e7d0', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  radioOuterActive: { width: 25, height: 25, borderRadius: 13, borderWidth: 2, borderColor: '#17cf17', alignItems: 'center', justifyContent: 'center', backgroundColor: '#17cf1730' },
  radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#17cf17' },
  confirmBtn: { backgroundColor: '#17cf17', margin: 17, marginBottom: 21, borderRadius: 12, height: 58, alignItems: 'center', justifyContent: 'center', },
  confirmBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 19 },
});
