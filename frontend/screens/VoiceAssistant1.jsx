import { MaterialIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { auth } from '../firebase';
import { payalChat, payalStartNewChat, transcribeAudio } from '../services/halApi';
import { useTranslation } from '../services/i18n';

// PAYAL Capabilities - What the chatbot can do
const PAYAL_CAPABILITIES = [
  {
    icon: 'eco',
    title: 'Crop Advice',
    description: 'Get crop recommendations based on your location and soil conditions',
    color: '#5c7e2b',
  },
  {
    icon: 'science',
    title: 'Fertilizer Advice',
    description: 'Learn about NPK requirements and fertilizer recommendations for crops',
    color: '#6B8E23',
  },
  {
    icon: 'grass',
    title: 'Soil Health',
    description: 'Get soil health diagnosis and improvement recommendations',
    color: '#498256',
  },
  {
    icon: 'wb-cloudy',
    title: 'Weather Forecast',
    description: 'Get weather forecasts and farming advice based on your location',
    color: '#4A90E2',
  },
  {
    icon: 'bug-report',
    title: 'Pest Information',
    description: 'Learn about pest detection and control methods',
    color: '#bb9a03',
  },
  {
    icon: 'account-balance',
    title: 'Government Schemes',
    description: 'Get information about government schemes and subsidies',
    color: '#3A5F0B',
  },
];

export default function VoiceAssistant1({ navigation }) {
  const { t, language } = useTranslation();
  const [recording, setRecording] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState(null); // Track which message is speaking
  const [messages, setMessages] = useState([]);
  const [currentResponse, setCurrentResponse] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [location, setLocation] = useState(null);
  const [inputText, setInputText] = useState('');
  const [showCapabilities, setShowCapabilities] = useState(true);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [payal2Active, setPayal2Active] = useState(false);
  const [payal2Loading, setPayal2Loading] = useState(false);
  
  const recordingRef = useRef(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const scrollViewRef = useRef(null);
  const recordingTimerRef = useRef(null);

  useEffect(() => {
    // Get user location
    getLocation();
    
    // Start new chat session
    initializeChat();
    
    // Cleanup on unmount
    return () => {
      Speech.stop();
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch(() => {});
      }
    };
  }, []);

  // Pulse animation when recording or Payal 2.0 is active
  useEffect(() => {
    if (isRecording || payal2Active) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.2,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isRecording, payal2Active, pulseAnim]);

  const getLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        console.warn('Location permission denied');
        return;
      }

      const pos = await Location.getCurrentPositionAsync({});
      setLocation({
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
      });
      console.log('📍 Location obtained:', pos.coords);
    } catch (error) {
      console.error('Error getting location:', error);
    }
  };

  const initializeChat = async () => {
    try {
      const uid = auth?.currentUser?.uid || 'anonymous';
      const response = await payalStartNewChat({ uid });
      if (response?.session_id) {
        setSessionId(response.session_id);
        console.log('✅ New chat session started:', response.session_id);
        
        // Add welcome message
        const welcomeMsg = {
          id: 'welcome',
          role: 'assistant',
          text: 'Hello! I am Payal — your friendly farmer advisory assistant. How can I help you today?',
          timestamp: new Date(),
        };
        setMessages([welcomeMsg]);
      }
    } catch (error) {
      console.error('Error initializing chat:', error);
    }
  };

  const talkWithPayal = async () => {
    try {
      setPayal2Loading(true);
      console.log('🎧 Starting Payal 2.0 redirect...');

      // Call backend to get LiveKit credentials
      const res = await fetch('https://theabeerrai-payal-2-0.hf.space/start', {
        method: 'POST',
      });

      const data = await res.json();

      if (!data.token) {
        console.error('Token missing!', data);
        Alert.alert('Error', 'No token received from server');
          return;
        }
        
      // Build LiveKit Playground URL
      const url =
        `https://payal-ngb1nq9k.livekit.cloud/playground` +
        `?token=${encodeURIComponent(data.token)}` +
        `&room=${encodeURIComponent(data.roomName || 'payal-room')}` +
        `&identity=${encodeURIComponent(data.identity || 'user')}`;

      console.log('🔗 Redirecting to LiveKit Playground:', url);

      // Open URL in browser (works on both web and mobile)
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
        console.log('✅ Redirected to LiveKit Playground');
              } else {
        Alert.alert('Error', 'Cannot open LiveKit Playground URL');
            }
          } catch (error) {
      console.error('❌ Failed to redirect to Payal 2.0:', error);
      Alert.alert(
        'Error',
        error?.message || 'Failed to start Payal 2.0. Please try again.'
      );
    } finally {
      setPayal2Loading(false);
    }
  };

  const startRecording = async () => {
    // For Payal 2.0, redirect to LiveKit Playground
    await talkWithPayal();
  };

  const stopRecording = async () => {
    try {
      // Reset Payal 2.0 state (since we redirect to Playground, this just resets UI)
      if (payal2Active) {
        setPayal2Active(false);
        setIsRecording(false);
        console.log('✅ Payal 2.0 state reset');
        return;
      }

      // Legacy recording stop
      if (!recording) return;

      // Clear timer
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }

      setIsRecording(false);
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      const duration = recordingDuration;
      setRecording(null);
      setRecordingDuration(0);

      if (uri) {
        console.log(`🎤 Recording stopped: duration=${duration}s, uri=${uri}`);
        await handleAudioInput(uri);
      }
    } catch (error) {
      console.error('Failed to stop recording:', error);
      setIsRecording(false);
      setPayal2Active(false);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      setRecordingDuration(0);
    }
  };

  const handleAudioInput = async (audioUri) => {
    try {
      setIsTranscribing(true);
      console.log('📝 Transcribing audio from:', audioUri);

      // Retry transcription with exponential backoff
      let lastError = null;
      const maxRetries = 3;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const transcription = await transcribeAudio({
            uri: audioUri,
            language: language || 'en',
          });

          const query = transcription?.text?.trim();
          const confidence = transcription?.confidence || 0;
          
          if (query) {
            console.log(`✅ Transcribed (attempt ${attempt}):`, query, `confidence: ${confidence.toFixed(2)}`);
            await sendMessage(query);
            return; // Success, exit retry loop
          } else {
            if (attempt === maxRetries) {
              Alert.alert('No Speech Detected', 'Could not detect any speech in the recording. Please try speaking clearer or check your microphone.');
            } else {
              console.log(`⚠️ No transcript on attempt ${attempt}, retrying...`);
              await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
          }
        } catch (error) {
          lastError = error;
          const isRetryable = error?.message?.includes('timeout') || 
                             error?.message?.includes('ECONNRESET') ||
                             error?.message?.includes('network');
          
          if (isRetryable && attempt < maxRetries) {
            const backoffDelay = 1000 * Math.pow(2, attempt - 1);
            console.warn(`⚠️ Transcription error on attempt ${attempt}, retrying in ${backoffDelay}ms...`, error.message);
            await new Promise(resolve => setTimeout(resolve, backoffDelay));
            continue;
          }
          
          // If not retryable or last attempt, throw
          if (!isRetryable || attempt === maxRetries) {
            throw error;
          }
        }
      }
    } catch (error) {
      console.error('Transcription error:', error);
      const errorMsg = error?.message || 'Failed to transcribe audio';
      let userMessage = 'Failed to transcribe audio.';
      
      if (errorMsg.includes('timeout') || errorMsg.includes('ECONNRESET')) {
        userMessage = 'Connection error. Please try recording again with a shorter clip (under 30 seconds).';
      } else if (errorMsg.includes('too large')) {
        userMessage = 'Audio recording is too long. Please record a shorter message (under 60 seconds).';
      }
      
      Alert.alert('Transcription Error', userMessage);
    } finally {
      setIsTranscribing(false);
    }
  };

  const sendMessage = async (text = null) => {
    const query = text || inputText.trim();
    if (!query) return;

    const uid = auth?.currentUser?.uid || 'anonymous';
    const userMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: query,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputText('');
    setShowCapabilities(false);
    setIsProcessing(true);

    try {
      console.log('🤖 Sending to Payal:', { query, uid, sessionId, language, location });

      const response = await payalChat({
        query,
        uid,
        sessionId,
        language: language || 'en',
        lat: location?.lat,
        lon: location?.lon,
      });

      if (response?.session_id && !sessionId) {
        setSessionId(response.session_id);
      }

      const assistantMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        text: response.response || 'I apologize, but I could not process your request.',
        timestamp: new Date(),
        intent: response.intent,
        endpoint: response.endpoint_used,
      };

      setMessages((prev) => [...prev, assistantMessage]);
      setCurrentResponse(assistantMessage);
      
      // Auto-speak the response
      speakResponse(assistantMessage.text);
    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        text: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsProcessing(false);
      // Scroll to bottom
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  };

  const speakMessage = (text, messageId) => {
    if (!text) return;
    
    try {
      const langCode = language === 'hi' ? 'hi-IN' : 'en-US';
      Speech.speak(text, {
        language: langCode,
        rate: 0.9,
        pitch: 1.0,
        onStart: () => {
          setIsSpeaking(true);
          setSpeakingMessageId(messageId);
        },
        onDone: () => {
          setIsSpeaking(false);
          setSpeakingMessageId(null);
        },
        onStopped: () => {
          setIsSpeaking(false);
          setSpeakingMessageId(null);
        },
      });
    } catch (error) {
      console.error('TTS error:', error);
      setIsSpeaking(false);
      setSpeakingMessageId(null);
    }
  };

  const toggleMessageSpeaking = (message) => {
    const isCurrentlySpeaking = speakingMessageId === message.id;
    
    if (isCurrentlySpeaking) {
      // Stop speaking
      Speech.stop();
      setIsSpeaking(false);
      setSpeakingMessageId(null);
    } else {
      // Stop any currently playing speech first
      Speech.stop();
      // Start speaking this message
      speakMessage(message.text, message.id);
    }
  };

  const speakResponse = (text) => {
    // Legacy function for auto-speaking responses
    speakMessage(text, currentResponse?.id || null);
  };

  const toggleSpeaking = () => {
    // Legacy function for current response button
    if (isSpeaking && speakingMessageId === currentResponse?.id) {
      Speech.stop();
      setIsSpeaking(false);
      setSpeakingMessageId(null);
    } else if (currentResponse?.text) {
      speakMessage(currentResponse.text, currentResponse.id);
    }
  };

  const handleQuickAction = (capability) => {
    const queries = {
      'Crop Advice': 'What crops should I grow in my area?',
      'Fertilizer Advice': 'What fertilizer should I use for wheat?',
      'Soil Health': 'How can I improve my soil health?',
      'Weather Forecast': 'What is the weather forecast for my location?',
      'Pest Information': 'How can I control pests in my crops?',
      'Government Schemes': 'What government schemes are available for farmers?',
    };
    
    const query = queries[capability.title] || capability.title;
    sendMessage(query);
  };

  return (
    <View style={styles.container}>
      {/* Top App Bar */}
      <View style={styles.appBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <MaterialIcons name="arrow-back" size={24} color="#2A5C3D" />
        </TouchableOpacity>
        <View style={styles.titleContainer}>
          <Text style={styles.screenTitle}>Payal AI Assistant</Text>
          <Text style={styles.subtitle}>Precision Agriculture & Yield Advisory</Text>
        </View>
        <TouchableOpacity onPress={initializeChat} style={styles.newChatBtn}>
          <MaterialIcons name="refresh" size={22} color="#2A5C3D" />
        </TouchableOpacity>
      </View>

      <ScrollView
        ref={scrollViewRef}
        style={styles.messagesContainer}
        contentContainerStyle={styles.messagesContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Capabilities Section */}
        {showCapabilities && messages.length <= 1 && (
          <View style={styles.capabilitiesSection}>
            <Text style={styles.capabilitiesTitle}>What can Payal help you with?</Text>
            <View style={styles.capabilitiesGrid}>
              {PAYAL_CAPABILITIES.map((cap, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={styles.capabilityCard}
                  onPress={() => handleQuickAction(cap)}
                >
                  <MaterialIcons name={cap.icon} size={28} color={cap.color} />
                  <Text style={styles.capabilityTitle}>{cap.title}</Text>
                  <Text style={styles.capabilityDesc}>{cap.description}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Messages */}
        {messages.map((msg) => {
          const isMessageSpeaking = speakingMessageId === msg.id;
          const canSpeak = msg.text && msg.text.trim().length > 0;
          
          return (
            <View
              key={msg.id}
              style={[
                styles.messageBubble,
                msg.role === 'user' ? styles.userBubble : styles.assistantBubble,
              ]}
            >
              <View style={styles.messageContent}>
                <Text
                  style={[
                    styles.messageText,
                    msg.role === 'user' ? styles.userText : styles.assistantText,
                  ]}
                >
                  {msg.text}
                </Text>
                {msg.intent && (
                  <Text style={styles.intentLabel}>
                    Intent: {msg.intent} • Endpoint: {msg.endpoint || 'unified'}
                  </Text>
                )}
              </View>
              {canSpeak && (
                <TouchableOpacity
                  style={[
                    styles.messageSpeakerButton,
                    isMessageSpeaking && styles.messageSpeakerButtonActive,
                  ]}
                  onPress={() => toggleMessageSpeaking(msg)}
                  activeOpacity={0.7}
                >
                  <MaterialIcons
                    name={isMessageSpeaking ? 'volume-up' : 'volume-off'}
                    size={16}
                    color={isMessageSpeaking 
                      ? (msg.role === 'user' ? '#fff' : '#2A5C3D')
                      : (msg.role === 'user' ? 'rgba(255,255,255,0.7)' : '#999')
                    }
                  />
                </TouchableOpacity>
              )}
            </View>
          );
        })}

        {/* Loading indicators */}
        {isTranscribing && (
          <View style={styles.loadingBubble}>
            <ActivityIndicator size="small" color="#2A5C3D" />
            <Text style={styles.loadingText}>Transcribing your voice...</Text>
          </View>
        )}

        {isProcessing && (
          <View style={styles.loadingBubble}>
            <ActivityIndicator size="small" color="#2A5C3D" />
            <Text style={styles.loadingText}>Payal is thinking...</Text>
          </View>
        )}
      </ScrollView>

      {/* Input Area */}
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.textInput}
          placeholder="Type your question or tap mic to speak..."
          placeholderTextColor="#999"
          value={inputText}
          onChangeText={setInputText}
          onSubmitEditing={() => sendMessage()}
          multiline
          maxLength={500}
          editable={!isProcessing && !isTranscribing}
        />
        <TouchableOpacity
          style={styles.sendButton}
          onPress={() => sendMessage()}
          disabled={!inputText.trim() || isProcessing}
        >
          <MaterialIcons name="send" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Voice Recording Area */}
      <View style={styles.waveArea}>
        <Animated.View style={[styles.waveContainer, { transform: [{ scale: pulseAnim }] }]}>
          {payal2Loading ? (
            <View style={styles.wavePlaceholder}>
              <ActivityIndicator size="small" color="#2A5C3D" />
              <Text style={styles.recordingStatus}>Starting Payal 2.0...</Text>
            </View>
          ) : payal2Active ? (
            <View style={styles.waveWrap}>
              {[0, 0.2, 0.4, 0.6, 0.8, 1.0].map((d, i) => (
                <View
                  key={i}
                  style={[
                    styles.waveBar,
                    { height: 30 + Math.sin(d * Math.PI * 2) * 20 },
                  ]}
                />
              ))}
              <Text style={styles.recordingStatus}>Payal 2.0 Active - Speak now</Text>
            </View>
          ) : isRecording ? (
            <View style={styles.waveWrap}>
              {[0, 0.2, 0.4, 0.6, 0.8, 1.0].map((d, i) => (
                <View
                  key={i}
                  style={[
                    styles.waveBar,
                    { height: 30 + Math.sin(d * Math.PI * 2) * 20 },
                  ]}
                />
              ))}
              {recordingDuration > 0 && (
                <Text style={styles.recordingTimer}>
                  {Math.floor(recordingDuration / 60)}:{(recordingDuration % 60).toString().padStart(2, '0')}
                </Text>
              )}
            </View>
          ) : isTranscribing ? (
            <View style={styles.wavePlaceholder}>
              <ActivityIndicator size="small" color="#2A5C3D" />
              <Text style={styles.recordingStatus}>Transcribing...</Text>
            </View>
          ) : (
            <View style={styles.wavePlaceholder} />
          )}
        </Animated.View>
      </View>

      {/* Bottom Actions */}
      <View style={styles.bottomActions}>
        <TouchableOpacity
          style={[
            styles.voiceButton,
            (isRecording || payal2Active) && styles.voiceButtonActive,
            (payal2Loading || isTranscribing || isProcessing) && styles.voiceButtonDisabled,
          ]}
          onPress={isRecording || payal2Active ? stopRecording : startRecording}
          disabled={payal2Loading || isTranscribing || isProcessing}
        >
          {payal2Loading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <MaterialIcons
              name={(isRecording || payal2Active) ? 'stop' : 'mic'}
              size={32}
              color={(isRecording || payal2Active) ? '#fff' : '#2A5C3D'}
            />
          )}
        </TouchableOpacity>

        {currentResponse && (
          <TouchableOpacity
            style={[styles.actionButton, isSpeaking && styles.actionButtonActive]}
            onPress={toggleSpeaking}
          >
            <MaterialIcons
              name={isSpeaking ? 'volume-up' : 'volume-off'}
              size={20}
              color={isSpeaking ? '#fff' : '#2A5C3D'}
            />
            <Text style={[styles.actionButtonText, isSpeaking && styles.actionButtonTextActive]}>
              {isSpeaking ? 'Stop' : 'Speak'}
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => setShowCapabilities(!showCapabilities)}
        >
          <MaterialIcons name="lightbulb" size={20} color="#2A5C3D" />
          <Text style={styles.actionButtonText}>Suggestions</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5DC',
  },
  appBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingTop: 50,
    paddingHorizontal: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderColor: '#E0E0E0',
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleContainer: {
    flex: 1,
    marginLeft: 8,
  },
  screenTitle: {
    color: '#212121',
    fontWeight: 'bold',
    fontSize: 20,
  },
  subtitle: {
    color: '#666',
    fontSize: 12,
    marginTop: 2,
  },
  newChatBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messagesContainer: {
    flex: 1,
  },
  messagesContent: {
    padding: 16,
    paddingBottom: 200,
  },
  capabilitiesSection: {
    marginBottom: 20,
  },
  capabilitiesTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2A5C3D',
    marginBottom: 12,
    textAlign: 'center',
  },
  capabilitiesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'space-between',
  },
  capabilityCard: {
    width: '48%',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  capabilityTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 8,
    marginBottom: 4,
    textAlign: 'center',
  },
  capabilityDesc: {
    fontSize: 11,
    color: '#666',
    textAlign: 'center',
    lineHeight: 16,
  },
  messageBubble: {
    maxWidth: '80%',
    padding: 12,
    borderRadius: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  messageContent: {
    flex: 1,
  },
  messageSpeakerButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    backgroundColor: 'transparent',
  },
  messageSpeakerButtonActive: {
    backgroundColor: 'rgba(42, 92, 61, 0.1)',
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#2A5C3D',
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  messageText: {
    fontSize: 15,
    lineHeight: 20,
  },
  userText: {
    color: '#fff',
  },
  assistantText: {
    color: '#333',
  },
  intentLabel: {
    fontSize: 10,
    color: '#999',
    marginTop: 4,
    fontStyle: 'italic',
  },
  loadingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    backgroundColor: '#fff',
    borderRadius: 16,
    marginBottom: 12,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  loadingText: {
    fontSize: 14,
    color: '#666',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
    gap: 8,
  },
  textInput: {
    flex: 1,
    backgroundColor: '#F5F5DC',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#2A5C3D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  waveArea: {
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F5F5DC',
  },
  waveContainer: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  waveWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  waveBar: {
    width: 8,
    backgroundColor: '#2A5C3D',
    borderRadius: 4,
    marginHorizontal: 2,
  },
  wavePlaceholder: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#e0e0e0',
    opacity: 0.3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingTimer: {
    marginTop: 8,
    fontSize: 14,
    fontWeight: 'bold',
    color: '#2A5C3D',
  },
  recordingStatus: {
    marginTop: 8,
    fontSize: 12,
    color: '#666',
  },
  bottomActions: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 20,
    backgroundColor: '#F5F5DC',
  },
  voiceButton: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: '#fff',
    borderWidth: 3,
    borderColor: '#2A5C3D',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  voiceButtonActive: {
    backgroundColor: '#2A5C3D',
    borderColor: '#1a3d28',
  },
  voiceButtonDisabled: {
    opacity: 0.5,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#2A5C3D',
  },
  actionButtonActive: {
    backgroundColor: '#2A5C3D',
    borderColor: '#1a3d28',
  },
  actionButtonText: {
    color: '#2A5C3D',
    fontWeight: '600',
    fontSize: 14,
  },
  actionButtonTextActive: {
    color: '#fff',
  },
});
