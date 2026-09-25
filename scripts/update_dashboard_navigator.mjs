import fs from 'fs';
import path from 'path';

const targetPath = path.resolve('../HyroxHeroMobile/src/navigation/DashboardNavigator.tsx');

const content = `import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { DashboardScreen } from '../screens/main/DashboardScreen';
import { RaceCalculatorScreen } from '../screens/main/RaceCalculatorScreen';
import { FAQScreen } from '../screens/main/FAQScreen';
import { HyroxEventsScreen } from '../screens/main/HyroxEventsScreen';
import { Colors } from '../constants/theme';

export type DashboardStackParamList = {
  DashboardMain: undefined;
  RaceCalculator: undefined;
  FAQ: undefined;
  HyroxEvents: undefined;
};

const Stack = createNativeStackNavigator<DashboardStackParamList>();

export const DashboardNavigator = () => {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen 
        name="DashboardMain" 
        component={DashboardScreen}
      />
      <Stack.Screen
        name="HyroxEvents"
        component={HyroxEventsScreen}
        options={{
          presentation: 'fullScreenModal',
          animation: 'slide_from_bottom',
        }}
      />
      <Stack.Screen
        name="RaceCalculator"
        component={RaceCalculatorScreen}
        options={{
          presentation: 'fullScreenModal',
          animation: 'slide_from_bottom',
        }}
      />
      <Stack.Screen
        name="FAQ"
        component={FAQScreen}
        options={{
          presentation: 'fullScreenModal',
          animation: 'slide_from_bottom',
        }}
      />
    </Stack.Navigator>
  );
};
`;

fs.writeFileSync(targetPath, content, 'utf8');
console.log('✅ Updated src/navigation/DashboardNavigator.tsx with HyroxEvents route');
