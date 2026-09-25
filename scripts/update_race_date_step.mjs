import fs from 'fs';
import path from 'path';

const targetPath = path.resolve('../HyroxHeroMobile/src/screens/onboarding/steps/RaceDateStep.tsx');

const content = `import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTranslate } from '@tolgee/react';
import { OnboardingStepWrapper } from '../../../components/onboarding/OnboardingStepWrapper';
import { Colors, Spacing, FontSizes, BorderRadius } from '../../../constants/theme';
import { Ionicons } from '@expo/vector-icons';
import { formatLocalDate } from '../../../utils/dateUtils';
import {
  fetchUpcomingEvents,
  HyroxEvent,
  formatHyroxEventDate,
  getWeeksUntilDate,
} from '../../../services/eventsApi';

interface RaceDateStepProps {
  formData: any;
  setFormData: (data: any) => void;
  progress: number;
}

export const RaceDateStep: React.FC<RaceDateStepProps> = ({
  formData,
  setFormData,
  progress,
}) => {
  const { t } = useTranslate();
  const [mode, setMode] = useState<'official' | 'custom'>(
    formData.race_event_id ? 'official' : 'official'
  );
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [events, setEvents] = useState<HyroxEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDate, setSelectedDate] = useState(
    formData.race_date ? new Date(formData.race_date + 'T00:00:00') : new Date()
  );

  useEffect(() => {
    let mounted = true;
    const loadEvents = async () => {
      setLoadingEvents(true);
      try {
        const fetched = await fetchUpcomingEvents(searchQuery);
        if (mounted) {
          setEvents(fetched);
        }
      } catch (err) {
        console.error('[RaceDateStep] Error fetching upcoming events:', err);
      } finally {
        if (mounted) setLoadingEvents(false);
      }
    };
    loadEvents();
    return () => {
      mounted = false;
    };
  }, [searchQuery]);

  const handleSelectOfficialEvent = (event: HyroxEvent) => {
    const eventDate = new Date(event.date + 'T00:00:00');
    setSelectedDate(eventDate);
    setFormData({
      ...formData,
      race_date: event.date,
      race_event_id: event.id,
      race_event_name: event.name,
    });
  };

  const handleDateChange = (_event: any, date?: Date) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
    }
    if (date) {
      setSelectedDate(date);
      setFormData({
        ...formData,
        race_date: formatLocalDate(date),
        race_event_id: undefined,
        race_event_name: undefined,
      });
    }
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const weeksUntilRace = () => {
    if (formData.race_date) {
      return getWeeksUntilDate(formData.race_date);
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffTime = selectedDate.getTime() - today.getTime();
    return Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24 * 7)));
  };

  return (
    <OnboardingStepWrapper
      title={t('onboarding.race_date.title', 'When is your HYROX race?')}
      subtitle={t('onboarding.race_date.subtitle', "We'll create the perfect timeline for your training")}
      progress={progress}
    >
      <View style={styles.container}>
        {/* Mode Selector Tabs */}
        <View style={styles.modeTabs}>
          <TouchableOpacity
            style={[styles.modeTab, mode === 'official' && styles.modeTabActive]}
            onPress={() => setMode('official')}
            activeOpacity={0.8}
          >
            <Ionicons
              name="trophy"
              size={16}
              color={mode === 'official' ? Colors.electricYellow : Colors.zinc500}
              style={{ marginRight: 6 }}
            />
            <Text style={[styles.modeTabText, mode === 'official' && styles.modeTabTextActive]}>
              {t('onboarding.race_date.officialRaces', 'Official HYROX')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.modeTab, mode === 'custom' && styles.modeTabActive]}
            onPress={() => setMode('custom')}
            activeOpacity={0.8}
          >
            <Ionicons
              name="calendar-outline"
              size={16}
              color={mode === 'custom' ? Colors.electricYellow : Colors.zinc500}
              style={{ marginRight: 6 }}
            />
            <Text style={[styles.modeTabText, mode === 'custom' && styles.modeTabTextActive]}>
              {t('onboarding.race_date.customDate', 'Custom Date')}
            </Text>
          </TouchableOpacity>
        </View>

        {mode === 'official' ? (
          <View style={styles.officialContainer}>
            {/* Search Input */}
            <View style={styles.searchBox}>
              <Ionicons name="search" size={16} color={Colors.zinc500} style={{ marginRight: 6 }} />
              <TextInput
                style={styles.searchInput}
                placeholder={t('onboarding.race_date.searchEvents', 'Search city or race...')}
                placeholderTextColor={Colors.zinc500}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <Ionicons name="close-circle" size={16} color={Colors.zinc500} />
                </TouchableOpacity>
              )}
            </View>

            {/* Races List */}
            {loadingEvents ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator size="small" color={Colors.electricYellow} />
                <Text style={styles.loadingText}>
                  {t('onboarding.race_date.loadingEvents', 'Loading official races...')}
                </Text>
              </View>
            ) : (
              <ScrollView
                style={styles.eventsScrollView}
                showsVerticalScrollIndicator={false}
                nestedScrollEnabled={true}
              >
                {events.map((event) => {
                  const isSelected =
                    formData.race_event_id === event.id ||
                    formData.race_date === event.date;
                  const weeks = getWeeksUntilDate(event.date);

                  return (
                    <TouchableOpacity
                      key={event.id}
                      style={[styles.eventItem, isSelected && styles.eventItemActive]}
                      onPress={() => handleSelectOfficialEvent(event)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.eventItemLeft}>
                        <Text style={[styles.eventItemTitle, isSelected && styles.eventItemTitleActive]}>
                          {event.name}
                        </Text>
                        <Text style={styles.eventItemSub}>
                          {formatHyroxEventDate(event.date)} • {event.city}, {event.country}
                        </Text>
                      </View>
                      <View style={styles.eventItemRight}>
                        <View style={[styles.weeksBadge, isSelected && styles.weeksBadgeActive]}>
                          <Text style={[styles.weeksBadgeText, isSelected && styles.weeksBadgeTextActive]}>
                            {weeks}w
                          </Text>
                        </View>
                        {isSelected && (
                          <Ionicons
                            name="checkmark-circle"
                            size={20}
                            color={Colors.electricYellow}
                            style={{ marginLeft: 6 }}
                          />
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                })}

                {events.length === 0 && (
                  <View style={styles.emptyBox}>
                    <Text style={styles.emptyText}>
                      {t('onboarding.race_date.noRacesFound', 'No upcoming races found. You can choose a custom date above.')}
                    </Text>
                  </View>
                )}
              </ScrollView>
            )}
          </View>
        ) : (
          <View style={styles.customContainer}>
            <TouchableOpacity
              style={styles.dateButton}
              onPress={() => setShowDatePicker(true)}
            >
              <View style={styles.dateContent}>
                <Ionicons name="calendar" size={24} color={Colors.electricYellow} />
                <Text style={styles.dateText}>{formatDate(selectedDate)}</Text>
              </View>
              <Ionicons name="chevron-forward" size={24} color={Colors.lightGray} />
            </TouchableOpacity>

            {showDatePicker && (
              <DateTimePicker
                value={selectedDate}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={handleDateChange}
                minimumDate={new Date()}
                textColor={Colors.pureWhite}
              />
            )}
          </View>
        )}

        {/* Timeline Info Card */}
        {formData.race_date && (
          <View style={styles.infoCard}>
            <View style={styles.infoCardHeader}>
              <Text style={styles.infoTitle}>
                {t('onboarding.race_date.timeline', 'Training Timeline')}
              </Text>
              {formData.race_event_name && (
                <Text style={styles.eventBadgeName} numberOfLines={1}>
                  {formData.race_event_name}
                </Text>
              )}
            </View>
            <Text style={styles.infoText}>
              {t('onboarding.race_date.weeks_to_prepare', '{weeks} weeks to prepare for your race', {
                weeks: weeksUntilRace(),
              })}
            </Text>
            {weeksUntilRace() < 4 && (
              <Text style={styles.warningText}>
                {t('onboarding.race_date.warning', "⚠️ Less than 4 weeks is a tight timeline, but we'll make it work!")}
              </Text>
            )}
          </View>
        )}
      </View>
    </OnboardingStepWrapper>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  modeTabs: {
    flexDirection: 'row',
    backgroundColor: Colors.zinc900,
    borderRadius: BorderRadius.lg,
    padding: 3,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.zinc800,
  },
  modeTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
  },
  modeTabActive: {
    backgroundColor: Colors.zinc800,
  },
  modeTabText: {
    fontSize: FontSizes.xs,
    fontWeight: '600',
    color: Colors.zinc500,
  },
  modeTabTextActive: {
    color: Colors.electricYellow,
  },
  officialContainer: {
    maxHeight: 280,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.deepCharcoal,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.sm + 4,
    height: 38,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.zinc700,
  },
  searchInput: {
    flex: 1,
    color: Colors.pureWhite,
    fontSize: FontSizes.xs,
  },
  loadingBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xl,
  },
  loadingText: {
    fontSize: FontSizes.xs,
    color: Colors.zinc400,
    marginTop: Spacing.xs,
  },
  eventsScrollView: {
    maxHeight: 220,
  },
  eventItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.deepCharcoal,
    borderRadius: BorderRadius.md,
    padding: Spacing.sm + 4,
    marginBottom: Spacing.xs + 2,
    borderWidth: 1,
    borderColor: Colors.zinc800,
  },
  eventItemActive: {
    borderColor: Colors.electricYellow,
    backgroundColor: 'rgba(255, 235, 59, 0.08)',
  },
  eventItemLeft: {
    flex: 1,
    marginRight: Spacing.sm,
  },
  eventItemTitle: {
    fontSize: FontSizes.xs + 1,
    fontWeight: '700',
    color: Colors.pureWhite,
    marginBottom: 2,
  },
  eventItemTitleActive: {
    color: Colors.electricYellow,
  },
  eventItemSub: {
    fontSize: 11,
    color: Colors.zinc400,
  },
  eventItemRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  weeksBadge: {
    backgroundColor: Colors.zinc800,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: BorderRadius.xs,
  },
  weeksBadgeActive: {
    backgroundColor: Colors.electricYellow,
  },
  weeksBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.zinc400,
  },
  weeksBadgeTextActive: {
    color: Colors.jetBlack,
  },
  emptyBox: {
    padding: Spacing.lg,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: FontSizes.xs,
    color: Colors.zinc500,
    textAlign: 'center',
  },
  customContainer: {
    marginBottom: Spacing.sm,
  },
  dateButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.deepCharcoal,
    padding: Spacing.lg,
    borderRadius: BorderRadius.lg,
    borderWidth: 2,
    borderColor: Colors.electricYellow,
  },
  dateContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dateText: {
    fontSize: FontSizes.md,
    color: Colors.pureWhite,
    marginLeft: Spacing.md,
    fontWeight: '600',
  },
  infoCard: {
    marginTop: Spacing.md,
    padding: Spacing.md,
    backgroundColor: \`\${Colors.electricYellow}15\`,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.electricYellow,
  },
  infoCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  infoTitle: {
    fontSize: FontSizes.sm,
    fontWeight: 'bold',
    color: Colors.electricYellow,
  },
  eventBadgeName: {
    fontSize: 11,
    color: Colors.neonGreen,
    fontWeight: '600',
    maxWidth: '55%',
  },
  infoText: {
    fontSize: FontSizes.sm,
    color: Colors.pureWhite,
    lineHeight: FontSizes.sm * 1.4,
  },
  warningText: {
    fontSize: FontSizes.xs,
    color: Colors.warning,
    marginTop: Spacing.xs,
    fontStyle: 'italic',
  },
});
`;

fs.writeFileSync(targetPath, content, 'utf8');
console.log('✅ Updated src/screens/onboarding/steps/RaceDateStep.tsx with official HYROX event picker');
