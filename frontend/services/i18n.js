import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, onSnapshot } from 'firebase/firestore';
import { createContext, useContext, useEffect, useState } from 'react';
import { ActivityIndicator, Animated, Modal, StyleSheet, Text, View } from 'react-native';
import { auth, db } from '../firebase';
import { translateObject } from './googleTranslate';
import translations from './translations';

const I18nContext = createContext(null);

// Languages with manual translations (don't use Google Translate)
const MANUAL_TRANSLATION_LANGUAGES = ['en', 'hi'];

export function I18nProvider({ children }) {
  const [language, setLanguage] = useState('en');
  const [loading, setLoading] = useState(true);
  const [translatedTranslations, setTranslatedTranslations] = useState(null);
  const [translating, setTranslating] = useState(false);
  const [translationProgress, setTranslationProgress] = useState(0);
  const [translationProgressText, setTranslationProgressText] = useState('');

  const preloadTranslations = async (targetLang) => {
    let progressInterval = null;
    let textInterval = null;
    
    try {
      console.log(`🔄 Starting translation for ${targetLang}...`);
      setTranslating(true);
      setTranslationProgress(0);
      setTranslationProgressText('Preparing translation...');
      
      // Check if we have cached translations
      const cacheKey = `translated_${targetLang}`;
      const cached = await AsyncStorage.getItem(cacheKey);
      
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          
          // Verify cached translation is actually translated (not just English)
          // Check multiple string values to ensure translation actually happened
          const checkSamples = (original, cached, path = '', maxCheck = 10) => {
            let checked = 0;
            let matched = 0;
            
            for (const key in original) {
              if (checked >= maxCheck) break;
              
              const currentPath = path ? `${path}.${key}` : key;
              const origValue = original[key];
              const cachedValue = cached[key];
              
              if (typeof origValue === 'string' && typeof cachedValue === 'string') {
                checked++;
                if (origValue === cachedValue) {
                  matched++;
                }
              } else if (typeof origValue === 'object' && origValue !== null && typeof cachedValue === 'object' && cachedValue !== null) {
                const nested = checkSamples(origValue, cachedValue, currentPath, maxCheck - checked);
                checked += nested.checked;
                matched += nested.matched;
              }
            }
            
            return { checked, matched };
          };
          
          const samples = checkSamples(translations.en, parsed, '', 10);
          
          console.log(`🔍 Cache validation for ${targetLang}: checked ${samples.checked} strings, ${samples.matched} unchanged`);
          
          // If most samples match (80%+), it's likely English (failed translation)
          if (samples.checked >= 3 && samples.matched >= samples.checked * 0.8) {
            console.warn(`⚠️ Cached translation appears to be English (failed translation) - ${samples.matched}/${samples.checked} samples unchanged (${Math.round(samples.matched/samples.checked*100)}%)`);
            console.warn(`⚠️ Clearing cache for ${targetLang}`);
            await AsyncStorage.removeItem(cacheKey);
            // Continue to translate below
          } else if (samples.checked >= 3) {
            console.log(`✅ Cached translation verified - ${samples.checked - samples.matched}/${samples.checked} samples changed (${Math.round((samples.checked - samples.matched)/samples.checked*100)}%)`);
            setTranslatedTranslations(parsed);
            console.log(`✅ Loaded cached translations for ${targetLang}`);
            setTranslationProgress(100);
            setTranslationProgressText('Translation loaded');
            setTimeout(() => {
              setTranslating(false);
              setTranslationProgress(0);
            }, 300);
            return;
          } else {
            // Not enough samples checked, but proceed anyway (might be valid)
            console.log(`⚠️ Not enough samples checked (${samples.checked}), but using cache anyway`);
            setTranslatedTranslations(parsed);
            console.log(`✅ Loaded cached translations for ${targetLang}`);
            setTranslationProgress(100);
            setTranslationProgressText('Translation loaded');
            setTimeout(() => {
              setTranslating(false);
              setTranslationProgress(0);
            }, 300);
            return;
          }
        } catch (e) {
          console.warn(`⚠️ Failed to parse cached translation - clearing cache:`, e);
          await AsyncStorage.removeItem(cacheKey);
          // Continue to translate below
        }
      }

      // Translate English translations to target language
      console.log(`🌐 Translating to ${targetLang}...`);
      console.log(`📊 Translation object size:`, Object.keys(translations.en).length, 'top-level keys');
      
      // Start progress animation
      progressInterval = setInterval(() => {
        setTranslationProgress((prev) => {
          if (prev >= 90) return prev; // Don't go to 100% until done
          return prev + Math.random() * 5; // Random increment for smooth animation
        });
      }, 200);
      
      // Update progress text periodically
      const progressTexts = [
        'Translating interface...',
        'Processing text...',
        'Applying translations...',
        'Finalizing...',
      ];
      let textIndex = 0;
      textInterval = setInterval(() => {
        textIndex = (textIndex + 1) % progressTexts.length;
        setTranslationProgressText(progressTexts[textIndex]);
      }, 1500);
      
      try {
        setTranslationProgress(10);
        setTranslationProgressText('Connecting to translation service...');
        
        const startTime = Date.now();
        const translated = await translateObject(translations.en, targetLang, 'en');
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        
        // Clear intervals
        clearInterval(progressInterval);
        clearInterval(textInterval);
        
        console.log(`✅ Translation completed in ${duration}s`);
        console.log(`📦 Translated object keys:`, Object.keys(translated || {}).length);
        
        // Verify translation worked
        if (!translated || Object.keys(translated).length === 0) {
          throw new Error('Translation returned empty object');
        }
        
        // Check if translation actually happened (compare multiple string values)
        const checkTranslation = (original, translated, path = '', maxCheck = 15) => {
          let checked = 0;
          let matched = 0;
          const unchanged = [];
          
          for (const key in original) {
            if (checked >= maxCheck) break;
            
            const currentPath = path ? `${path}.${key}` : key;
            const origValue = original[key];
            const transValue = translated[key];
            
            if (typeof origValue === 'string' && typeof transValue === 'string') {
              checked++;
              if (origValue === transValue) {
                matched++;
                unchanged.push(currentPath);
              }
            } else if (typeof origValue === 'object' && origValue !== null && typeof transValue === 'object' && transValue !== null) {
              const nested = checkTranslation(origValue, transValue, currentPath, maxCheck - checked);
              checked += nested.checked;
              matched += nested.matched;
              unchanged.push(...nested.unchanged);
            }
          }
          
          return { checked, matched, unchanged };
        };
        
        const checkResult = checkTranslation(translations.en, translated, '', 15);
        
        console.log(`🔍 Translation validation: checked ${checkResult.checked} strings, ${checkResult.matched} unchanged`);
        
        // If most strings are unchanged (80%+), translation likely failed
        if (checkResult.checked >= 3 && checkResult.matched >= checkResult.checked * 0.8) {
          console.error(`❌ Translation failed - ${checkResult.matched}/${checkResult.checked} strings unchanged (${Math.round(checkResult.matched/checkResult.checked*100)}%)`);
          console.error(`❌ Unchanged samples:`, checkResult.unchanged.slice(0, 5));
          console.error(`❌ This indicates the API returned the original English text`);
          throw new Error('Translation failed - text unchanged (API may have returned original)');
        } else if (checkResult.checked >= 3) {
          console.log(`✅ Translation verified - ${checkResult.checked - checkResult.matched}/${checkResult.checked} strings changed (${Math.round((checkResult.checked - checkResult.matched)/checkResult.checked*100)}%)`);
        } else {
          console.warn(`⚠️ Not enough samples checked (${checkResult.checked}), but proceeding anyway`);
        }
        
        // Cache the translated translations
        setTranslationProgress(95);
        setTranslationProgressText('Caching translations...');
        await AsyncStorage.setItem(cacheKey, JSON.stringify(translated));
        setTranslatedTranslations(translated);
        setTranslationProgress(100);
        setTranslationProgressText('Translation complete!');
        console.log(`✅ Translations loaded and cached for ${targetLang}`);
      } catch (translateError) {
        // Clear intervals
        if (progressInterval) clearInterval(progressInterval);
        if (textInterval) clearInterval(textInterval);
        
        console.error(`❌ Translation failed for ${targetLang}:`, translateError);
        console.error(`❌ Error details:`, {
          message: translateError?.message,
          response: translateError?.response?.data,
          status: translateError?.response?.status,
        });
        
        // If translation fails, use English as fallback
        console.log(`⚠️ Using English as fallback for ${targetLang}`);
        setTranslatedTranslations(null);
        setTranslationProgress(0);
        setTranslationProgressText('Translation failed');
        // Don't cache errors - allow retry later
      }
    } catch (error) {
      // Clear intervals in case of outer error
      if (progressInterval) clearInterval(progressInterval);
      if (textInterval) clearInterval(textInterval);
      
      console.error(`❌ Error preloading translations for ${targetLang}:`, error);
      console.error(`❌ Full error:`, error);
      // Fallback to English if translation fails
      setTranslatedTranslations(null);
      setTranslationProgress(0);
      setTranslationProgressText('Error loading translation');
    } finally {
      // Ensure intervals are cleared
      if (progressInterval) clearInterval(progressInterval);
      if (textInterval) clearInterval(textInterval);
      // Delay hiding to show completion
      setTimeout(() => {
        setTranslating(false);
        setTranslationProgress(0);
        setTranslationProgressText('');
      }, 500);
      console.log(`🏁 Translation process finished for ${targetLang}`);
    }
  };

  // Pre-translate when language changes to a non-manual language
  useEffect(() => {
    if (language && !MANUAL_TRANSLATION_LANGUAGES.includes(language)) {
      preloadTranslations(language);
    } else {
      setTranslatedTranslations(null);
      setTranslating(false);
    }
  }, [language]);

  useEffect(() => {
    loadLanguage();
    
    // Listen for auth state changes
    const unsubscribeAuth = auth.onAuthStateChanged((user) => {
      if (user) {
        subscribeToUserLanguage(user.uid);
      } else {
        loadLanguageFromStorage();
      }
    });

    return () => {
      unsubscribeAuth();
    };
  }, []);

  const loadLanguage = async () => {
    try {
      const user = auth.currentUser;
      if (user?.uid) {
        await subscribeToUserLanguage(user.uid);
      } else {
        await loadLanguageFromStorage();
      }
    } catch (error) {
      console.error('Error loading language:', error);
      setLanguage('en');
      setLoading(false);
    }
  };

  const subscribeToUserLanguage = async (uid) => {
    try {
      const userDocRef = doc(db, 'users', uid);
      const unsubscribe = onSnapshot(userDocRef, (doc) => {
        if (doc.exists()) {
          const userData = doc.data();
          const userLang = userData.language || 'en';
          setLanguage(userLang);
          AsyncStorage.setItem('hal_language', userLang);
          setLoading(false);
        } else {
          loadLanguageFromStorage();
        }
      }, (error) => {
        console.error('Error subscribing to user language:', error);
        loadLanguageFromStorage();
      });
      
      return unsubscribe;
    } catch (error) {
      console.error('Error subscribing to user language:', error);
      loadLanguageFromStorage();
    }
  };

  const loadLanguageFromStorage = async () => {
    try {
      const stored = await AsyncStorage.getItem('hal_language');
      setLanguage(stored || 'en');
    } catch (error) {
      console.error('Error loading language from storage:', error);
      setLanguage('en');
    } finally {
      setLoading(false);
    }
  };

  const t = (key, params = {}) => {
    const keys = key.split('.');
    
    // Determine which translation object to use
    let translationSource = translations[language];
    
    // If manual translation exists, use it
    if (MANUAL_TRANSLATION_LANGUAGES.includes(language)) {
      translationSource = translations[language];
    } 
    // If we have pre-translated translations, use them
    else if (translatedTranslations) {
      translationSource = translatedTranslations;
    }
    // Otherwise fallback to English
    else {
      translationSource = translations['en'];
    }
    
    // Try to get translation from current language
    let currentValue = translationSource;
    for (const k of keys) {
      currentValue = currentValue?.[k];
      if (currentValue === undefined) break;
    }
    
    // If not found, fallback to English
    if (currentValue === undefined) {
      translationSource = translations['en'];
      for (const fallbackKey of keys) {
        translationSource = translationSource?.[fallbackKey];
        if (translationSource === undefined) {
          return key; // Return key if translation not found
        }
      }
      currentValue = translationSource;
    }
    
    // Replace parameters in string
    if (typeof currentValue === 'string' && Object.keys(params).length > 0) {
      return currentValue.replace(/\{\{(\w+)\}\}/g, (match, paramKey) => {
        return params[paramKey] !== undefined ? String(params[paramKey]) : match;
      });
    }
    
    return currentValue || key;
  };

  return (
    <I18nContext.Provider value={{ language, t, loading: loading || translating }}>
      {children}
      <TranslationProgressModal 
        visible={translating} 
        progress={translationProgress}
        text={translationProgressText}
      />
    </I18nContext.Provider>
  );
}

function TranslationProgressModal({ visible, progress, text }) {
  const [animatedProgress] = useState(new Animated.Value(0));

  useEffect(() => {
    if (visible) {
      Animated.timing(animatedProgress, {
        toValue: Math.min(100, Math.max(0, progress)),
        duration: 300,
        useNativeDriver: false,
      }).start();
    }
  }, [progress, visible, animatedProgress]);

  if (!visible) return null;

  const progressWidth = animatedProgress.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
    extrapolate: 'clamp',
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <ActivityIndicator size="large" color="#3A5F0B" />
          <Text style={styles.modalTitle}>Translating Interface</Text>
          <Text style={styles.modalSubtitle}>{text || 'Preparing translation...'}</Text>
          <View style={styles.progressBarContainer}>
            <View style={styles.progressBarBg}>
              <Animated.View 
                style={[styles.progressBarFill, { width: progressWidth }]} 
              />
            </View>
            <Text style={styles.progressPercent}>{Math.round(progress)}%</Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    width: '80%',
    maxWidth: 320,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#2a2a2a',
    marginTop: 16,
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
  },
  progressBarContainer: {
    width: '100%',
    alignItems: 'center',
  },
  progressBarBg: {
    width: '100%',
    height: 8,
    backgroundColor: '#e5eadf',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressBarFill: {
    height: 8,
    backgroundColor: '#3A5F0B',
    borderRadius: 4,
  },
  progressPercent: {
    fontSize: 12,
    color: '#3A5F0B',
    fontWeight: '600',
  },
});

export function useTranslation() {
  const context = useContext(I18nContext);
  if (!context) {
    // Fallback if used outside provider
    return {
      language: 'en',
      t: (key) => key,
      loading: false,
    };
  }
  return context;
}

