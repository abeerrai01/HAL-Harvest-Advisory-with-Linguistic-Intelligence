// Register LiveKit globals for React Native WebRTC support
// This MUST be called BEFORE any imports that use LiveKit
// Register at the very top to ensure it runs before module imports
try {
  const { registerGlobals } = require('@livekit/react-native-webrtc');
  registerGlobals();
  console.log('✅ LiveKit WebRTC globals registered at app startup');
} catch (error) {
  // Silently fail - might not be available in all environments (e.g., Expo Go)
  // VoiceAssistant1 will also try to register, so this is just a safety measure
}

import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { onAuthStateChanged } from 'firebase/auth';
import React, { useEffect, useState } from 'react';
import { auth } from './firebase';
import CropAdvisorySection from './screens/CropAdvisorySection';
import Dashboard from './screens/Dashboard';
import DiseaseChat from './screens/DiseaseChat';
import FarmerDashboard from './screens/FarmerDashboard';
import GovernmentSchemes from './screens/GovernmentSchemes';
import LanguageSelection from './screens/LanguageSelection';
import Login from './screens/Login';
import MarketPrices from './screens/MarketPrices';
import MarketPricesWithPredictedSellDate from './screens/MarketPricesWithPredictedSellDate';
import PestAndDisease from './screens/PestAndDisease';
import Profile from './screens/Profile';
import SchemeChat from './screens/SchemeChat';
import Signup from './screens/Signup';
import SoilHealth from './screens/SoilHealth';
import SplashLogin from './screens/SplashLogin';
import VoiceAssistant1 from './screens/VoiceAssistant1';
import VoiceAssistant2 from './screens/VoiceAssistant2';
import WeatherAlerts from './screens/WeatherAlerts';
import { I18nProvider } from './services/i18n';

const Tab = createBottomTabNavigator();
const RootStack = createNativeStackNavigator();

function MainTabs() {
  return (
    <Tab.Navigator
      initialRouteName="Dashboard"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#2A5B30',
      }}
    >
      <Tab.Screen
        name="Dashboard"
        component={Dashboard}
        options={{
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="home" size={size ?? 24} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Crop Advisory"
        component={CropAdvisorySection}
        options={{
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="agriculture" size={size ?? 24} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Market Prices"
        component={MarketPrices}
        options={{
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="show-chart" size={size ?? 24} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Soil Health"
        component={SoilHealth}
        options={{
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="layers" size={size ?? 24} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Pest & Disease"
        component={PestAndDisease}
        options={{
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="pest-control" size={size ?? 24} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

export default function App() {
  const [initialRoute, setInitialRoute] = useState(null);

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const loggedIn = await AsyncStorage.getItem('hal_logged_in');
        if (loggedIn) {
          setInitialRoute('MainTabs');
          return;
        }
        setInitialRoute('SplashLogin');
      } catch (e) {
        setInitialRoute('SplashLogin');
      }
    };
    bootstrap();

    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        await AsyncStorage.setItem('hal_logged_in', 'true');
      } else {
        await AsyncStorage.removeItem('hal_logged_in');
      }
    });
    return () => unsub();
  }, []);

  if (!initialRoute) return null;

  return (
    <I18nProvider>
      <NavigationContainer>
        <RootStack.Navigator screenOptions={{ headerShown: false }} initialRouteName={initialRoute}>
        <RootStack.Screen name="Language" component={LanguageSelection} />
        <RootStack.Screen name="SplashLogin" component={SplashLogin} />
        <RootStack.Screen name="Login" component={Login} />
        <RootStack.Screen name="Signup" component={Signup} />
        <RootStack.Screen name="MainTabs" component={MainTabs} />
        <RootStack.Screen name="Profile" component={Profile} options={{ animation: 'slide_from_right' }} />
        <RootStack.Screen name="MarketPricesWithPredictedSellDate" component={MarketPricesWithPredictedSellDate} />
        <RootStack.Screen name="Weather Alerts" component={WeatherAlerts} />
        <RootStack.Screen name="Voice Assistant" component={VoiceAssistant1} />
        <RootStack.Screen name="VoiceAssistant2" component={VoiceAssistant2} />
        <RootStack.Screen name="FarmerDashboard" component={FarmerDashboard} />
        <RootStack.Screen name="DiseaseChat" component={DiseaseChat} options={{ headerShown: true, title: 'Disease Chat' }} />
        <RootStack.Screen name="CropAdvisory1" component={CropAdvisorySection} />
        <RootStack.Screen name="Government Schemes" component={GovernmentSchemes} options={{ headerShown: false }} />
        <RootStack.Screen name="SchemeChat" component={SchemeChat} options={{ headerShown: false }} />
      </RootStack.Navigator>
    </NavigationContainer>
    </I18nProvider>
  );
}
