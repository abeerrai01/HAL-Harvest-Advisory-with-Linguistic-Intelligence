import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

export default function VoiceAssistant2() {
  return (
    <View style={{ flex: 1, backgroundColor: '#f6f8f6', justifyContent: 'center' }}>
      {/* Top App Bar */}
      <View style={styles.appBar}>
        <TouchableOpacity><MaterialIcons name="keyboard-arrow-down" size={36} color="#0e1b0e" /></TouchableOpacity>
        <Text style={styles.screenTitle}>Pest Advisory</Text>
        <View style={{ width: 40 }}>{/* Add icon? */}</View>
      </View>
      {/* Voice Visualizer */}
      <View style={styles.visualizerContainer}>
        <View style={[styles.visualizerCircle, styles.circle3]} />
        <View style={[styles.visualizerCircle, styles.circle2]} />
        <View style={[styles.visualizerCircle, styles.circle1]} />
        <View style={styles.visualizerCenter}><MaterialIcons name="graphic-eq" size={50} color="#fff" /></View>
      </View>
      {/* Speaking Status/Lang */}
      <View style={{ alignItems: 'center', marginTop: 14 }}>
        <Text style={{ color: '#0e1b0e', fontSize: 18, fontWeight: '500' }}>Speaking...</Text>
        <Text style={{ color: '#4CAF50', fontSize: 15, fontWeight: '500', marginTop: 2 }}>Playing in हिन्दी</Text>
      </View>
      {/* Progress Bar */}
      <View style={styles.progressSection}>
        <View style={styles.progressBg}>
          <View style={[styles.progressFill, { width: '45%' }]} />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
          <Text style={styles.progressLabel}>0:45</Text>
          <Text style={styles.progressLabel}>1:30</Text>
        </View>
      </View>
      {/* Playback Controls */}
      <View style={styles.ctrlRow}>
        <TouchableOpacity style={styles.ctrlCol}><MaterialIcons name="replay" size={34} color="#888" /><Text style={styles.ctrlText}>Replay</Text></TouchableOpacity>
        <TouchableOpacity style={styles.ctrlPause}><MaterialIcons name="pause" size={46} color="#fff" /></TouchableOpacity>
        <TouchableOpacity style={styles.ctrlCol}><MaterialIcons name="close" size={34} color="#888" /><Text style={styles.ctrlText}>Close</Text></TouchableOpacity>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  appBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f6f8f6', paddingTop: 32, paddingBottom: 7, paddingHorizontal: 13 },
  screenTitle: { flex: 1, color: '#0e1b0e', fontSize: 19, fontWeight: 'bold', textAlign: 'center' },
  visualizerContainer: { alignItems: 'center', justifyContent: 'center', position: 'relative', marginTop: 19 },
  visualizerCircle: { position: 'absolute', borderRadius: 9999, opacity: 0.26 },
  circle1: { width: 110, height: 110, backgroundColor: '#4CAF50' },
  circle2: { width: 170, height: 170, backgroundColor: '#4CAF5018', top: -30, left: -30 },
  circle3: { width: 230, height: 230, backgroundColor: '#4CAF5011', top: -60, left: -60 },
  visualizerCenter: { width: 65, height: 65, borderRadius: 33, backgroundColor: '#4CAF50', alignItems: 'center', justifyContent: 'center', zIndex: 20 },
  progressSection: { width: '88%', alignSelf: 'center', marginTop: 24 },
  progressBg: { width: '100%', height: 7, backgroundColor: '#e5e7eb', borderRadius: 6 },
  progressFill: { height: 7, borderRadius: 6, backgroundColor: '#4CAF50' },
  progressLabel: { fontSize: 12, color: '#888' },
  ctrlRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 29, gap: 39 },
  ctrlCol: { alignItems: 'center', gap: 2 },
  ctrlText: { fontSize: 12, color: '#888', fontWeight: '500', marginTop: 2 },
  ctrlPause: { backgroundColor: '#4CAF50', borderRadius: 40, width: 76, height: 76, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.13, shadowRadius: 7, elevation: 2 },
});
