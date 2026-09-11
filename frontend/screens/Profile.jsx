import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { sendPasswordResetEmail, signOut } from 'firebase/auth';
import React, { useEffect, useState } from 'react';
import { Alert, Image, Modal, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { auth } from '../firebase';
import { fetchUserProfile, updateUserProfile } from '../services/auth';
import { useTranslation } from '../services/i18n';

const profileImage = require('../assets/profile_placeholder.png');

// All 22 Indian languages
const allLanguages = [
  { label: 'English', value: 'en', native: 'English' },
  { label: 'हिन्दी', value: 'hi', native: 'Hindi' },
  { label: 'বাংলা', value: 'bn', native: 'Bengali' },
  { label: 'తెలుగు', value: 'te', native: 'Telugu' },
  { label: 'मराठी', value: 'mr', native: 'Marathi' },
  { label: 'தமிழ்', value: 'ta', native: 'Tamil' },
  { label: 'ગુજરાતી', value: 'gu', native: 'Gujarati' },
  { label: 'ಕನ್ನಡ', value: 'kn', native: 'Kannada' },
  { label: 'മലയാളം', value: 'ml', native: 'Malayalam' },
  { label: 'ਪੰਜਾਬੀ', value: 'pa', native: 'Punjabi' },
  { label: 'ଓଡ଼ିଆ', value: 'or', native: 'Odia' },
  { label: 'অসমীয়া', value: 'as', native: 'Assamese' },
  { label: 'नेपाली', value: 'ne', native: 'Nepali' },
  { label: 'मैथिली', value: 'mai', native: 'Maithili' },
  { label: 'मणिपुरी', value: 'mni', native: 'Manipuri' },
  { label: 'কোংকণী', value: 'kok', native: 'Konkani' },
  { label: 'বড়ো', value: 'brx', native: 'Bodo' },
  { label: 'डोगरी', value: 'doi', native: 'Dogri' },
  { label: 'کٲشُر', value: 'ks', native: 'Kashmiri' },
  { label: 'संस्कृतम्', value: 'sa', native: 'Sanskrit' },
  { label: 'संथाली', value: 'sat', native: 'Santhali' },
  { label: 'سنڌي', value: 'sd', native: 'Sindhi' },
  { label: 'اردو', value: 'ur', native: 'Urdu' },
];

export default function Profile({ navigation }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [language, setLanguage] = useState('en');
  const [showLangDropdown, setShowLangDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      const user = auth?.currentUser;
      if (user?.uid) {
        const data = await fetchUserProfile(user.uid);
        setProfile(data);
        setFullName(data?.fullName || user?.displayName || '');
        setEmail(data?.email || user?.email || '');
        setPhone(data?.phone || '');
        setLanguage(data?.language || 'en');
      }
    } catch (e) {
      console.error('Load profile error:', e);
    }
  };

  const onSave = async () => {
    setLoading(true);
    try {
      const user = auth?.currentUser;
      if (user?.uid) {
        await updateUserProfile(user.uid, { fullName, phone, language });
        await AsyncStorage.setItem('hal_language', language);
        await loadProfile();
        setEditing(false);
        Alert.alert(t('common.success'), t('profile.profileUpdated'));
      }
    } catch (e) {
      Alert.alert(t('common.error'), t('profile.updateFailed'));
    } finally {
      setLoading(false);
    }
  };

  const onResetPassword = async () => {
    const user = auth?.currentUser;
    if (!user?.email) return;
    try {
      await sendPasswordResetEmail(auth, user.email);
      Alert.alert(t('common.success'), t('profile.resetLinkSent'));
    } catch (e) {
      Alert.alert(t('common.error'), t('profile.resetFailed'));
    }
  };

  const onLogout = async () => {
    try {
      await signOut(auth);
      await AsyncStorage.removeItem('hal_logged_in');
      navigation.reset({ index: 0, routes: [{ name: 'SplashLogin' }] });
    } catch (e) {
      // noop
    }
  };

  const selectedLang = allLanguages.find(l => l.value === language) || allLanguages[0];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F7F7F2' }}>
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <MaterialIcons name="arrow-back" size={24} color="#2A5B3D" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('profile.title')}</Text>
          <TouchableOpacity onPress={() => (editing ? onSave() : setEditing(true))} style={styles.editBtn}>
            <Text style={styles.editText}>{editing ? (loading ? t('common.loading') : t('common.save')) : t('common.edit')}</Text>
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.card}>
            <Image source={profileImage} style={styles.avatar} />
            {!editing ? (
              <>
                <Text style={styles.name}>{fullName || 'Farmer'}</Text>
                <Text style={styles.email}>{email}</Text>
              </>
            ) : (
              <>
                <Text style={styles.label}>{t('profile.fullName')}</Text>
                <TextInput style={styles.input} value={fullName} onChangeText={setFullName} placeholder={t('profile.fullName')} />
              </>
            )}
          </View>

          <View style={styles.infoCard}>
            <Text style={styles.label}>{t('profile.email')}</Text>
            <Text style={styles.infoText}>{email}</Text>
          </View>

          <View style={styles.infoCard}>
            <Text style={styles.label}>{t('profile.phone')}</Text>
            {editing ? (
              <TextInput style={styles.input} value={phone} onChangeText={setPhone} placeholder={t('profile.phone')} keyboardType="phone-pad" />
            ) : (
              <Text style={styles.infoText}>{phone || t('common.select')}</Text>
            )}
          </View>

          <View style={styles.infoCard}>
            <Text style={styles.label}>{t('profile.language')}</Text>
            <TouchableOpacity
              style={styles.dropdown}
              onPress={() => setShowLangDropdown(true)}
              disabled={!editing}>
              <Text style={styles.dropdownText}>{selectedLang.label} ({selectedLang.native})</Text>
              {editing && <MaterialIcons name="arrow-drop-down" size={24} color="#666" />}
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.resetBtn} onPress={onResetPassword}>
            <MaterialIcons name="lock-reset" size={20} color="#2A5B3D" style={{ marginRight: 8 }} />
            <Text style={styles.resetTxt}>{t('profile.changePassword')}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.logoutBtn} onPress={onLogout}>
            <MaterialIcons name="logout" size={20} color="#fff" style={{ marginRight: 8 }} />
            <Text style={styles.logoutTxt}>{t('profile.logout')}</Text>
          </TouchableOpacity>
        </ScrollView>

        <Modal visible={showLangDropdown} transparent animationType="slide" onRequestClose={() => setShowLangDropdown(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{t('profile.language')}</Text>
                <TouchableOpacity onPress={() => setShowLangDropdown(false)}>
                  <MaterialIcons name="close" size={24} color="#2A5B3D" />
                </TouchableOpacity>
              </View>
              <ScrollView>
                {allLanguages.map((lang) => (
                  <TouchableOpacity
                    key={lang.value}
                    style={[styles.langOption, language === lang.value && styles.langOptionSelected]}
                    onPress={() => {
                      setLanguage(lang.value);
                      setShowLangDropdown(false);
                    }}>
                    <Text style={styles.langLabel}>{lang.label}</Text>
                    <Text style={styles.langNative}>{lang.native}</Text>
                    {language === lang.value && <MaterialIcons name="check" size={20} color="#2A5B3D" />}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>
        </Modal>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  backBtn: { padding: 6 },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#2A5B3D' },
  editBtn: { padding: 6 },
  editText: { color: '#2A5B3D', fontWeight: '600', fontSize: 16 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: '#E0E0E0', marginBottom: 16 },
  avatar: { width: 92, height: 92, borderRadius: 46, marginBottom: 10 },
  name: { fontSize: 22, fontWeight: '800', color: '#2A5B3D', marginTop: 8 },
  email: { fontSize: 14, color: '#666', marginTop: 4 },
  infoCard: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#E0E0E0' },
  label: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 8 },
  infoText: { fontSize: 16, color: '#2A5B3D' },
  input: { backgroundColor: '#F7F7F2', borderRadius: 8, padding: 12, fontSize: 16, color: '#2A5B3D', borderWidth: 1, borderColor: '#c7c7c7' },
  dropdown: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#F7F7F2', borderRadius: 8, padding: 12, borderWidth: 1, borderColor: '#c7c7c7' },
  dropdownText: { fontSize: 16, color: '#2A5B3D', flex: 1 },
  resetBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', paddingVertical: 14, borderRadius: 14, marginTop: 8, borderWidth: 1, borderColor: '#2A5B3D' },
  resetTxt: { color: '#2A5B3D', fontSize: 16, fontWeight: '700' },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#2A5B3D', paddingVertical: 14, borderRadius: 14, marginTop: 12 },
  logoutTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '80%', padding: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: '#2A5B3D' },
  langOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderRadius: 8, marginBottom: 8, backgroundColor: '#F7F7F2' },
  langOptionSelected: { backgroundColor: '#e7f3e7', borderWidth: 1, borderColor: '#2A5B3D' },
  langLabel: { fontSize: 16, fontWeight: '600', color: '#2A5B3D', flex: 1 },
  langNative: { fontSize: 14, color: '#666', marginLeft: 8 },
});