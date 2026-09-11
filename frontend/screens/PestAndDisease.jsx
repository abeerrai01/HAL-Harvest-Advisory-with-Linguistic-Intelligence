import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Speech from 'expo-speech';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { auth } from '../firebase';
import { classifyDiseaseImage, getPestHistory, getPestRecommendation, savePestHistory } from '../services/halApi';
import { useTranslation } from '../services/i18n';

export default function PestAndDisease({ navigation }) {
  const { t } = useTranslation();
  const [detecting, setDetecting] = useState(false);
  const [result, setResult] = useState(null);
  const [recommendation, setRecommendation] = useState(null);
  const [history, setHistory] = useState([]);
  const [speaking, setSpeaking] = useState(false);
  
  // Animation refs for loader
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim1 = useRef(new Animated.Value(1)).current;
  const scaleAnim2 = useRef(new Animated.Value(1)).current;
  const scaleAnim3 = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    (async () => {
      const farmer_ID = auth.currentUser?.uid;
      if (!farmer_ID) return;
      try {
        const { items } = await getPestHistory({ farmer_ID, limit: 10 });
        setHistory(items || []);
      } catch (e) {
        console.log('history load error', e?.message);
      }
    })();
  }, []);

  // Animation effect for loader
  useEffect(() => {
    if (detecting) {
      // Start rotating animation
      const rotateAnimation = Animated.loop(
        Animated.timing(rotateAnim, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        })
      );

      // Start pulsing animations for dots
      const pulseAnimation1 = Animated.loop(
        Animated.sequence([
          Animated.timing(scaleAnim1, {
            toValue: 1.5,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(scaleAnim1, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
        ])
      );

      const pulseAnimation2 = Animated.loop(
        Animated.sequence([
          Animated.delay(200),
          Animated.timing(scaleAnim2, {
            toValue: 1.5,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(scaleAnim2, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
        ])
      );

      const pulseAnimation3 = Animated.loop(
        Animated.sequence([
          Animated.delay(400),
          Animated.timing(scaleAnim3, {
            toValue: 1.5,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(scaleAnim3, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
        ])
      );

      rotateAnimation.start();
      pulseAnimation1.start();
      pulseAnimation2.start();
      pulseAnimation3.start();

      return () => {
        rotateAnimation.stop();
        pulseAnimation1.stop();
        pulseAnimation2.stop();
        pulseAnimation3.stop();
      };
    } else {
      // Reset animations
      rotateAnim.setValue(0);
      scaleAnim1.setValue(1);
      scaleAnim2.setValue(1);
      scaleAnim3.setValue(1);
    }
  }, [detecting]);

  const handlePick = async (source) => {
    try {
      setDetecting(true);
      setResult(null);
      setRecommendation(null);
      let img;
      if (source === 'camera') {
        const cperm = await ImagePicker.requestCameraPermissionsAsync();
        if (cperm.status !== 'granted') { Alert.alert(t('common.error'), t('pestDisease.cameraPermissionNeeded')); setDetecting(false); return; }
        img = await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.9 });
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (perm.status !== 'granted') { Alert.alert(t('common.error'), t('pestDisease.permissionNeeded')); setDetecting(false); return; }
        img = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, quality: 0.9 });
      }
      if (img.canceled) { setDetecting(false); return; }
      const asset = img.assets?.[0];
      if (!asset?.uri) { setDetecting(false); return; }
      console.log('🔍 Uploading image for PD detection...');
      const resp = await classifyDiseaseImage({ uri: asset.uri, farmer_ID: auth.currentUser?.uid });
      console.log('✅ PD detection response ok:', !!resp?.report);
      setResult(resp);
      try {
        if (auth.currentUser?.uid && resp?.report) {
          console.log('💾 Saving history...');
          await savePestHistory({ farmer_ID: auth.currentUser.uid, report: resp.report });
          const { items } = await getPestHistory({ farmer_ID: auth.currentUser.uid, limit: 10 });
          setHistory(items || []);
        }
      } catch (e) { console.log('history save error', e?.message); }
      try {
        const langCode = (resp?.language || 'en').toLowerCase();
        console.log('🤖 Fetching recommendation in', langCode);
        const reco = await getPestRecommendation({ report: resp.report, language: langCode });
        setRecommendation(reco?.recommendation || null);
      } catch (e) { console.log('reco error', e?.message); }
    } catch (e) {
      Alert.alert(t('pestDisease.detectionFailed'), e?.message || t('common.retry'));
    } finally {
      setDetecting(false);
    }
  };

  const toggleSpeak = async (text, lang='en') => {
    try {
      const is = await Speech.isSpeakingAsync();
      if (is && speaking) { await Speech.stop(); setSpeaking(false); return; }
      let voice;
      try {
        const vs = await Speech.getAvailableVoicesAsync();
        voice = vs?.find(v => (v.language||'').toLowerCase().startsWith(lang.toLowerCase()));
      } catch {}
      setSpeaking(true);
      Speech.speak(String(text||''), { language: lang, voice: voice?.identifier, rate: 1.0, pitch: 1.0, onDone: () => setSpeaking(false), onStopped: () => setSpeaking(false) });
    } catch {}
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#F5F5DC' }}>
      {/* Header */}
      <View style={styles.appBar}>
        <Text style={styles.title}>{t('pestDisease.title')}</Text>
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 90 }}>
        {/* Dynamic detection summary */}
        <View style={styles.statusBanner}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={styles.statusTitle}>{result?.report?.['Disease Name'] ? t('pestDisease.detectedIssue') : t('pestDisease.noDetectionYet')}</Text>
              <Text style={styles.statusSub}>
                {result?.report?.['Disease Name']
                  ? `${result.report['Disease Name']} • ${t('pestDisease.confidence')} ${result.report['Model Confidence'] || '—'}`
                  : t('pestDisease.tapToSelect')}
              </Text>
            </View>
            <MaterialIcons name="search" size={28} color="#4CAF50" />
          </View>
          {result?.report?.['Language'] && (
            <Text style={styles.statusTime}>Language: {result.report['Language']}</Text>
          )}
        </View>
        {/* Detailed dynamic sections when report exists */}
        {result?.report && (
          <View style={{ marginHorizontal: 14 }}>
            {/* Disease Summary */}
            <View style={[styles.alertCard, { borderColor: '#4CAF5080' }]}> 
              <View style={styles.severityBarGreen} />
          <View style={styles.alertBody}>
            <View style={styles.alertHeaderRow}>
              <View style={{ flex: 1 }}>
                    <Text style={styles.alertTitle}>{result.report['Disease Name']}</Text>
                    {!!result.report['Model Confidence'] && (
                      <Text style={styles.alertDesc}>{t('pestDisease.confidence')}: {result.report['Model Confidence']}</Text>
                    )}
              </View>
            </View>
                {!!result.report['Detailed Report'] && (
            <View style={styles.solutionsBox}>
                    <Text style={styles.solutionsTitle}>{t('pestDisease.detailedReport')}</Text>
                    <Text style={styles.solutionItem}>{result.report['Detailed Report']}</Text>
              </View>
                )}
              </View>
            </View>

            {/* Other Possible Diseases */}
            {Array.isArray(result.report['Other Possible Diseases']) && result.report['Other Possible Diseases'].length > 0 && (
              <View style={[styles.alertCard, { borderColor: '#E0E0E0' }]}> 
                <View style={styles.alertBody}>
                  <Text style={styles.alertTitle}>{t('pestDisease.otherPossibleDiseases')}</Text>
                  <View style={{ marginTop: 8 }}>
                    {result.report['Other Possible Diseases'].map((d, idx) => (
                      <Text key={idx} style={styles.solutionItem}>• {d.label} {d.confidence != null ? `(${(d.confidence*100).toFixed(2)}%)` : ''}</Text>
                    ))}
          </View>
        </View>
              </View>
            )}

            {/* Note/Disclaimer */}
            {(result.report['Note'] || result.report['Disclaimer']) && (
              <View style={[styles.alertCard, { borderColor: '#FFD54F' }]}> 
                <View style={styles.alertBody}>
                  <Text style={styles.alertTitle}>{t('pestDisease.note')}</Text>
                  <Text style={styles.solutionItem}>{result.report['Note'] || result.report['Disclaimer']}</Text>
          </View>
        </View>
            )}

            {/* Recommendation */}
            {recommendation && (
        <View style={[styles.alertCard, { borderColor: '#4CAF5080' }]}> 
          <View style={styles.alertBody}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={styles.alertTitle}>{t('pestDisease.aiRecommendation')}</Text>
                    <TouchableOpacity onPress={() => toggleSpeak([recommendation.summary, ...(recommendation.immediate_actions||[])].join('. '), (result?.language||'en'))}>
                      <MaterialIcons name="volume-up" size={24} color={speaking ? '#2E7D32' : '#3A5F0B'} />
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.solutionItem}>{recommendation.summary}</Text>
                  {(recommendation.immediate_actions||[]).length > 0 && (
                    <View style={styles.solutionsBox}>
                      <Text style={styles.solutionsTitle}>{t('pestDisease.immediateActions')}</Text>
                      {(recommendation.immediate_actions||[]).map((a,i)=>(
                        <Text key={i} style={styles.solutionItem}>• {a}</Text>
                      ))}
                    </View>
                  )}
                  {(recommendation.organic_solutions||[]).length > 0 && (
                    <View style={styles.solutionsBox}>
                      <Text style={styles.solutionsTitle}>{t('pestDisease.organicSolutions')}</Text>
                      {(recommendation.organic_solutions||[]).map((a,i)=>(
                        <Text key={i} style={styles.solutionItem}>• {a}</Text>
                      ))}
                    </View>
                  )}
                </View>
              </View>
            )}
            </View>
        )}

        {/* Ask chatbot about detection */}
        {!!result?.report?.['Disease Name'] && (
          <View style={{ marginHorizontal: 14, marginTop: 10 }}>
            <TouchableOpacity
              style={{ backgroundColor: '#2A5C3D', paddingVertical: 12, borderRadius: 12, alignItems: 'center' }}
              onPress={() => navigation.navigate('DiseaseChat', { disease_label: result.report['Disease Name'], context: 'Detected via image classification', language: 'en' })}
            >
              <Text style={{ color: '#fff', fontWeight: 'bold' }}>{t('pestDisease.askAboutDisease', { disease: result.report['Disease Name'] })}</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
      {/* FAB */}
      <View style={{ position: 'absolute', right: 16, bottom: 100, flexDirection: 'row', gap: 10 }}>
        <TouchableOpacity style={styles.fab} onPress={() => handlePick('camera')}>
          <MaterialIcons name="photo-camera" size={24} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.fab, { backgroundColor: '#6B8E23' }]} onPress={() => handlePick('gallery')}>
          <MaterialIcons name="photo" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* History Section */}
      {history && history.length > 0 && (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#fff', padding: 10, borderTopLeftRadius: 12, borderTopRightRadius: 12, borderWidth: 1, borderColor: '#eee' }}>
          <Text style={{ fontWeight: 'bold', color: '#212121', marginBottom: 6 }}>{t('pestDisease.myHistory')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {history.map((h) => (
              <TouchableOpacity key={h.id} style={{ padding: 10, borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 10, marginRight: 8 }} onPress={() => navigation.navigate('DiseaseChat', { disease_label: h.report?.['Disease Name'], context: 'From history', language: (result?.language||'en') })}>
                <Text style={{ fontWeight: '700', color: '#2A5C3D' }} numberOfLines={1}>{h.report?.['Disease Name'] || '—'}</Text>
                <Text style={{ color: '#666' }} numberOfLines={1}>{h.report?.['Model Confidence'] || ''}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Full-screen loader overlay */}
      {detecting && (
        <View style={styles.loaderOverlay}>
          <View style={styles.loaderContent}>
            <Animated.View
              style={[
                styles.loaderCircle,
                {
                  transform: [
                    {
                      rotate: rotateAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: ['0deg', '360deg'],
                      }),
                    },
                  ],
                },
              ]}
            >
              <View style={[styles.loaderDot, styles.loaderDot1]} />
              <View style={[styles.loaderDot, styles.loaderDot2]} />
              <View style={[styles.loaderDot, styles.loaderDot3]} />
              <View style={[styles.loaderDot, styles.loaderDot4]} />
            </Animated.View>
            <View style={styles.loaderDots}>
              <Animated.View
                style={[
                  styles.loaderPulseDot,
                  {
                    transform: [{ scale: scaleAnim1 }],
                    backgroundColor: '#4CAF50',
                  },
                ]}
              />
              <Animated.View
                style={[
                  styles.loaderPulseDot,
                  {
                    transform: [{ scale: scaleAnim2 }],
                    backgroundColor: '#66BB6A',
                  },
                ]}
              />
              <Animated.View
                style={[
                  styles.loaderPulseDot,
                  {
                    transform: [{ scale: scaleAnim3 }],
                    backgroundColor: '#81C784',
                  },
                ]}
              />
            </View>
            <Text style={styles.loaderText}>{t('pestDisease.analyzing') || 'Analyzing image...'}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  appBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 16, paddingTop: 34, borderBottomWidth: 1, borderColor: '#E0E0E0' },
  title: { flex: 1, fontWeight: 'bold', fontSize: 20, color: '#212121', textAlign: 'left' },
  locRow: { paddingHorizontal: 14, paddingTop: 9 },
  weatherChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, gap: 6, borderWidth: 1, borderColor: '#E0E0E0' },
  weatherChipText: { color: '#3A5F0B', fontWeight: '600' },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#C7C7C7' },
  statusBanner: { margin: 14, backgroundColor: '#D32F2F1A', borderColor: '#D32F2F33', borderWidth: 1, borderRadius: 14, padding: 16 },
  statusTitle: { color: '#D32F2F', fontWeight: 'bold', fontSize: 16 },
  statusSub: { color: '#d06666', marginTop: 3 },
  statusTime: { fontSize: 12, color: '#8c8c8c', marginTop: 10 },
  detectCard: { marginHorizontal: 14, marginBottom: 10, backgroundColor: '#f5fff5', borderWidth: 1, borderColor: '#4CAF5026', borderRadius: 12 },
  detectHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12 },
  detectTitle: { fontWeight: '600', color: '#212121' },
  detectBody: { borderTopWidth: 1, borderColor: '#4CAF5026', padding: 12 },
  detectText: { color: '#555' },
  filterRow: { paddingLeft: 12, paddingRight: 8, paddingTop: 4, paddingBottom: 8, gap: 8 },
  filterChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#EEEEEE', borderColor: '#E0E0E0', borderWidth: 1, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, marginRight: 4 },
  filterText: { color: '#333', fontWeight: '600' },
  alertCard: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, marginHorizontal: 14, marginTop: 12, overflow: 'hidden' },
  severityBarRed: { height: 6, backgroundColor: '#D32F2F', width: '100%' },
  severityBarAmber: { height: 6, backgroundColor: '#FFA000', width: '100%' },
  severityBarGreen: { height: 6, backgroundColor: '#4CAF50', width: '100%' },
  alertBody: { padding: 14 },
  alertHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sevLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sevLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  cropMeta: { color: '#666', marginTop: 4 },
  alertTitle: { fontSize: 18, fontWeight: 'bold', marginTop: 3, color: '#212121' },
  alertDesc: { color: '#666', marginTop: 6 },
  thumbBox: { width: 78, height: 78, borderRadius: 10, backgroundColor: '#eaeaea' },
  solutionsBox: { marginTop: 12, backgroundColor: '#E8F5E9', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#4CAF5026' },
  solutionsTitle: { fontSize: 16, fontWeight: 'bold', color: '#4CAF50' },
  solutionItem: { color: '#212121', fontSize: 14 },
  actionBtn: { marginTop: 12, backgroundColor: '#EEEEEE', paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  actionBtnText: { fontWeight: 'bold', color: '#212121' },
  fab: { position: 'absolute', right: 16, bottom: 22, backgroundColor: '#4CAF50', width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 6, elevation: 6 },
  loaderOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  loaderContent: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 40,
    minWidth: 200,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 10,
  },
  loaderCircle: { width: 50, height: 50, position: 'relative', marginBottom: 20 },
  loaderDot: { width: 10, height: 10, borderRadius: 5, position: 'absolute', backgroundColor: '#4CAF50' },
  loaderDot1: { top: 0, left: '50%', marginLeft: -5 },
  loaderDot2: { top: '50%', right: 0, marginTop: -5 },
  loaderDot3: { bottom: 0, left: '50%', marginLeft: -5 },
  loaderDot4: { top: '50%', left: 0, marginTop: -5 },
  loaderDots: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 10, gap: 6 },
  loaderPulseDot: { width: 10, height: 10, borderRadius: 5 },
  loaderText: {
    marginTop: 20,
    fontSize: 16,
    fontWeight: '600',
    color: '#4CAF50',
    textAlign: 'center',
  },
});
