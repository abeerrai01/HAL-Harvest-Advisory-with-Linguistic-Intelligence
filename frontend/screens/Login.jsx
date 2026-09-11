import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import React, { useState } from 'react';
import { Alert, SafeAreaView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { signInUser } from '../services/auth';
import { useTranslation } from '../services/i18n';

export default function Login() {
  const navigation = useNavigation();
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const onLogin = async () => {
    setLoading(true);
    setError('');
    try {
      await signInUser({ email, password });
      await AsyncStorage.setItem('hal_logged_in', 'true');
      navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
    } catch (e) {
      const code = e?.code || '';
      const isInvalidCred = (
        code === 'auth/invalid-credential' ||
        code === 'auth/invalid-email' ||
        code === 'auth/user-not-found' ||
        code === 'auth/wrong-password'
      );
      const msg = isInvalidCred ? t('login.invalidCredentials') : (e?.message || t('login.loginFailed'));
      setError(msg);
      Alert.alert(t('login.loginFailed'), msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F7F7F2' }}>
      <View style={styles.container}>
        <Text style={styles.title}>{t('login.title')}</Text>

        {!!error && <Text style={styles.error}>{error}</Text>}

        <Text style={styles.label}>{t('login.email')}</Text>
        <View style={styles.inputRow}>
          <MaterialIcons name="mail-outline" size={20} color="#666" style={{ marginHorizontal: 10 }} />
          <TextInput
            style={styles.input}
            placeholder={t('login.email')}
            placeholderTextColor="#AAA"
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
          />
        </View>

        <Text style={styles.label}>{t('login.password')}</Text>
        <View style={styles.inputRow}>
          <MaterialIcons name="lock-outline" size={20} color="#666" style={{ marginHorizontal: 10 }} />
          <TextInput
            style={styles.input}
            placeholder={t('login.password')}
            placeholderTextColor="#AAA"
            secureTextEntry={!showPassword}
            value={password}
            onChangeText={setPassword}
          />
          <TouchableOpacity onPress={() => setShowPassword(v => !v)} style={{ paddingHorizontal: 10 }}>
            <MaterialIcons name={showPassword ? 'visibility-off' : 'visibility'} size={20} color="#666" />
          </TouchableOpacity>
        </View>

        <TouchableOpacity disabled={loading} style={styles.ctaBtn} onPress={onLogin}>
          <Text style={styles.ctaTxt}>{loading ? t('common.loading') : t('login.login')}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate('Signup')}>
          <Text style={styles.link}>{t('login.dontHaveAccount')} {t('login.signUp')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 10 },
  title: { fontSize: 28, fontWeight: '800', color: '#2A5B3D', marginTop: 8, marginBottom: 10 },
  label: { fontSize: 14, fontWeight: '600', color: '#333', marginTop: 10, marginBottom: 6 },
  inputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F7F7F2', borderRadius: 16, borderWidth: 1, borderColor: '#c7c7c7' },
  input: { flex: 1, height: 50, fontSize: 16, color: '#2A5B3D', paddingRight: 12 },
  ctaBtn: { backgroundColor: '#2A5B3D', borderRadius: 16, paddingVertical: 14, alignItems: 'center', marginTop: 14 },
  ctaTxt: { color: '#FFF', fontWeight: '700', fontSize: 16 },
  link: { color: '#2A5B3D', fontWeight: '600', marginTop: 14, textAlign: 'center' },
  error: { color: '#b00020', backgroundColor: '#fde7e7', padding: 8, borderRadius: 8 },
});


