import { useNavigation } from '@react-navigation/native';
import React, { useState } from 'react';
import { Image, ImageBackground, Linking, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from '../services/i18n';

// Replace this with a real asset if you add it to the assets folder
const bgImage = require('../assets/bg_farm_field.png');

export default function SplashLogin() {
  const navigation = useNavigation();
  const { t } = useTranslation();
  const [mobile, setMobile] = useState('');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F7F7F2' }}>
      <View style={styles.root}>
        {/* Background image overlay */}
        <ImageBackground source={bgImage} style={styles.bgImg} imageStyle={{ opacity: 0.12, resizeMode: 'cover' }}>
          <View style={{ flex: 1 }}>
              <View style={styles.topSection}>
            
                <Image source={require('../assets/icon12.png')} style={{ width: 256, height: 256, resizeMode: 'contain' }} />
         
              <Text style={styles.welcome}>{t('splashLogin.welcome')}</Text>
              <Text style={styles.desc}>{t('splashLogin.tagline')}</Text>
            </View>
            <View style={styles.card}>
              {/* Email-only auth; phone input removed as requested */}
              {/* Continue Button */}
              <TouchableOpacity style={styles.ctaBtn} activeOpacity={0.85} onPress={() => navigation.navigate('Login')}>
                <Text style={styles.ctaTxt}>{t('splashLogin.continueWithEmail')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.ctaBtn, { backgroundColor: '#3f7f55' }]} activeOpacity={0.85} onPress={() => navigation.navigate('Language', { redirectTo: 'Signup' })}>
                <Text style={styles.ctaTxt}>{t('splashLogin.createAccount')}</Text>
              </TouchableOpacity>
              {/* Terms & Privacy */}
              <Text style={styles.terms}>
                {t('splashLogin.termsText')}{' '}
                <Text style={styles.link} onPress={() => Linking.openURL('#')}>{t('splashLogin.termsOfService')}</Text> &{' '}
                <Text style={styles.link} onPress={() => Linking.openURL('#')}>{t('splashLogin.privacyPolicy')}</Text>.
              </Text>
            </View>
          </View>
        </ImageBackground>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F7F7F2',
  },
  bgImg: {
    flex: 1,
    width: '100%',
    height: '100%',
    justifyContent: 'flex-end',
  },
  topSection: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 64,
  },
  logoCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#2A5B3D',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  welcome: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#333333',
    textAlign: 'center',
    marginBottom: 2,
  },
  desc: {
    fontSize: 16,
    color: '#555',
    opacity: 0.88,
    marginBottom: 0,
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 26,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -2 },
    elevation: 8,
    width: '100%',
    marginTop: 'auto',
    alignItems: 'center',
    gap: 18,
  },
  langBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: '#f3f3f3',
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: 20,
    marginBottom: 6,
  },
  langTxt: {
    fontSize: 15,
    fontWeight: '500',
    color: '#333',
    marginHorizontal: 6,
  },
  label: {
    alignSelf: 'flex-start',
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
    marginBottom: 7,
    marginTop: 8,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    backgroundColor: '#F7F7F2',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#c7c7c7',
    marginBottom: 6,
  },
  prefix: {
    fontSize: 16,
    color: '#888',
    fontWeight: '400',
    marginLeft: 16,
    marginRight: 6,
  },
  input: {
    flex: 1,
    height: 52,
    fontSize: 16,
    color: '#2A5B3D',
    paddingLeft: 0,
    paddingRight: 12,
  },
  ctaBtn: {
    width: '100%',
    backgroundColor: '#2A5B3D',
    borderRadius: 16,
    paddingVertical: 13,
    marginVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  ctaTxt: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 17,
    letterSpacing: 0.3,
  },
  terms: {
    color: '#888',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 7,
  },
  link: {
    color: '#2A5B3D',
    textDecorationLine: 'underline',
    fontWeight: '500',
  },
});
