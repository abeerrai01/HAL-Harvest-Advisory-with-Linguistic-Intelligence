import { MaterialIcons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { auth } from '../firebase';
import { getGovernmentSchemes } from '../services/halApi';
import { useTranslation } from '../services/i18n';

export default function SchemeChat({ navigation, route }) {
  const { t } = useTranslation();
  const { scheme, sessionId, locationName, lat, lon } = route?.params || {};
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollViewRef = useRef(null);
  const [initialized, setInitialized] = useState(false);

  const sendMessage = useCallback(async (text, isInitial = false) => {
    if (!text.trim() && !isInitial) return;

    const uid = auth?.currentUser?.uid;
    if (!uid) {
      Alert.alert(t('common.error') || 'Error', 'Please login to continue');
      return;
    }

    // Add user message
    const userMessage = {
      type: 'user',
      text: text.trim(),
      timestamp: new Date(),
    };

    if (!isInitial) {
      setMessages((prev) => [...prev, userMessage]);
      setInputText('');
    }

    // Add loading message
    const loadingMessage = {
      type: 'loading',
      text: '...',
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, loadingMessage]);

    setLoading(true);

    try {
      // Build query with scheme context
      let query = text.trim();
      if (scheme && scheme.name) {
        query = `${query} about ${scheme.name}`;
      }

      const response = await getGovernmentSchemes({
        query,
        uid,
        sessionId: sessionId || 'scheme_chat_' + Date.now(),
        locationName,
        lat,
        lon,
      });

      // Remove loading message
      setMessages((prev) => prev.filter((msg) => msg.type !== 'loading'));

      // Add AI response
      if (response?.schemes && Array.isArray(response.schemes)) {
        // If we got scheme array, format it nicely
        const schemeText = response.schemes
          .map((s, idx) => `${idx + 1}. ${s.name}: ${s.benefits || ''}`)
          .join('\n\n');
        
        const aiMessage = {
          type: 'ai',
          text: schemeText,
          schemes: response.schemes,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, aiMessage]);
      } else if (response?.schemes?.raw_response) {
        const aiMessage = {
          type: 'ai',
          text: response.schemes.raw_response,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, aiMessage]);
      } else {
        const aiMessage = {
          type: 'ai',
          text: 'I apologize, but I could not find relevant information. Please try rephrasing your question.',
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, aiMessage]);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      
      // Remove loading message
      setMessages((prev) => prev.filter((msg) => msg.type !== 'loading'));

      const errorMessage = {
        type: 'ai',
        text: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  }, [scheme, sessionId, locationName, lat, lon, t]);

  useEffect(() => {
    // Initialize with scheme context only once
    if (scheme && !initialized) {
      setInitialized(true);
      const initialMessage = {
        type: 'user',
        text: `Tell me more about ${scheme.name}`,
      };
      setMessages([initialMessage]);
      sendMessage(initialMessage.text, true);
    }
  }, [scheme, initialized, sendMessage]);

  useEffect(() => {
    // Scroll to bottom when new messages arrive
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }, [messages]);

  const handleSend = () => {
    if (inputText.trim() && !loading) {
      sendMessage(inputText);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <MaterialIcons name="arrow-back" size={24} color="#3A5F0B" />
        </TouchableOpacity>
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {scheme?.name || 'Scheme Chat'}
          </Text>
          {locationName && (
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {locationName}
            </Text>
          )}
        </View>
        <View style={{ width: 40 }} />
      </View>

      {/* Messages */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.messagesContainer}
        contentContainerStyle={styles.messagesContent}
      >
        {messages.map((message, index) => {
          if (message.type === 'loading') {
            return (
              <View key={index} style={styles.messageRow}>
                <View style={[styles.messageBubble, styles.aiMessage]}>
                  <ActivityIndicator size="small" color="#3A5F0B" />
                </View>
              </View>
            );
          }

          return (
            <View
              key={index}
              style={[
                styles.messageRow,
                message.type === 'user' ? styles.userMessageRow : styles.aiMessageRow,
              ]}
            >
              <View
                style={[
                  styles.messageBubble,
                  message.type === 'user' ? styles.userMessage : styles.aiMessage,
                ]}
              >
                <Text
                  style={[
                    styles.messageText,
                    message.type === 'user' ? styles.userMessageText : styles.aiMessageText,
                  ]}
                >
                  {message.text}
                </Text>
                {message.schemes && Array.isArray(message.schemes) && message.schemes.length > 0 && (
                  <View style={styles.schemesList}>
                    {message.schemes.map((s, idx) => (
                      <TouchableOpacity
                        key={idx}
                        style={styles.schemeItem}
                        onPress={() => {
                          // Navigate to scheme details or continue chat
                          Alert.alert(s.name, s.benefits || 'No details available');
                        }}
                      >
                        <MaterialIcons name="account-balance" size={20} color="#3A5F0B" />
                        <View style={styles.schemeItemContent}>
                          <Text style={styles.schemeItemName}>{s.name}</Text>
                          {s.benefits && (
                            <Text style={styles.schemeItemBenefits} numberOfLines={2}>
                              {s.benefits}
                            </Text>
                          )}
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            </View>
          );
        })}
      </ScrollView>

      {/* Input */}
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder={t('schemeChat.typeMessage') || 'Type your message...'}
          placeholderTextColor="#999"
          value={inputText}
          onChangeText={setInputText}
          onSubmitEditing={handleSend}
          multiline
          maxLength={500}
          editable={!loading}
        />
        <TouchableOpacity
          style={[styles.sendButton, loading && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={loading || !inputText.trim()}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <MaterialIcons name="send" size={20} color="#fff" />
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5DC',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 16,
    backgroundColor: '#F5F5DC',
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleContainer: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#3A5F0B',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  messagesContainer: {
    flex: 1,
  },
  messagesContent: {
    padding: 16,
    paddingBottom: 32,
  },
  messageRow: {
    marginBottom: 12,
  },
  userMessageRow: {
    alignItems: 'flex-end',
  },
  aiMessageRow: {
    alignItems: 'flex-start',
  },
  messageBubble: {
    maxWidth: '80%',
    padding: 12,
    borderRadius: 16,
  },
  userMessage: {
    backgroundColor: '#3A5F0B',
  },
  aiMessage: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  messageText: {
    fontSize: 15,
    lineHeight: 20,
  },
  userMessageText: {
    color: '#fff',
  },
  aiMessageText: {
    color: '#333',
  },
  schemesList: {
    marginTop: 12,
    gap: 8,
  },
  schemeItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 10,
    backgroundColor: '#ecf5ec',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#acdca1',
  },
  schemeItemContent: {
    flex: 1,
  },
  schemeItemName: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#3A5F0B',
    marginBottom: 4,
  },
  schemeItemBenefits: {
    fontSize: 12,
    color: '#555',
    lineHeight: 16,
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
  input: {
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
    backgroundColor: '#3A5F0B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
});

