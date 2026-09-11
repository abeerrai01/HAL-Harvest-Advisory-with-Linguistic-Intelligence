import { MaterialIcons } from '@expo/vector-icons';
import {
  AudioModule,
  createAudioPlayer,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import * as Speech from 'expo-speech';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { createGeminiLiveConnection } from '../services/halApi';
import { useTranslation } from '../services/i18n';

export default function DiseaseChat({ route, navigation }) {
  const { t, language } = useTranslation(); // Get user's language from i18n context
  const { disease_label = 'Unknown disease', context = '' } = route?.params || {};
  const [messages, setMessages] = useState([
    { id: 'sys-1', role: 'assistant', text: t('diseaseChat.initialMessage', { disease: disease_label }) },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [recording, setRecording] = useState(null);
  const recordingRef = useRef(null);
  const [speaking, setSpeaking] = useState(false);
  const [speakingId, setSpeakingId] = useState(null);
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isLiveSession, setIsLiveSession] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const wsRef = useRef(null);
  const recordingIntervalRef = useRef(null);
  const audioChunksRef = useRef([]);
  const soundRef = useRef(null);

  useEffect(() => {
    navigation?.setOptions?.({ headerShown: true, title: t('diseaseChat.title') });
    return () => {
      Speech.stop();
      // Cleanup WebSocket and recording on unmount
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (recordingRef.current) {
        try {
          recordingRef.current.stop().catch(() => {});
        } catch (e) {}
      }
      if (soundRef.current) {
        try {
          soundRef.current.pause();
          soundRef.current.remove();
        } catch (e) {}
      }
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
      }
    };
  }, [navigation]);

  // Recording animation - continuous loop during live session
  useEffect(() => {
    if (isLiveSession) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.3,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isLiveSession, pulseAnim]);

  const speak = (text) => {
    if (!text) return;
    Speech.stop();
    Speech.speak(text, { language: language === 'hi' ? 'hi-IN' : 'en-US', rate: 1.0, pitch: 1.0 });
  };

  const toggleSpeak = async (text, msgId = null) => {
    try {
      const is = await Speech.isSpeakingAsync();
      if (is && speaking && speakingId === msgId) {
        await Speech.stop();
        setSpeaking(false);
        setSpeakingId(null);
        return;
      }
      setSpeaking(true);
      setSpeakingId(msgId);
      Speech.speak(String(text||''), {
        language: language === 'hi' ? 'hi-IN' : 'en-US',
        rate: 1.0,
        pitch: 1.0,
        onDone: () => { setSpeaking(false); setSpeakingId(null); },
        onStopped: () => { setSpeaking(false); setSpeakingId(null); }
      });
    } catch {}
  };

  const sendQuestion = async (q) => {
    const question = (q ?? input).trim();
    if (!question) return;
    const userMsg = { id: `u-${Date.now()}`, role: 'user', text: question };
    setMessages((m) => [...m, userMsg]);
    setInput('');
    setLoading(true);
    try {
      const history = messages.map(({ role, text }) => ({ role, text })).concat([{ role: 'user', text: question }]);
      const resp = await diseaseChat({ disease_label, question, context, history, language });
      const answer = resp?.answer || t('diseaseChat.noResponse');
      const botMsg = { id: `a-${Date.now()}`, role: 'assistant', text: answer };
      setMessages((m) => [...m, botMsg]);
      speak(answer);
    } catch (e) {
      const errMsg = { id: `e-${Date.now()}`, role: 'assistant', text: t('diseaseChat.errorMessage') };
      setMessages((m) => [...m, errMsg]);
    } finally {
      setLoading(false);
    }
  };

  const startRecording = async () => {
    try {
      console.log('🎤 Starting Gemini Live voice interaction...');
      
      // Request permissions
      const permissionResponse = await requestRecordingPermissionsAsync();
      if (permissionResponse.status !== 'granted') {
        Alert.alert(t('common.error'), t('diseaseChat.permissionDenied') || 'Microphone permission is required');
        return;
      }
      
      // Set audio mode
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      
      // Create WebSocket connection to Gemini Live
      wsRef.current = createGeminiLiveConnection({
        disease_label,
        context,
        language,
        onMessage: (message) => {
          console.log('📨 Gemini message:', message.type);
          
          if (message.type === 'connected') {
            console.log('✅ Ready for live voice interaction');
            setIsLiveSession(true);
            // Start continuous recording loop
            startContinuousRecording();
          } else if (message.type === 'gemini_closed') {
            console.log('⚠️ Gemini closed, will reconnect:', message.reason);
            // Keep session alive, backend will reconnect
          } else if (message.type === 'text') {
            // Handle text response from Gemini
            const botMsg = { id: `a-${Date.now()}`, role: 'assistant', text: message.text };
            setMessages((m) => [...m, botMsg]);
            // Don't speak automatically - let audio response play instead
          } else if (message.type === 'response') {
            // Handle structured response
            if (message.data?.model_turn?.parts) {
              for (const part of message.data.model_turn.parts) {
                if (part.text) {
                  const botMsg = { id: `a-${Date.now()}`, role: 'assistant', text: part.text };
                  setMessages((m) => [...m, botMsg]);
                }
              }
            }
          } else if (message.type === 'audio') {
            // Handle audio response - play it immediately
            if (message.data) {
              playAudioResponse(message.data, message.mimeType || 'audio/pcm');
            } else {
              console.warn('⚠️ Received audio message but data is undefined');
            }
          } else if (message.type === 'interrupted') {
            // Handle interruption - stop current playback
            Speech.stop();
            setSpeaking(false);
          } else if (message.type === 'error') {
            console.error('❌ Error from backend:', message);
            // If it's a permanent error, stop the session
            if (message.permanent) {
              Alert.alert(t('common.error'), message.message || 'Configuration error. Please try again later.');
              stopRecording();
            } else if (!message.reconnect) {
              // Non-permanent error without reconnect flag
              Alert.alert(t('common.error'), message.message || 'Connection error');
              stopRecording();
            }
            // Otherwise, let it reconnect automatically
          }
        },
        onError: (error) => {
          console.error('❌ WebSocket error:', error);
          Alert.alert(t('common.error'), 'Connection failed. Please try again.');
          stopRecording();
        },
        onClose: () => {
          console.log('🔌 WebSocket closed');
          // Only handle close if we're in a live session
          // Don't auto-reconnect - let user manually restart if needed
          if (isLiveSession) {
            console.log('⚠️ WebSocket closed during live session');
            // Keep session state but mark connection as closed
            // User can manually restart if needed
          }
        }
      });
      
      setRecording(true);
    } catch (e) {
      console.error('❌ Start error:', e);
      Alert.alert(t('common.error'), e?.message || t('diseaseChat.recordingError') || 'Failed to start');
    }
  };
  
  const startContinuousRecording = async () => {
    try {
      console.log('🎙️ Starting live audio streaming session...');
      
      // Ensure audio mode is set correctly
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      
      // Create recording object using expo-audio
      console.log('📝 Creating recording object...');
      const recording = new AudioModule.AudioRecorder(RecordingPresets.HIGH_QUALITY);
      await recording.prepareToRecordAsync();
      recording.record();
      
      console.log('✅ Recording is ready');
      recordingRef.current = recording;
      
      // Stream audio continuously - record in 1-second chunks and send immediately
      let chunkCounter = 0;
      let isStreaming = false;
      
      const streamChunk = async () => {
        // Prevent overlapping chunk processing
        if (isStreaming) return;
        
        try {
          if (wsRef.current?.readyState === WebSocket.OPEN && recordingRef.current) {
            isStreaming = true;
            
            if (recordingRef.current?.isRecording) {
              // Stop current recording chunk
              await recordingRef.current.stop();
              const uri = recordingRef.current.uri;
              
              if (uri) {
                // Convert audio file to base64 for streaming using expo-file-system
                try {
                  // Read file as base64 - use options object format
                  const base64Audio = await FileSystem.readAsStringAsync(uri, {
                    encoding: FileSystem.EncodingType.Base64,
                  });
                  
                  // Send audio chunk to backend immediately
                  if (wsRef.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify({
                      type: 'audio',
                      data: base64Audio,
                      mimeType: 'audio/m4a',
                      chunkIndex: chunkCounter++
                    }));
                    console.log(`📤 Sent audio chunk ${chunkCounter} (${base64Audio.length} bytes)`);
                  }
                  
                  // Clean up the temporary file
                  try {
                    await FileSystem.deleteAsync(uri, { idempotent: true });
                  } catch (deleteError) {
                    // Ignore delete errors
                  }
                } catch (readError) {
                  console.error('❌ Error reading audio file:', readError);
                }
              }
              
              // Start new recording chunk immediately for continuous streaming
              try {
                const newRecording = new AudioModule.AudioRecorder(RecordingPresets.HIGH_QUALITY);
                await newRecording.prepareToRecordAsync();
                newRecording.record();
                recordingRef.current = newRecording;
              } catch (createError) {
                console.error('❌ Error creating new recording:', createError);
                // Stop the streaming interval if we can't create new recordings
                if (recordingIntervalRef.current) {
                  clearInterval(recordingIntervalRef.current);
                  recordingIntervalRef.current = null;
                }
                throw createError;
              }
            }
          }
        } catch (e) {
          console.error('❌ Error in streaming chunk:', e);
        } finally {
          isStreaming = false;
        }
      };
      
      // Stream chunks every 1000ms (1 second) for continuous live interaction
      // This creates a continuous streaming session without manual start/stop
      recordingIntervalRef.current = setInterval(streamChunk, 1000);
      
      console.log('✅ Live streaming session started');
    } catch (e) {
      console.error('❌ Error starting live streaming:', e);
      console.error('❌ Error details:', {
        message: e.message,
        stack: e.stack,
      });
      
      // Clean up if recording was created
      if (recordingRef.current) {
        try {
          await recordingRef.current.stop();
        } catch (cleanupError) {
          console.error('❌ Error cleaning up recording:', cleanupError);
        }
        recordingRef.current = null;
      }
      
      // Show user-friendly error
      const errorMessage = e.message?.includes('not prepared') 
        ? 'Audio recording is not ready. Please try again.' 
        : e.message || 'Failed to start live streaming';
      
      Alert.alert(
        t('common.error'), 
        errorMessage,
        [
          { text: 'OK', onPress: () => {
            // Stop the session if it failed to start
            setIsLiveSession(false);
            setRecording(null);
          }}
        ]
      );
    }
  };
  
  const playAudioResponse = async (base64Audio, mimeType) => {
    try {
      console.log('🔊 Playing audio response from Gemini');
      
      // Validate input
      if (!base64Audio) {
        console.error('❌ No base64 audio data provided');
        return;
      }
      
      if (typeof base64Audio !== 'string') {
        console.error('❌ Audio data is not a string:', typeof base64Audio);
        return;
      }
      
      // Convert base64 to audio URI and play
      const audioUri = `${FileSystem.cacheDirectory}gemini_audio_${Date.now()}.${mimeType?.includes('pcm') ? 'wav' : 'm4a'}`;
      
      // Write base64 to file
      // Note: writeAsStringAsync - use options object format
      await FileSystem.writeAsStringAsync(audioUri, base64Audio, {
        encoding: FileSystem.EncodingType.Base64,
      });
      
      // Stop any previous sound
      if (soundRef.current) {
        try {
          soundRef.current.pause();
          soundRef.current.remove();
        } catch (e) {}
        soundRef.current = null;
      }
      
      // Create and play sound using expo-audio
      const player = createAudioPlayer(audioUri);
      soundRef.current = player;
      setSpeaking(true);
      player.play();
      
      // Clean up after playback
      player.addListener('playbackStatusUpdate', (status) => {
        if (status.didJustFinish) {
          try {
            player.remove();
          } catch (e) {}
          FileSystem.deleteAsync(audioUri, { idempotent: true }).catch(() => {});
          setSpeaking(false);
          if (soundRef.current === player) {
            soundRef.current = null;
          }
        }
      });
    } catch (e) {
      console.error('❌ Error playing audio:', e);
      setSpeaking(false);
    }
  };

  const stopRecording = async () => {
    try {
      console.log('🛑 Stopping Gemini Live interaction...');
      
      // Stop continuous recording interval
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
        recordingIntervalRef.current = null;
      }
      
      // Stop recording
      if (recordingRef.current) {
        try {
          await recordingRef.current.stop();
        } catch (e) {
          console.warn('⚠️ Error stopping recording:', e);
        }
        recordingRef.current = null;
      }
      
      // Close WebSocket connection
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      
      setRecording(null);
      setIsLiveSession(false);
      setIsTranscribing(false);
      audioChunksRef.current = [];
      
      // Stop any playing audio
      if (soundRef.current) {
        try {
          soundRef.current.pause();
          soundRef.current.remove();
        } catch (e) {}
        soundRef.current = null;
      }
      Speech.stop();
      setSpeaking(false);
      
      console.log('✅ Stopped Gemini Live interaction');
    } catch (e) {
      console.error('❌ Stop error:', e);
      setRecording(null);
      setIsLiveSession(false);
    }
  };

  const toggleExpand = (id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const renderItem = ({ item }) => {
    const isAssistant = item.role !== 'user';
    const expanded = expandedIds.has(item.id);
    const cardStyle = [styles.card, isAssistant ? styles.cardBot : styles.cardUser];
    return (
      <View style={cardStyle}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>{isAssistant ? t('diseaseChat.assistant') : t('diseaseChat.you')}</Text>
          <TouchableOpacity onPress={() => toggleSpeak(item.text, item.id)}>
            <MaterialIcons name="volume-up" size={26} color={speaking && speakingId===item.id ? '#2E7D32' : '#3A5C3D'} />
          </TouchableOpacity>
        </View>
        <Text style={styles.cardText} numberOfLines={expanded ? 0 : 4}>{item.text}</Text>
        {item.text && item.text.length > 180 && (
          <TouchableOpacity style={styles.viewDetailsBtn} onPress={() => toggleExpand(item.id)}>
            <Text style={styles.viewDetailsTxt}>{expanded ? t('diseaseChat.hideDetails') : t('diseaseChat.viewDetails')}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: '#F5F5DC' }}>
      <View style={styles.appBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 6 }}>
          <MaterialIcons name="arrow-back" size={26} color="#212121" />
        </TouchableOpacity>
        <Text style={styles.title}>{t('pestDisease.askAboutDisease', { disease: disease_label })}</Text>
        <TouchableOpacity onPress={() => {
          const last = [...messages].reverse().find(m => m.role !== 'user');
          if (last) toggleSpeak(last.text, last.id);
        }} style={{ padding: 6 }}>
          <MaterialIcons name="volume-up" size={26} color={speaking && speakingId && messages.find(m => m.id===speakingId)?.role !== 'user' ? '#2E7D32' : '#3A5C3D'} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={messages}
        keyExtractor={(i) => i.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 14, paddingBottom: 100, gap: 10 }}
      />

      <View style={styles.inputBar}>
        <TextInput
          placeholder={t('diseaseChat.typeMessage')}
          value={input}
          onChangeText={setInput}
          style={styles.textInput}
          placeholderTextColor="#777"
        />
        {!isLiveSession && (
          <TouchableOpacity disabled={loading} onPress={() => sendQuestion()} style={styles.sendBtn}>
            {loading ? <ActivityIndicator color="#fff" /> : <MaterialIcons name="send" size={20} color="#fff" />}
          </TouchableOpacity>
        )}
        {isLiveSession ? (
          // Show only "End" button during live session
          <TouchableOpacity
            onPress={stopRecording}
            style={[styles.micBtn, styles.endButton]}
          >
            <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
              <MaterialIcons name="stop" size={22} color="#fff" />
            </Animated.View>
          </TouchableOpacity>
        ) : (
          // Show "Start" button when not in live session
          <TouchableOpacity
            onPress={startRecording}
            disabled={loading}
            style={styles.micBtn}
          >
            <MaterialIcons name="mic" size={22} color="#2A5C3D" />
          </TouchableOpacity>
        )}
        {isLiveSession && (
          <View style={styles.recordingIndicator}>
            <Animated.View style={[styles.recordingDot, { transform: [{ scale: pulseAnim }] }]} />
            <Text style={styles.recordingText}>{t('diseaseChat.liveSession') || 'Live Session'}</Text>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  appBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', paddingTop: 34, paddingHorizontal: 12, paddingBottom: 10, borderBottomWidth: 1, borderColor: '#E0E0E0' },
  title: { flex: 1, fontWeight: 'bold', fontSize: 18, color: '#212121', marginLeft: 8 },
  card: { width: '94%', alignSelf: 'center', backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#E0E0E0', padding: 12, marginVertical: 6 },
  cardUser: { backgroundColor: '#F3F9F0' },
  cardBot: { backgroundColor: '#fff' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  cardTitle: { fontWeight: '700', color: '#2A5C3D' },
  cardText: { color: '#212121', fontSize: 15 },
  viewDetailsBtn: { marginTop: 8, alignSelf: 'flex-start', backgroundColor: '#EEEEEE', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  viewDetailsTxt: { color: '#212121', fontWeight: '700' },
  inputBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 10, borderTopWidth: 1, borderColor: '#E0E0E0' },
  textInput: { flex: 1, backgroundColor: '#F3F4F6', borderRadius: 10, paddingHorizontal: 12, height: 44, color: '#111827' },
  sendBtn: { marginLeft: 8, backgroundColor: '#2A5C3D', borderRadius: 10, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  micBtn: { marginLeft: 8, backgroundColor: '#2A5C3D22', borderRadius: 10, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#2A5C3D55' },
  micActive: { backgroundColor: '#E53935', borderColor: '#B71C1C' },
  endButton: { backgroundColor: '#E53935', borderColor: '#B71C1C', borderWidth: 2 },
  recordingIndicator: { position: 'absolute', bottom: 60, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: 'rgba(229, 57, 53, 0.1)', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, marginHorizontal: 20 },
  recordingDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#E53935' },
  recordingText: { color: '#E53935', fontWeight: '700', fontSize: 13 },
});


